import { useCallback, useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
import type { FileThreads } from '@/nostr/foreign'
import {
  RelayReadError,
  classifyRelayFailure,
  isOutage,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { createListingCache, type ListingLoad } from '@/platform/listingCache'
import { useListing } from '@/platform/useListing'
import { isConversationHeld } from './conversations'
import { HELD_OBJECT_FRESH_MS } from './foreign'

/**
 * One file's conversation, whichever app owns the file — RFC 0.5 §10.
 *
 * **This is the whole of the aspects claim, in one hook.** §10.1 says facets
 * existed only because *"Peek could not render a project's conversation"*, so a
 * topic was invented to stand in for the project and a mechanism was then needed
 * to glue the stand-in back. Remove the limitation and the pairing has nothing
 * to do. This is the removal: Peek reads the conversation of a Ship project the
 * same way it would read any other file's.
 *
 * ## It needs no FOL-3 and no new kind
 *
 * Nothing here is new protocol. `resolveForeignObject` already fetches
 * `{ kinds: commentKindsOf(manifest), '#a': [address] }` in the same round trip
 * as the root, and Ship's manifest already declares
 * `emits: { kind: 1111, scope: 'address', alsoRead: [9] }` for **both** its
 * project and issue kinds. So a project's comments were always addressable and
 * always readable; they were resolved and then thrown away, because the only
 * place Peek drew a foreign object was inside a topic conversation, where
 * restating them would duplicate the thread the widget sits in (PEEK-18).
 *
 * A panel reached from a Folder is the other context, and there the comments are
 * the content rather than a restatement. Hence a hook of its own rather than
 * relaxing the widget's rule, which is still right where it applies.
 *
 * ## No kind number reaches this file
 *
 * Deliberately, and for the same reason `FolderContentsView` must never grow
 * one: the comment kinds come off the owning app's manifest at runtime. A Leaf
 * document that declares a different comment kind draws here with no change,
 * and a `kind === 30850` branch would turn the panel into an integration with
 * Ship — the exact thing the projection layer exists to avoid.
 *
 * ## An action, not a query
 *
 * Same shape as `useFolderContents` and for the same reason: this reads a relay
 * over HTTP, which Convex's reactive layer cannot do, so it reflects the moment
 * it resolved. The refresh triggers are the fallback.
 */
export type ForeignConversationState =
  | ForeignObject
  | 'loading'
  /**
   * The reference did not resolve, and this deliberately does **not** claim
   * which reason.
   *
   * `resolveObject` returns `null` for a viewer that is signed out, a manifest
   * that could not be read, and a reference no app claims. Those are three
   * sentences and the seam collapses them, so inventing one here would be a
   * guess rendered as a fact. What matters is only that it is *not* an empty
   * conversation, and this keeps it on the unreadable side of that line.
   */
  | 'unresolved'
  | { failed: RelayFailureKind }

function useResolvedForeign(naddr: string | null | undefined): {
  state: ForeignConversationState
  reload: () => Promise<void>
  /**
   * The file the last answer was for, while `state` is loading a different
   * one (SID-2) — `null` otherwise. The file page's sidebar draws off it
   * between a click and the next resolve, so the open Folder, its rows and
   * their expand state are not thrown away for one read's length.
   */
  previous: ForeignObject | null
} {
  const { resolveObject, resolveFileFolder } = useForeignObjects()

  const load = useCallback(
    (target: string): Promise<ListingLoad<ForeignObject | null, RelayFailureKind>> =>
      /*
        The page a link opens says "Archived with its project" (FOL-46), which
        costs a read of the parent — paid here, and by no card or widget. An
        archived child is already left out of `children` (interop 0.38.0), so
        the tree's expanded project lists no archived issue.
      */
      resolveObject(target, { archivedWith: true })
        .then(async (object) => {
          /*
            A record with no `h` still has a Folder its conversation is written
            in (PEE-33): a Ship project names it by `buzz-channel`, which the
            projection does not report. One more read, paid only for such a
            file — an issue, a topic and every file placed by `h` resolve with
            it already — so the page can hand Peek's own view a container
            rather than leaving it loading for ever.
          */
          if (object?.address && !object.folder) {
            const folder = await resolveFileFolder(object.address)
            return { ok: true as const, value: folder ? { ...object, folder } : object }
          }
          return { ok: true as const, value: object }
        })
        .catch((error: unknown) => {
          /*
            Swallowed, like the folder read: nothing throws and the panel keeps
            working. What the failure buys is that the view can say *which*
            empty state this is — a file nobody has said anything about and a
            file whose conversation could not be read look identical otherwise,
            and rendering the second as the first is the mistake that showed
            "No folders yet" about eighty-one folders.
          */
          const kind =
            error instanceof RelayReadError
              ? error.kind
              : classifyRelayFailure((error as Error)?.message ?? '')
          if (isOutage(kind)) recordReadFailure(kind)
          console.warn('[nostr] foreign conversation read failed:', error)
          return { ok: false as const, failure: kind as RelayFailureKind }
        }),
    [resolveObject, resolveFileFolder],
  )

  /*
    Held past this component, by address (SID-2): a row's children after its
    chevron closes and opens again, and a file opened a second time, draw at
    once and revalidate behind it. Keyed, so a slow resolve for the previously
    selected file cannot paint over the one that is open now.

    A failed *re*-read keeps the answer it has (FOL-40), the same rule the
    Folder's own listing follows. It matters beyond this pane: the file page
    hands the tree `currentFolder` and `selectedRef` off this object, so one
    hiccup on the 30 s tick would close the open Folder in the sidebar and
    unselect the row, and the next tick would open it again — the redraw
    Miky saw beside the late dot. A first read still reports its failure;
    there is nothing to keep.
  */
  const entry = useListing(resolvedCache, naddr ?? null)

  const reload = useCallback(async () => {
    if (naddr) await resolvedCache.read(naddr, () => load(naddr))
  }, [naddr, load])

  /*
    Not on a return to a file whose conversation is held (OPT-3): its catch-up
    asks after the file's own changes in the same request, and re-reads it
    through `onActivity` only when one came. Only while the answer is a few
    minutes old: the resolve folds more than the catch-up watches — a parent's
    archive, the people it names.
  */
  useEffect(() => {
    if (!naddr) return
    const held = resolvedCache.peek(naddr)
    if (held?.value && Date.now() - held.at < HELD_OBJECT_FRESH_MS && isConversationHeld(naddr)) return
    void resolvedCache.revalidate(naddr, () => load(naddr))
  }, [naddr, load])

  useRefreshTriggers(
    () => {
      if (naddr) void reload()
    },
    { enabled: !!naddr },
  )

  const state: ForeignConversationState =
    !naddr || !entry
      ? 'loading'
      : entry.value !== undefined
        ? (entry.value ?? 'unresolved')
        : entry.failure
          ? { failed: entry.failure }
          : 'loading'
  /*
    The address this hook last had an answer for, so `previous` can name it
    while the next one loads. Set during render, since an effect would be a
    second render with the old answer already gone from the screen.
  */
  const [shown, setShown] = useState<string | null>(null)
  if (naddr && entry?.value !== undefined && shown !== naddr) setShown(naddr)
  const previous = state === 'loading' && shown && shown !== naddr ? (resolvedCache.peek(shown)?.value ?? null) : null

  return { state, reload, previous }
}

/** Every reference this tab has resolved, by the reference asked (SID-2). */
const resolvedCache = createListingCache<ForeignObject | null, RelayFailureKind>()

/**
 * One file's conversation — the panel's read.
 *
 * Named for the aspect rather than the call because that is what the caller
 * wants; the resolve underneath also carries the children, which is the other
 * hook below.
 */
export function useForeignConversation(naddr: string | null | undefined) {
  return useResolvedForeign(naddr)
}

/** What a short topic link's `d` resolved to. */
export type FileAddressState =
  | 'loading'
  | { address: string }
  /** No bare file carries this `d`, or the viewer is signed out — a dead link either way. */
  | 'unresolved'
  | { failed: RelayFailureKind }

/**
 * The author of every `d` this session has seen, as the address it belongs to.
 *
 * Module scope, for the same reason the people cache is: a `d` has one author
 * for ever (RFC 0.5 §7.4), so once a bare file has resolved by any route the
 * short form needs no read to open it. `FilePage` seeds this before it
 * canonicalises a long link to the short one, which is what keeps that
 * replace from throwing away the file it has just drawn and asking for it
 * again.
 */
const knownAddresses = new Map<string, string>()

/** Record a bare file's address against its `d`, so its short link opens without a read. */
export function rememberFileAddress(address: string): void {
  const identifier = address.split(':')[2]
  if (identifier) knownAddresses.set(identifier.toLowerCase(), address)
}

/** Forget every remembered address — for tests. */
export function forgetFileAddresses(): void {
  knownAddresses.clear()
}

/**
 * The address behind `/<word>/<slug>-<d>` — FOL-37, and FOL-39 for every
 * word the manifests declare.
 *
 * The short route carries only the file's `d`; this is the one `#d` query
 * that recovers the author, after which the page resolves the file exactly as
 * it would from the long form. The word says which kinds to ask over, and a
 * word nothing declares asks over all of them (`fileAddressAsViewer`). Kept
 * apart from `useResolvedForeign` rather than folded into it because the
 * resolve is keyed on the address and re-runs on every refresh trigger, and
 * the author of a `d` never changes — one lookup per link is the right
 * number, and none when the session has already seen it. Failures are
 * classified the same way, so the page can say "the relay could not be asked"
 * rather than "nothing here" during an outage.
 */
export function useFileAddress(word: string, identifier: string | null | undefined): FileAddressState {
  const { resolveFileAddress } = useForeignObjects()
  const [resolved, setResolved] = useState<{
    identifier: string
    address?: string | null
    failed?: RelayFailureKind
  }>()
  const known = identifier ? knownAddresses.get(identifier) : undefined

  useEffect(() => {
    if (!identifier || knownAddresses.has(identifier)) return
    let cancelled = false
    resolveFileAddress(word, identifier)
      .then((address) => {
        if (address) knownAddresses.set(identifier, address)
        return { identifier, address }
      })
      .catch((error: unknown) => {
        const kind =
          error instanceof RelayReadError
            ? error.kind
            : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] file address read failed:', error)
        return { identifier, failed: kind as RelayFailureKind }
      })
      .then((next) => !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [word, identifier, resolveFileAddress])

  if (!identifier) return 'loading'
  if (known) return { address: known }
  if (resolved?.identifier !== identifier) return 'loading'
  if (resolved.failed) return { failed: resolved.failed }
  return resolved.address ? { address: resolved.address } : 'unresolved'
}

/** What is under a file's comments, once they are known. */
export type FileThreadsState = FileThreads | 'loading' | { failed: RelayFailureKind }

/**
 * The replies under one file's comments — the thread panel's read (FOL-19).
 *
 * Separate from the conversation because the two are different requests to
 * different filters: the comments arrive `#a`-scoped with the file, and by
 * NIP-22 nothing below a comment carries the file's address, so the replies
 * cannot come with them (see {@link threadsAsViewer}). Keyed on the comment ids
 * rather than the file, so a new comment re-asks and a re-render does not.
 * A comment deleted under its replies comes back in `deleted`, its replies
 * still under its id (PEE-40), as Peek's own view draws them.
 *
 * An empty answer is a real one — nobody has replied to anything — and a
 * failure is kept apart from it for the reason the whole of this file exists:
 * a thread that could not be read must not draw as a thread with no replies.
 */
export function useFileThreads(
  reference: string | null | undefined,
  rootIds: readonly string[],
): { state: FileThreadsState; reload: () => Promise<void> } {
  const { fileThreads: threads } = useForeignObjects()
  const [answer, setAnswer] = useState<{
    key: string
    threads?: FileThreads
    failed?: RelayFailureKind
  }>()
  // The identity of the array changes every render; the comment ids do not.
  const key = reference ? `${reference} ${rootIds.join(',')}` : ''

  const load = useCallback(async () => {
    if (!key) return
    const [target, ids] = key.split(' ')
    return threads(target, ids ? ids.split(',') : [])
      .then((result) => ({ key, threads: result }))
      .catch((error: unknown) => {
        const kind =
          error instanceof RelayReadError
            ? error.kind
            : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] thread read failed:', error)
        return { key, failed: kind as RelayFailureKind }
      })
  }, [key, threads])

  const reload = useCallback(async () => {
    const next = await load()
    // A slow read for the file that *was* open must not paint over this one.
    if (next?.key === key) setAnswer(next)
  }, [load, key])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void load().then((next) => !cancelled && next && setAnswer(next))
    return () => {
      cancelled = true
    }
  }, [key, load])

  useRefreshTriggers(
    () => {
      if (key) void reload()
    },
    { enabled: !!key },
  )

  const state: FileThreadsState =
    answer?.key !== key || !key
      ? 'loading'
      : answer.failed
        ? { failed: answer.failed }
        : (answer.threads ?? 'loading')

  return { state, reload }
}

/** A file's children, once something expands it. */
export type ForeignChildrenState =
  | ForeignObject[]
  | 'loading'
  | 'unresolved'
  | { failed: RelayFailureKind }

/**
 * The files inside a file — RFC 0.4 §4, and the nesting FOL-4 names.
 *
 * **Lazy, and one request per expansion.** `resolveFolderContents` fetches no
 * children (it is flat in the number of files and stays that way), so an
 * expander pays for its own row when somebody opens it and never before. The
 * projection cache makes the manifest free, so the cost is the roots.
 *
 * Shares the resolve with {@link useForeignConversation} because
 * `resolveForeignObject` returns the root, its changes, its comments *and* its
 * children in one round trip — asking twice for the two halves would double the
 * cost of a row that is both expanded and open in the panel.
 *
 * An empty array is a real answer: a project with no issues. `unresolved` and
 * `failed` are not, and a consumer must not render either as "no issues".
 */
export function useForeignChildren(naddr: string | null | undefined): {
  state: ForeignChildrenState
  reload: () => Promise<void>
} {
  const { state, reload } = useResolvedForeign(naddr)
  if (state === 'loading' || state === 'unresolved' || 'failed' in state) {
    return { state, reload }
  }
  /*
    `children` is absent when the owning app declares no list, and `[]` when it
    declares one that matched nothing — interop keeps those apart deliberately.
    Both render as "nothing to show" here, because a row that offered an
    expander at all had `listsChildren`, so the first case should not arise.
  */
  return { state: state.children ?? [], reload }
}
