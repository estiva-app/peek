import { useCallback, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { FolderProject } from '@estiva-app/interop'
import { hasConvex, useForeignObjects } from '@/api'
import {
  RelayReadError,
  classifyRelayFailure,
  isOutage,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { peekLiveTopics } from '@/nostr/liveTopics'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'

/**
 * What is in this topic's Folder — the project and its tickets.
 *
 * **Extracted from `TopicProjectPanel` by CON-9, because a second caller
 * appeared.** The topic's conversation now has to know which objects are *this
 * file* and which are files *under* it, so that a comment on a ticket goes to
 * Activity rather than into the topic's own stream. That is the same question
 * the panel was already asking, and asking it twice would mean two resolves per
 * topic and two chances to disagree about what is in the Folder.
 *
 * Everything below was the panel's, moved rather than rewritten. What stayed
 * behind is the part only the panel does: applying an action and holding the
 * per-object error.
 *
 * ## It knows nothing about Ship
 *
 * `resolveFolderProject` answers from published manifests at runtime — which
 * kind is a project, which is a ticket, how they link. So "which of these is a
 * sub-file" is the projection layer's answer, not a kind number written into
 * Peek. A fourth app's records split a topic's conversation correctly without
 * Peek learning what they are.
 *
 * ## An action, not a query
 *
 * This reads a relay over HTTP, which Convex's reactive layer cannot do, so it
 * reflects the moment it resolved rather than live-updating. The socket drives
 * a re-read (PRO-10) and the refresh triggers are the fallback — a change
 * published while the tab was closed arrives on focus, and a socket that is
 * quietly dead stops being indistinguishable from a quiet workspace.
 */
export type FolderProjectState = FolderProject | null | 'loading' | { failed: RelayFailureKind }

export interface UseFolderProject {
  /** The Folder's contents, or which kind of nothing this is. */
  state: FolderProjectState
  /** The topic's Folder: `undefined` while the query runs, `null` when it has none. */
  folder: string | null | undefined
  /** Re-read now — what an action awaits, so it never races its own refresh. */
  reload: () => Promise<void>
}

export function useFolderProject(
  topicKey: string | null | undefined,
  /**
   * Hold every automatic re-read while this is set.
   *
   * The panel passes the object it is changing. A refresh started before an
   * action lands can finish after it and put the pre-change state back on
   * screen, so the caller that knows a write is in flight says so.
   */
  pauseWhile?: unknown,
): UseFolderProject {
  const folder = useQuery(
    api.nostr.data.folderForTopic,
    hasConvex && topicKey ? { topicKey } : 'skip',
  )
  const { resolveFolderProject: resolveProject } = useForeignObjects()

  /** Kept with the Folder it came from, so switching topics cannot show the
   *  previous topic's project while the next one resolves. */
  const [resolved, setResolved] = useState<{
    folder: string
    project: FolderProject | null
    failed?: RelayFailureKind
  }>()

  const load = useCallback(
    (target: string) =>
      resolveProject(target)
        .then((project) => ({ folder: target, project }))
        .catch((error: unknown) => {
          // Swallowed — nothing throws, nothing interrupts, and the app keeps
          // working off its Convex rows. What the failure buys is that the
          // caller can say *which* empty state this is.
          const kind =
            error instanceof RelayReadError
              ? error.kind
              : classifyRelayFailure((error as Error)?.message ?? '')
          // Not a member is a real answer, arrived at successfully — it says
          // nothing about the relay being reachable and must not light the
          // connection indicator.
          if (isOutage(kind)) recordReadFailure(kind)
          console.warn('[nostr] folder project read failed:', error)
          return { folder: target, project: null, failed: kind as RelayFailureKind }
        }),
    [resolveProject],
  )

  const reload = useCallback(async () => {
    if (!folder) return
    const next = await load(folder)
    // A slow resolve for the previous topic must not paint over the next one.
    if (next.folder === folder) setResolved(next)
  }, [folder, load])

  useEffect(() => {
    if (!folder) return
    let cancelled = false
    void load(folder).then((next) => !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [folder, load])

  /*
    The socket drives this and the timer is the fallback (PRO-10).

    The subscription is kindless, so a Ship issue moving already arrives in the
    browser the moment it is published; `liveProjection` reports the Folder and
    this re-reads. No event is carried and none is stored — Peek does not hold
    Ship's records, which is ADR 0001's split working, so the useful signal is
    "re-read now". That is also what keeps it correct for an app nobody has
    written yet.
  */
  useEffect(() => {
    if (!folder) return
    const live = peekLiveTopics()
    if (!live) return
    return live.onForeignActivity(folder, () => {
      if (pauseWhile) return
      void reload()
    })
  }, [folder, pauseWhile, reload])

  /**
   * Re-resolve on focus, visibility and a slow interval (PEE-2).
   *
   * The resolve effect is keyed on the folder id, which does not change for the
   * life of a topic — so without this it reads once and never again. That was
   * the reported "a project created in Ship does not show until you navigate
   * away and back": navigating away and back *is* the remount.
   */
  useRefreshTriggers(
    () => {
      if (!folder || pauseWhile) return
      void reload()
    },
    { enabled: hasConvex && !!folder },
  )

  /*
    `undefined` is the Folder query still loading; `null` is a topic with no
    Folder at all (created before Nostr emission was wired up) — nothing to
    resolve, and an empty answer is the honest one. The two are kept apart
    because a caller must be able to tell "still coming" from "there is none".
  */
  const state: FolderProjectState =
    folder === undefined
      ? 'loading'
      : folder === null
        ? null
        : resolved?.folder === folder
          ? resolved.failed
            ? { failed: resolved.failed }
            : resolved.project
          : 'loading'

  return { state, folder, reload }
}

/**
 * The addresses of the files *under* this one — CON-9's sub-files.
 *
 * The project itself is deliberately absent: a comment on the project is a
 * comment on the file the topic *is*, and identity merges. Only the tickets
 * aggregate.
 */
export function subFileAddresses(state: FolderProjectState): Set<string> {
  return new Set(subFileLabels(state).keys())
}

/**
 * Sub-file address → the name its own app gives it, for an Activity row.
 *
 * **Keyed by `address`, not `ref`.** They are different fields for a reason: a
 * `ref` is a stable handle for any object including a regular event, while
 * `address` is `kind:pubkey:d` and exists only for an addressable one. What a
 * message carries in `nostrReferences` is the `a` tag, which is an address — so
 * keying by `ref` would compile, look right, and match nothing.
 *
 * A ticket with no address is skipped rather than keyed by something else: it
 * cannot be the target of an `a` tag, so no comment can name it.
 *
 * The title comes off the `title` slot, which is the manifest's word for it —
 * the same slot `ProjectTickets` reads. Not `subtitle`: Ship maps that to the
 * issue's description.
 */
export function subFileLabels(state: FolderProjectState): Map<string, string> {
  if (!state || state === 'loading' || 'failed' in state) return new Map()
  const labels = new Map<string, string>()
  for (const ticket of state.tickets) {
    if (ticket.address) labels.set(ticket.address, String(ticket.slots.title?.value ?? 'Untitled'))
  }
  return labels
}

/**
 * Split a topic's messages into its own conversation and its Activity — CON-9.
 *
 * *Identity merges; relation aggregates.* A message that **tags** one of this
 * Folder's sub-files is that file's conversation and aggregates into Activity;
 * everything else — talk in the topic, and comments on the project, which is the
 * file this topic *is* — stays in the stream.
 *
 * **Tagged, never merely named.** A person who types a ticket's pointer into a
 * sentence has written a message in the topic that mentions a ticket; they have
 * not written a comment on the ticket. Reading the body here would put a
 * twenty-message discussion under a ticket because somebody linked it once,
 * which is the merge SPEC §5.1 calls indefensible — the same rule, one level up.
 *
 * A pure function rather than three `useMemo`s in the view, because this is the
 * claim the whole change rests on and a hook is a bad place to prove one.
 */
export function partitionByRelation<T extends { nostrReferences?: string[]; createdAtMs?: number }>(
  messages: readonly T[],
  subFiles: ReadonlySet<string>,
): { own: T[]; activity: { message: T; about: string }[] } {
  const own: T[] = []
  const activity: { message: T; about: string }[] = []
  for (const message of messages) {
    const about = (message.nostrReferences ?? []).find((address) => subFiles.has(address))
    if (about) activity.push({ message, about })
    else own.push(message)
  }
  // Newest first: Activity is a roll-up you scan, not a conversation you read
  // from the top. Undated entries sort last rather than first, so a message with
  // no timestamp cannot claim the most-recent slot.
  activity.sort((a, b) => (b.message.createdAtMs ?? 0) - (a.message.createdAtMs ?? 0))
  return { own, activity }
}
