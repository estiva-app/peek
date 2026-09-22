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

  /*
    A failed *re*-read keeps what is on screen (FOL-40). The failure is worth
    a sentence when there is nothing else to say — an empty Folder and an
    unreadable one are different (PEE-10) — and worth nothing at all when the
    rows are already drawn: a 30 s tick that hits a hiccup would otherwise
    replace a read Folder with "This folder could not be read", and the next
    tick would put it back. A first read for this Folder still says so,
    because there is then no answer to keep.
  */
  const keep = useCallback(
    (next: { folder: string; contents?: FolderContents; failed?: RelayFailureKind }) =>
      setResolved((held) =>
        next.failed && held?.folder === next.folder && held.contents ? held : next,
      ),
    [],
  )

  const reload = useCallback(async () => {
    if (!folder) return
    const next = await load(folder)
    // A slow resolve for the previous Folder must not paint over the next one.
    if (next.folder === folder) keep(next)
  }, [folder, load, keep])

  useEffect(() => {
    if (!folder) return
    let cancelled = false
    void load(folder).then((next) => !cancelled && keep(next))
    return () => {
      cancelled = true
    }
  }, [folder, load, keep])

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
 * The Folders a person navigates by: the top of the tree (PEE-31).
 *
 * `listFolders` answers with every channel this viewer can see, and most of
 * production's are nobody's Folder: a Ship project's record channel (forty
 * `project-…`), the channel a project's issues live in by `h`, a test topic.
 * Each is reached through the object it belongs to and was never navigation.
 * Listing them beside the five teams is what Miky objected to on 2026-09-15:
 * "in both Peek and Ship have 5 folders … under those there should be all the
 * topics and projects."
 *
 * Two facts the summary already carries decide it, with no further read:
 *
 * - **It has state.** A `kind:30890` exists once somebody has sent a Folder
 *   command at the channel — placed something in it, named it as a Folder.
 *   That is the relay's own mark that the channel is used as a Folder; a
 *   record channel or a conversation container never gets one. Peek's Create
 *   gives a new Folder state at birth for exactly this reason
 *   (`createFolderAsViewer`).
 * - **Nothing lists it.** A Folder placed in another (`listedIn`, FOL-22) is a
 *   row inside that one, not a section beside it.
 *
 * Not the five by id: a sixth team is a Folder somebody creates, not a code
 * change. A Folder this hides is still reachable at `/folders/<id>` and from
 * the object it belongs to.
 */
export function topLevelFolders(folders: FolderSummary[]): FolderSummary[] {
  return folders.filter((folder) => folder.hasState && !folder.listedIn?.length)
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
export function useFolders(): {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  reload: () => Promise<void>
} {
  const { listFolders } = useForeignObjects()
  const [folders, setFolders] = useState<FolderSummary[] | null>(null)
  const [signedOut, setSignedOut] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await listFolders()
      // `null` is the seam saying "no viewer", which is not an empty workspace.
      setSignedOut(next === null)
      setFolders(next)
    } catch {
      setFolders([])
    }
  }, [listFolders])

  useEffect(() => {
    void load()
  }, [load])

  return { folders, signedOut, reload: load }
}
