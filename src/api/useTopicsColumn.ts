import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { topicAddressesAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useMembership } from '@/api/internal/membership'
import { useRelayViewer, useResolvedReferences } from './foreign'
import { hasRelay } from './relayUrl'

/** One of your topics on the Topics screen, with the files its list holds. */
export interface TopicWithFiles {
  topic: ForeignObject
  /** In the order they were added, as the topic's right column draws them (TOP-3). */
  files: ForeignObject[]
}

export type TopicsColumnState =
  | 'loading'
  | { failed: true }
  | {
      /** The topics you are a member of, A–Z, each with its files. */
      mine: TopicWithFiles[]
      /** Every other topic you can read, A–Z, title only: to open and join. */
      others: ForeignObject[]
    }

/*
  What this tab has read, shared by every mount: the column is drawn again on
  each page (Topics, then a file's page beside it), and the file page asks the
  same answer which column to show. Read again once it is a minute old, on the
  next mount.
*/
interface Held {
  pubkey: string | undefined
  topics: readonly string[] | null
  topicsAt: number
  failed: boolean
  lists: ReadonlyMap<string, readonly string[]>
  /** Lists to read again: an Add file or Remove on the topic, or an old answer. */
  stale: ReadonlySet<string>
}

const FRESH_MS = 60_000
const EMPTY: Held = { pubkey: undefined, topics: null, topicsAt: 0, failed: false, lists: new Map(), stale: new Set() }
let held: Held = EMPTY
const listeners = new Set<() => void>()
let topicsReading = false
const listsReading = new Set<string>()

function put(next: Held) {
  held = next
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => held

function failedRead(error: unknown, what: string) {
  const kind = error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
  if (isOutage(kind)) recordReadFailure(kind)
  console.warn(`[nostr] ${what} read failed:`, error)
}

type Viewer = NonNullable<ReturnType<ReturnType<typeof useRelayViewer>>>

async function readTopics(viewer: Viewer) {
  if (topicsReading) return
  topicsReading = true
  const pubkey = viewer.token.pubkey
  try {
    const topics = await topicAddressesAsViewer(viewer.relayUrl, viewer.token)
    // Every list held is from before this answer: each is read again, still drawn meanwhile.
    if (held.pubkey === pubkey) put({ ...held, topics, topicsAt: Date.now(), failed: false, stale: new Set(held.lists.keys()) })
  } catch (error) {
    failedRead(error, 'topics')
    // A failed read after a good one keeps the topics drawn; with none yet, it says so.
    if (held.pubkey === pubkey) put({ ...held, topicsAt: Date.now(), failed: held.topics === null })
  } finally {
    topicsReading = false
  }
}

async function readLists(viewer: Viewer, topics: readonly string[]) {
  const ask = topics.filter((topic) => !listsReading.has(topic))
  if (!ask.length) return
  for (const topic of ask) listsReading.add(topic)
  const pubkey = viewer.token.pubkey
  try {
    const lists = await topicListsAsViewer(ask, viewer.relayUrl, viewer.token)
    if (held.pubkey !== pubkey) return
    const next = new Map(held.lists)
    const stale = new Set(held.stale)
    for (const topic of ask) {
      next.set(topic, lists.get(topic) ?? [])
      stale.delete(topic)
    }
    put({ ...held, lists: next, stale })
  } catch (error) {
    failedRead(error, 'topic lists')
    // The last answer stays; a topic never answered is read on the next mount.
    if (held.pubkey === pubkey) put({ ...held, failed: held.failed || ask.some((topic) => !held.lists.has(topic)) })
  } finally {
    for (const topic of ask) listsReading.delete(topic)
  }
}

/**
 * A topic's list changed in this tab — Add file or Remove on its page (TOP-4):
 * the Topics column reads that topic's list again, in the same tab. Another
 * tab, or somebody else's change, shows on the next read.
 */
export function topicListChanged(topic: string): void {
  if (!held.lists.has(topic)) return
  put({ ...held, stale: new Set(held.stale).add(topic) })
}

/** For tests: forget what this tab has read. */
export function resetTopicsColumn(): void {
  topicsReading = false
  listsReading.clear()
  put(EMPTY)
}

const byTitle = (a: ForeignObject, b: ForeignObject) =>
  (a.slots.title?.value ?? '').localeCompare(b.slots.title?.value ?? '', undefined, { sensitivity: 'base' })

/**
 * **Peek's Topics screen** (TOP-4; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md):
 * the topics you are a member of, each with the files its list holds, one
 * level deep and from any Folder; then every other topic you can read, to
 * open and join. Archived topics are left out (Folders' Archive has them).
 *
 * Reads: every topic you can read (one request), then all your topics' lists
 * at once (`topicLists`, three requests), then the titles of both in one
 * resolve each. A listed file that does not resolve — unreadable, deleted —
 * is not drawn, as the topic's right column does not draw it.
 *
 * `column(address)` is which rail item a file opened by link belongs to:
 * Topics when it is one of your topics or one of them lists it, else Folders;
 * `undefined` until that is known.
 */
export function useTopicsColumn(): {
  state: TopicsColumnState
  column: (address: string) => 'topics' | 'folders' | undefined
  /** Nobody is signed in: nothing is read, and the column says so. */
  signedOut: boolean
} {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  const mineHeld = now.pubkey === pubkey ? now : EMPTY

  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v) return
    if (held.pubkey !== v.token.pubkey) put({ ...EMPTY, pubkey: v.token.pubkey })
    if (Date.now() - held.topicsAt >= FRESH_MS) void readTopics(v)
  }, [viewer, pubkey])

  const topicObjects = useResolvedReferences(mineHeld.topics ?? [])
  const membership = useMembership()
  const live = useMemo(
    () =>
      (mineHeld.topics ?? [])
        .map((address) => topicObjects[address])
        .filter((topic): topic is ForeignObject => !!topic && !topic.archived && !!topic.address)
        .sort(byTitle),
    [mineHeld.topics, topicObjects],
  )
  const topicsResolved = (mineHeld.topics ?? []).every((address) => address in topicObjects)
  const { isMember } = membership
  const mine = useMemo(() => live.filter((topic) => isMember(topic.address!)), [live, isMember])
  const mineKey = mine.map((topic) => topic.address).join(',')

  const { lists, stale } = mineHeld
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !mineKey) return
    const want = mineKey.split(',').filter((topic) => !lists.has(topic) || stale.has(topic))
    if (want.length) void readLists(v, want)
  }, [viewer, mineKey, lists, stale])

  const listed = useMemo(() => [...new Set(mine.flatMap((topic) => lists.get(topic.address!) ?? []))], [mine, lists])
  const fileObjects = useResolvedReferences(listed)

  const state = useMemo<TopicsColumnState>(() => {
    if (mineHeld.failed && mineHeld.topics === null) return { failed: true }
    if (mineHeld.topics === null || membership.state === 'unknown' || !topicsResolved) return 'loading'
    /*
      Loading only until the first answer: after it, a topic just joined is
      drawn at once and its files arrive under it, and a list read again keeps
      its rows, rather than the whole column going back to a skeleton.
    */
    if (mine.length && mine.every((topic) => !lists.has(topic.address!))) return mineHeld.failed ? { failed: true } : 'loading'
    if (listed.length && listed.every((address) => !(address in fileObjects))) return 'loading'
    return {
      mine: mine.map((topic) => ({
        topic,
        files: (lists.get(topic.address!) ?? []).flatMap((address) => (fileObjects[address] ? [fileObjects[address]!] : [])),
      })),
      others: live.filter((topic) => !isMember(topic.address!)),
    }
  }, [mineHeld.failed, mineHeld.topics, membership.state, topicsResolved, mine, lists, listed, fileObjects, live, isMember])

  // Unknown while loading; a failed read cannot say, and Folders draws every file.
  const yours = useMemo(
    () =>
      typeof state !== 'object' ? null : 'failed' in state ? new Set<string>() : new Set(state.mine.flatMap(({ topic, files }) => [topic.address, ...files.map((file) => file.address)])),
    [state],
  )
  const column = useCallback(
    (address: string): 'topics' | 'folders' | undefined => (yours === null ? undefined : yours.has(address) ? 'topics' : 'folders'),
    [yours],
  )

  return { state, column, signedOut: !pubkey }
}
