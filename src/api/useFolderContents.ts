import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { isArchived, type FolderContents, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { RETRY_FIRST_MS, RETRY_MAX_MS, createRetryingRead } from '@estiva-app/platform'
import { useForeignObjects } from '@/api'
import type { StoredToken } from '@/auth/estivaId'
import { listFoldersAsViewer, resolveFolderContentsAsViewer } from '@/nostr/foreign'
import {
  isOutage,
  relayFailureKind,
  withRateLimitRetry,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { createListingCache, type ListingLoad } from '@/platform/listingCache'
import { useListing } from '@/platform/useListing'
import { listedNow, startedFilesIn, useStartedTopicsVersion } from './pendingTopics'

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
 * it resolved. The refresh triggers re-read it. A socket signal used to as
 * well, but it came from the Convex live projection, which only ever watched a
 * topic's channel, and went with it in FOL-23.
 */
export type FolderContentsState =
  | FolderContents
  | 'loading'
  | { failed: RelayFailureKind }

/** Every Folder's contents this tab has read, by Folder id (SID-2). */
const folderContentsCache = createListingCache<FolderContents, RelayFailureKind>()
/** And what is archived in each, for the Archive view — a read of its own, kept apart from the lists. */
const archivedContentsCache = createListingCache<FolderContents, RelayFailureKind>()

type ResolveFolderContents = (folder: string, options?: { includeArchived?: boolean }) => Promise<FolderContents>

/**
 * What is archived in a Folder (Katerina, 5 October: the Archive view): its
 * archived files and those hidden with an archived parent, or — for a Folder
 * that is itself archived — everything in it, which went with it.
 */
function loadArchivedContents(
  resolveFolderContents: ResolveFolderContents,
  folder: string,
  folderArchived: boolean,
): Promise<ListingLoad<FolderContents, RelayFailureKind>> {
  return withRateLimitRetry(() => resolveFolderContents(folder, { includeArchived: true }))
    .then((contents) => ({
      ok: true as const,
      value: folderArchived ? contents : { ...contents, files: contents.files.filter((file) => isArchived(file)) },
    }))
    .catch((error: unknown) => {
      const kind = relayFailureKind(error)
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] archived contents read failed:', error)
      return { ok: false as const, failure: kind as RelayFailureKind }
    })
}

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
    .then((contents) => {
      listedIn.set(folder, contents.files)
      listedNow(folder, contents.files)
      return { ok: true as const, value: contents }
    })
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
 * A Folder's files as the copy on the device answers them (PEE-4), drawn while
 * the relay's read is out. The copy answers only a listing whose every read the
 * relay answered on this device before; anything less is no answer, and the
 * Folder waits for the relay as it always has.
 */
function seedFolderContents(fromDevice: (folder: string) => Promise<FolderContents | undefined>, folder: string): void {
  fromDevice(folder)
    .then((contents) => {
      // Not into `listedIn`: OPT-9 opens a file as its latest listing holds it, and the copy's may be older.
      if (!contents || folderContentsCache.peek(folder)?.value !== undefined) return
      folderContentsCache.seed(folder, contents)
    })
    .catch(() => {})
}

/** Each Folder's files as its last listing read them (OPT-9). */
const listedIn = new Map<string, readonly ForeignObject[]>()

/**
 * A file as the Folder listing it was clicked in already holds it (OPT-9):
 * its title, its Folder and what it allows, known before the file page's own
 * resolve answers. Only the latest listing of each Folder counts, so a file
 * removed from its Folder is not still offered from an older read.
 */
export function listedFile(address: string): ForeignObject | undefined {
  for (const files of listedIn.values()) {
    const file = files.find((f) => f.address === address)
    if (file) return file
  }
  return undefined
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

/** At most this many Folders' contents are loaded ahead of Topics (PEE-5). */
export const FOLDERS_AHEAD = 10

/**
 * What Topics draws first — the listing, then the files of the Folders
 * `opens` picks from it — read on the `ahead` lane before Topics is opened
 * (PEE-5, Desk's loader). Only an answer is held: a refused read writes
 * nothing, so a later open reads for itself instead of drawing a failure
 * nobody was shown. Throws the first failure, which stops the loader.
 */
export async function loadFoldersAhead(
  at: { relayUrl: string; token: StoredToken },
  opens: (folders: readonly FolderSummary[]) => Promise<readonly FolderSummary[]>,
): Promise<FolderSummary[]> {
  let folders = folderListing.snapshot().value ?? undefined
  if (folders === undefined) {
    const read = await listFoldersAsViewer(at.relayUrl, at.token, 'ahead')
    folders = read
    if (folderListing.snapshot().value === undefined) await folderListing.ensure(async () => read)
  }
  // Asked together: the pacer serves the `ahead` lane in order, two REQs on the wire at a time.
  await Promise.all(
    (await opens(folders)).slice(0, FOLDERS_AHEAD).map(async (folder) => {
      const held = folderContentsCache.peek(folder.id)
      if ((held?.value !== undefined && !held.seeded) || held?.inflight) return
      const contents = await resolveFolderContentsAsViewer(folder.id, at.relayUrl, at.token, undefined, 'ahead')
      if (folderContentsCache.peek(folder.id)?.inflight) return
      await folderContentsCache.read(folder.id, async () => {
        listedIn.set(folder.id, contents.files)
        listedNow(folder.id, contents.files)
        return { ok: true, value: contents }
      })
    }),
  )
  return folders
}

/**
 * The Folders some component on screen is reading now, each with how to read
 * it — what a write re-reads (`reloadFoldersOnScreen`). Counted, since the
 * page and a section can read the same Folder.
 */
const onScreen = new Map<string, { count: number; load: () => Promise<ListingLoad<FolderContents, RelayFailureKind>> }>()

/**
 * Read again every Folder on screen — after a row's rename, move, delete or
 * archive, when the page cannot know which open section drew the file (a
 * moved file leaves one and arrives in another). Bounded by what is open.
 */
export function reloadFoldersOnScreen(): Promise<void> {
  return Promise.all(
    [...onScreen].map(([key, { load }]) =>
      key.startsWith(ARCHIVED_KEY) ? archivedContentsCache.read(key.slice(ARCHIVED_KEY.length), load) : folderContentsCache.read(key, load),
    ),
  ).then(() => undefined)
}

const ARCHIVED_KEY = 'archived:'

/**
 * One Folder's files — or, with `archived`, what is archived in it (the
 * Archive view; `folderArchived` when the Folder itself is, so all of it).
 */
export function useFolderContents(
  folder: string | null | undefined,
  { archived = false, folderArchived = false }: { archived?: boolean; folderArchived?: boolean } = {},
): {
  state: FolderContentsState
  reload: () => Promise<void>
} {
  const { resolveFolderContents, resolveFolderContentsFromDevice } = useForeignObjects()
  const load = useCallback(
    (target: string) =>
      archived ? loadArchivedContents(resolveFolderContents, target, folderArchived) : loadFolderContents(resolveFolderContents, target),
    [resolveFolderContents, archived, folderArchived],
  )
  const cache = archived ? archivedContentsCache : folderContentsCache
  const screenKey = folder ? (archived ? `${ARCHIVED_KEY}${folder}` : folder) : null

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
  const entry = useListing(cache, folder ?? null)

  const reload = useCallback(async () => {
    if (folder) await cache.read(folder, () => load(folder))
  }, [folder, load, cache])

  useEffect(() => {
    if (!folder) return
    // Nothing held yet in this tab: the copy on the device draws it until the relay answers (PEE-4).
    if (!archived && !cache.peek(folder)?.value) seedFolderContents(resolveFolderContentsFromDevice, folder)
    void cache.revalidate(folder, () => load(folder))
  }, [folder, load, cache, archived, resolveFolderContentsFromDevice])

  useEffect(() => {
    if (!folder || !screenKey) return
    onScreen.set(screenKey, { count: (onScreen.get(screenKey)?.count ?? 0) + 1, load: () => load(folder) })
    return () => {
      const held = onScreen.get(screenKey)
      if (!held || held.count <= 1) onScreen.delete(screenKey)
      else onScreen.set(screenKey, { ...held, count: held.count - 1 })
    }
  }, [folder, screenKey, load])

  useRefreshTriggers(() => {
    if (folder) void reload()
  }, { enabled: !!folder })

  // Contents drawn from the copy give way to the relay refusing the Folder.
  const refused = entry?.seeded && entry.failure === 'not_a_member'
  const contents = !refused ? entry?.value : undefined
  /*
    A topic just started is listed from Start on (PEE-6), until a listing of
    its Folder holds it: drawn after what the Folder holds, as a new file is.
  */
  const started = useStartedTopicsVersion()
  const withStarted = useMemo(() => {
    if (!contents || archived || !folder) return contents
    const more = startedFilesIn(folder, contents.files)
    return more.length ? { ...contents, files: [...contents.files, ...more] } : contents
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `started` is the store's version: what it holds changed
  }, [contents, archived, folder, started])
  const state: FolderContentsState = withStarted || (entry?.failure ? { failed: entry.failure } : 'loading')

  return { state, reload }
}

/**
 * The Folders a person navigates by: the top of the tree (PEE-31) — a Folder
 * with state that nothing lists. The predicate now lives in
 * `@estiva-app/interop` (FOL-5), because Ship drew its sidebar from a copy of
 * it word for word, and the two apps showing the same sections is the point.
 */
export { topLevelFolders } from '@estiva-app/interop'

/** The first wait before reading a failed Folder listing again. The platform's, since FOL-5. */
export const FOLDERS_RETRY_FIRST_MS = RETRY_FIRST_MS
/** The longest wait between re-reads while the listing keeps failing. */
export const FOLDERS_RETRY_MAX_MS = RETRY_MAX_MS

/**
 * The one listing of every Folder the viewer can see (SID-2), held past the
 * component that asked: every page mounts its own sidebar, and each used to
 * start at `null` — the whole column a skeleton, on every page change, over
 * Folders the tab had just drawn.
 *
 * `refused` and `not_a_member` are not retried: they will answer the same way.
 * `freshMs` is the listing cache's, so a page change inside five seconds reads
 * nothing and one after it re-reads, as before.
 */
const folderListing = createRetryingRead<FolderSummary[] | null>({
  retryable: (error) => {
    const kind = relayFailureKind(error)
    return kind === 'unreachable' || kind === 'rate_limited'
  },
  freshMs: 5_000,
})

/** The listing as the copy on the device answered it, drawn only until `folderListing` holds the relay's (PEE-4). */
let listingFromCopy: FolderSummary[] | undefined
const listingFromCopyListeners = new Set<() => void>()
function setListingFromCopy(next: FolderSummary[] | undefined): void {
  listingFromCopy = next
  for (const listener of listingFromCopyListeners) listener()
}
function subscribeListingFromCopy(listener: () => void): () => void {
  listingFromCopyListeners.add(listener)
  return () => listingFromCopyListeners.delete(listener)
}
const listingFromCopySnapshot = () => listingFromCopy

/** Empty the held listing — what `clearListingCaches` does for the others. Tests call it between cases. */
export function clearFolderListing(): void {
  folderListing.clear()
  setListingFromCopy(undefined)
  listedIn.clear()
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
 * **A failed read is read again, and never replaces a good one** (FOL-42).
 * Reading once made a single failure last the whole session, and on production
 * it did: the listing's second request — the records whose channels it places
 * under their teams — was refused on one page load, and a project's channel
 * stayed unplaced, its team's dot dark, until a reload. So a quota refusal is
 * waited out at the time the relay names (`withRateLimitRetry`), and any other
 * failure the relay may change its mind about is read again on a backoff, from
 * {@link FOLDERS_RETRY_FIRST_MS} doubling to {@link FOLDERS_RETRY_MAX_MS}, until
 * one succeeds. Those rules are `@estiva-app/platform`'s `createRetryingRead`
 * since FOL-5, which Ship's sidebar takes too.
 *
 * The first failure is still an empty list rather than an error: the rest of
 * the navigation is unaffected, and "no folders" is what a signed-out viewer
 * legitimately sees. A failure after a good read keeps the good one.
 */
export function useFolders(): {
  /** `null` while the first read is in flight, or when signed out. */
  folders: FolderSummary[] | null
  signedOut: boolean
  /** The first read failed, so `folders` is `[]` without the relay having said so (PEE-42). */
  failed: boolean
  reload: () => Promise<void>
} {
  const { listFolders, listFoldersFromDevice } = useForeignObjects()

  const load = useCallback(async (): Promise<FolderSummary[] | null> => {
    try {
      // `null` is the seam saying "no viewer", which is not an empty workspace.
      return await withRateLimitRetry(() => listFolders())
    } catch (error: unknown) {
      const kind = relayFailureKind(error)
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] folder listing read failed:', error)
      throw error
    }
  }, [listFolders])

  const snapshot = useSyncExternalStore(folderListing.subscribe, folderListing.snapshot, folderListing.snapshot)
  const seeded = useSyncExternalStore(subscribeListingFromCopy, listingFromCopySnapshot, listingFromCopySnapshot)
  const reload = useCallback(() => folderListing.reload(load), [load])

  useEffect(() => {
    // Nothing held yet in this tab: the copy on the device draws the listing until the relay answers (PEE-4).
    if (folderListing.snapshot().value === undefined && listingFromCopy === undefined) {
      listFoldersFromDevice()
        .then((folders) => {
          if (folders && folderListing.snapshot().value === undefined) setListingFromCopy(folders)
        })
        .catch(() => {})
    }
    void folderListing.ensure(load)
  }, [load, listFoldersFromDevice])

  // The relay's answer, once there is one; until then, the copy's — unless the relay refused the person outright.
  const refused = snapshot.error !== undefined && ['not_a_member', 'refused'].includes(relayFailureKind(snapshot.error))
  const held = snapshot.value !== undefined ? snapshot.value : refused ? undefined : seeded
  // A first read that failed draws as an empty workspace, as it always has; a signed-out answer is `null`.
  const folders = held !== undefined ? held : snapshot.error !== undefined ? [] : null
  return { folders, signedOut: held === null, failed: held === undefined && snapshot.error !== undefined, reload }
}
