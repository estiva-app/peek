import { useCallback, useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
import {
  RelayReadError,
  classifyRelayFailure,
  isOutage,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'

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

export function useForeignConversation(naddr: string | null | undefined): {
  state: ForeignConversationState
  reload: () => Promise<void>
} {
  const { resolveObject } = useForeignObjects()
  const [resolved, setResolved] = useState<{
    naddr: string
    object?: ForeignObject | null
    failed?: RelayFailureKind
  }>()

  const load = useCallback(
    (target: string) =>
      resolveObject(target)
        .then((object) => ({ naddr: target, object }))
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
          return { naddr: target, failed: kind as RelayFailureKind }
        }),
    [resolveObject],
  )

  const reload = useCallback(async () => {
    if (!naddr) return
    const next = await load(naddr)
    // A slow resolve for the previously selected file must not paint over the
    // one that is open now.
    if (next.naddr === naddr) setResolved(next)
  }, [naddr, load])

  useEffect(() => {
    if (!naddr) return
    let cancelled = false
    void load(naddr).then((next) => !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [naddr, load])

  useRefreshTriggers(
    () => {
      if (naddr) void reload()
    },
    { enabled: !!naddr },
  )

  const state: ForeignConversationState =
    !naddr || resolved?.naddr !== naddr
      ? 'loading'
      : resolved.failed
        ? { failed: resolved.failed }
        : (resolved.object ?? 'unresolved')

  return { state, reload }
}
