import { useCallback, useEffect, useState } from 'react'
import type { FolderContents, FolderSummary } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
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
 * Navigation by Folder — RFC 0.4 §4 and §5.
 *
 * **Beside `useFolderProject`, not instead of it.** That hook answers the
 * topic sidebar's question: *which Ship project is this topic paired with, and
 * what work is in motion in it*. This one answers *what files does this Folder
 * hold*, with no opinion about which of them matters. They read the same
 * container and are different questions, and collapsing them would give the
 * sidebar panel a list it does not want and this view a project it does not
 * need.
 *
 * ## It knows nothing about Ship, or about Peek
 *
 * `resolveFolderContents` answers from published manifests at runtime, so a
 * Folder holding a project, another topic and a record from an app nobody has
 * written yet comes back as three peers. No kind number reaches this file.
 *
 * ## An action, not a query
 *
 * Same shape as `useFolderProject` and for the same reason: this reads a relay
 * over HTTP, which Convex's reactive layer cannot do, so it reflects the moment
 * it resolved. The socket drives a re-read and the refresh triggers are the
 * fallback.
 */
export type FolderContentsState =
  | FolderContents
  | 'loading'
  | { failed: RelayFailureKind }

export function useFolderContents(folder: string | null | undefined): {
  state: FolderContentsState
  reload: () => Promise<void>
} {
  const { resolveFolderContents } = useForeignObjects()
  const [resolved, setResolved] = useState<{
    folder: string
    contents?: FolderContents
    failed?: RelayFailureKind
  }>()

  const load = useCallback(
    (target: string) =>
      resolveFolderContents(target)
        .then((contents) => ({ folder: target, contents }))
        .catch((error: unknown) => {
          // Swallowed, like the project read: nothing throws and the app keeps
          // working. What the failure buys is that the view can say *which*
          // empty state this is — an empty Folder and an unreadable one look
          // identical otherwise, which is the ambiguity PEE-10 exists to remove.
          const kind =
            error instanceof RelayReadError
              ? error.kind
              : classifyRelayFailure((error as Error)?.message ?? '')
          if (isOutage(kind)) recordReadFailure(kind)
          console.warn('[nostr] folder contents read failed:', error)
          return { folder: target, failed: kind as RelayFailureKind }
        }),
    [resolveFolderContents],
  )

  const reload = useCallback(async () => {
    if (!folder) return
    const next = await load(folder)
    // A slow resolve for the previous Folder must not paint over the next one.
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

  useEffect(() => {
    if (!folder) return
    const live = peekLiveTopics()
    if (!live) return
    return live.onForeignActivity(folder, () => void reload())
  }, [folder, reload])

  useRefreshTriggers(() => {
    if (folder) void reload()
  }, { enabled: !!folder })

  const state: FolderContentsState =
    !folder || resolved?.folder !== folder
      ? 'loading'
      : resolved.failed
        ? { failed: resolved.failed }
        : (resolved.contents as FolderContents)

  return { state, reload }
}

/**
 * Every Folder this viewer can see, for the navigation.
 *
 * **Read once on mount, not on the refresh triggers.** A Folder's *name*
 * changes about as often as a channel is created, and this is a global query
 * across two kinds; putting it on the interval would spend the relay's read
 * budget re-learning a list nobody is looking at. The folder *view* re-reads
 * its own contents, which is where change actually shows up.
 *
 * A failure is an empty list rather than an error: the rest of the navigation
 * is unaffected, and "no folders" is what a signed-out viewer legitimately
 * sees, so the two need not be told apart here.
 */
export function useFolders(): FolderSummary[] {
  const { listFolders } = useForeignObjects()
  const [folders, setFolders] = useState<FolderSummary[]>([])
  useEffect(() => {
    let cancelled = false
    listFolders()
      .then((next) => !cancelled && setFolders(next))
      .catch(() => !cancelled && setFolders([]))
    return () => {
      cancelled = true
    }
  }, [listFolders])
  return folders
}
