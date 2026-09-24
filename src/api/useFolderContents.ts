import { useCallback, useEffect, useState } from 'react'
import type { FolderContents, FolderSummary } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
import {
  isOutage,
  relayFailureKind,
  withRateLimitRetry,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { peekLiveTopics } from '@/nostr/liveTopics'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { createListingCache, type ListingLoad } from '@/platform/listingCache'
import { useListing } from '@/platform/useListing'

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

/** Every Folder's contents this tab has read, by Folder id (SID-2). */
const folderContentsCache = createListingCache<FolderContents, RelayFailureKind>()

type ResolveFolderContents = (folder: string) => Promise<FolderContents>

function loadFolderContents(
  resolveFolderContents: ResolveFolderContents,
  folder: string,
): Promise<ListingLoad<FolderContents, RelayFailureKind>> {
  /*
    A quota refusal is waited out at the second the relay named rather than
    drawn as a failure (FOL-40). This read is one of the six that go out
    together when the sidebar and the Folder view both refresh, so it is
    among the first to be refused — and "This folder could not be read" for
    a relay that answered promptly and will answer again in eight seconds
    is the wrong sentence twice over.
  */
  return withRateLimitRetry(() => resolveFolderContents(folder))
    .then((contents) => ({ ok: true as const, value: contents }))
    .catch((error: unknown) => {
      // Swallowed, like the project read: nothing throws and the app keeps
      // working. What the failure buys is that the view can say *which*
      // empty state this is — an empty Folder and an unreadable one look
      // identical otherwise, which is the ambiguity PEE-10 exists to remove.
      const kind = relayFailureKind(error)
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] folder contents read failed:', error)
      return { ok: false as const, failure: kind as RelayFailureKind }
    })
}

/**
 * Read a Folder's contents ahead of its fold opening (SID-2) — the hover or
 * focus on its header, so the first open draws rows rather than a skeleton.
 * One Folder, the one the pointer rests on, and only one this tab has never
 * read: once anything is held, opening the fold shows it and revalidates, so a
 * second prefetch would only spend the relay's minute on a pointer passing by.
 */
export function prefetchFolderContents(resolveFolderContents: ResolveFolderContents, folder: string): void {
  if (folderContentsCache.peek(folder)) return
  void folderContentsCache.read(folder, () => loadFolderContents(resolveFolderContents, folder))
}

export function useFolderContents(folder: string | null | undefined): {
  state: FolderContentsState
  reload: () => Promise<void>
} {
  const { resolveFolderContents } = useForeignObjects()
  const load = useCallback((target: string) => loadFolderContents(resolveFolderContents, target), [resolveFolderContents])

  /*
    Held past this component (SID-2): a Folder collapsed and opened again, or
    drawn again by the next page's sidebar, shows what it held at once and
    revalidates behind it — with no read at all when the answer is seconds
    old, which is the hand-over between the page's read and a section's.

    A failed *re*-read keeps what is on screen (FOL-40), which the cache does
    for every reader: a 30 s tick that hits a hiccup would otherwise replace a
    read Folder with "This folder could not be read", and the next tick would
    put it back. A first read for this Folder still says so, because there is
    then no answer to keep.
  */
  const entry = useListing(folderContentsCache, folder ?? null)

  const reload = useCallback(async () => {
    if (folder) await folderContentsCache.read(folder, () => load(folder))
  }, [folder, load])

  useEffect(() => {
    if (folder) void folderContentsCache.revalidate(folder, () => load(folder))
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

  const state: FolderContentsState = entry?.value ?? (entry?.failure ? { failed: entry.failure } : 'loading')

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

/** The first wait before reading a failed Folder listing again. */
export const FOLDERS_RETRY_FIRST_MS = 5_000
/** The longest wait between re-reads while the listing keeps failing. */
export const FOLDERS_RETRY_MAX_MS = 60_000

/**
 * Every Folder this viewer can see, for the navigation.
 *
 * **Read once on mount, not on the refresh triggers.** A Folder's *name*
 * changes about as often as a channel is created, and this is a global query
 * across two kinds; putting it on the interval would spend the relay's read
 * budget re-learning a list nobody is looking at. The folder *view* re-reads
 * its own contents, which is where change actually shows up.
 *
 * **A failed read is read again, and never replaces a good one** (FOL-42).
 * Reading once made a single failure last the whole session, and on production
 * it did: the listing's second request — the records whose channels it places
 * under their teams — was refused on one page load, and a project's channel
 * stayed unplaced, its team's dot dark, until a reload. So a quota refusal is
 * waited out at the time the relay names (`withRateLimitRetry`), and any other
 * failure the relay may change its mind about is read again on a backoff, from
 * {@link FOLDERS_RETRY_FIRST_MS} doubling to {@link FOLDERS_RETRY_MAX_MS}, until
 * one succeeds. `refused` and `not_a_member` are not retried: they will answer
 * the same way.
 *
 * The first failure is still an empty list rather than an error: the rest of
 * the navigation is unaffected, and "no folders" is what a signed-out viewer
 * legitimately sees. A failure after a good read keeps the good one.
 */
export function useFolders(): {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  reload: () => Promise<void>
} {
  const { listFolders } = useForeignObjects()
  /* Consecutive retryable failures. Each one is a new value, so the effect
     below schedules exactly one re-read per failure, and a success ends it. */
  const [failures, setFailures] = useState(0)

  const load = useCallback(async (): Promise<ListingLoad<FolderSummary[] | null, RelayFailureKind>> => {
    try {
      // `null` is the seam saying "no viewer", which is not an empty workspace.
      const next = await withRateLimitRetry(() => listFolders())
      setFailures(0)
      return { ok: true, value: next }
    } catch (error: unknown) {
      const kind = relayFailureKind(error)
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] folder listing read failed:', error)
      if (kind === 'unreachable' || kind === 'rate_limited') setFailures((n) => n + 1)
      return { ok: false, failure: kind as RelayFailureKind }
    }
  }, [listFolders])

  /*
    Held past this component (SID-2), like a Folder's contents: every page
    mounts its own sidebar, and each used to start at `null` — the whole
    column a skeleton, on every page change, over Folders the tab had just
    drawn. A failure after a good read keeps the good one.
  */
  const entry = useListing(foldersCache, FOLDERS_KEY)
  const reload = useCallback(() => foldersCache.read(FOLDERS_KEY, load), [load])

  useEffect(() => {
    void foldersCache.revalidate(FOLDERS_KEY, load)
  }, [load])

  useEffect(() => {
    if (failures === 0) return
    const wait = Math.min(FOLDERS_RETRY_FIRST_MS * 2 ** (failures - 1), FOLDERS_RETRY_MAX_MS)
    const timer = setTimeout(() => void reload(), wait)
    return () => clearTimeout(timer)
  }, [failures, reload])

  const held = entry?.value
  // A first read that failed draws as an empty workspace, as it always has; a signed-out answer is `null`.
  const folders = held !== undefined ? held : entry?.failure ? [] : null
  return { folders, signedOut: held === null, reload }
}

/** The one listing of every Folder the viewer can see (SID-2). */
const FOLDERS_KEY = 'folders'
const foldersCache = createListingCache<FolderSummary[] | null, RelayFailureKind>()
