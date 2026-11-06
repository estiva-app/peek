import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { isArchived, type ForeignObject } from '@estiva-app/interop'
import { resolveObjectAsViewer, topicAddressesAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useMembership } from '@/api/internal/membership'
import { fetchMemberOf } from '@/nostr/fileMembers'
import { useRelayViewer, useResolvedReferences } from './foreign'
import { hasRelay } from './relayUrl'

/** One of your topics on the Topics screen, with the files its list holds. */
export interface TopicWithFiles {
  topic: ForeignObject
  /** In the order they were added, as the topic's right column draws them (TOP-3). Only what is not archived. */
  files: ForeignObject[]
  /** The files it lists that are archived, on their own or with a file above them, in the same order: behind its "Archived" line. */
  archivedFiles: ForeignObject[]
}

export type TopicsColumnState =
  | 'loading'
  | { failed: true }
  | {
      /** The topics you are a member of, A–Z, each with its files. */
      mine: TopicWithFiles[]
      /** Every other topic you can read, A–Z, title only: to open and join. */
      others: ForeignObject[]
      /** Every archived topic you can read, on its own or with a file above it, A–Z: the closed "Archived" section. */
      archived: ForeignObject[]
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
  /** Files read again after an Archive or Unarchive in this tab, drawn over the column's first answer. */
  rearchived: ReadonlyMap<string, ForeignObject | null>
  /**
   * Topics the membership read has no word on, read over all history: whether
   * you are a member. Nothing older than its horizon changes, so an answer is
   * kept for the tab.
   */
  past: ReadonlyMap<string, boolean>
  /** Topics whose past read failed: drawn as the membership read has them, and asked again on the next mount. */
  pastFailed: ReadonlySet<string>
}

const FRESH_MS = 60_000
const EMPTY: Held = {
  pubkey: undefined,
  topics: null,
  topicsAt: 0,
  failed: false,
  lists: new Map(),
  stale: new Set(),
  rearchived: new Map(),
  past: new Map(),
  pastFailed: new Set(),
}
let held: Held = EMPTY
/** Who the column last read as, so an archive made elsewhere in the tab can be read again for it. */
let lastViewer: Viewer | null = null
/** How many re-reads `fileArchiveChanged` has asked for each file. */
const rearchiveAsked = new Map<string, number>()
const listeners = new Set<() => void>()
let topicsReading = false
const listsReading = new Set<string>()
const pastReading = new Set<string>()

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

async function readPast(viewer: Viewer, topics: readonly string[]) {
  const pubkey = viewer.token.pubkey
  // Per viewer: a read still out for whoever was signed in before must not hold back the next one's.
  const ask = topics.filter((topic) => !pastReading.has(`${pubkey}:${topic}`))
  if (!ask.length) return
  for (const topic of ask) pastReading.add(`${pubkey}:${topic}`)
  try {
    const members = await fetchMemberOf({ relayUrl: viewer.relayUrl, accessToken: viewer.token.accessToken, pubkey }, ask)
    if (!members) throw new Error('the relay did not answer')
    if (held.pubkey !== pubkey) return
    const past = new Map(held.past)
    for (const topic of ask) past.set(topic, members.has(topic))
    put({ ...held, past })
  } catch (error) {
    failedRead(error, 'topic memberships')
    if (held.pubkey === pubkey) put({ ...held, pastFailed: new Set([...held.pastFailed, ...ask]) })
  } finally {
    for (const topic of ask) pastReading.delete(`${pubkey}:${topic}`)
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

/**
 * A file was archived or unarchived in this tab — from a row's menu, its page
 * or a toast's Undo (b1ace226): the column reads it again, archived-with
 * included, so a topic moves to or from "Archived", and a listed file leaves or
 * rejoins its topic, without a reload. Archiving a topic's parent moves the
 * topic on the next read.
 */
export async function fileArchiveChanged(address: string): Promise<void> {
  const viewer = lastViewer
  if (!hasRelay || !viewer || held.pubkey !== viewer.token.pubkey) return
  // Archive then Undo at once: only the last re-read is drawn, whichever answers first.
  const asked = (rearchiveAsked.get(address) ?? 0) + 1
  rearchiveAsked.set(address, asked)
  const object = await resolveObjectAsViewer(address, viewer.relayUrl, viewer.token, { archivedWith: true }).catch(() => undefined)
  if (object === undefined || held.pubkey !== viewer.token.pubkey || rearchiveAsked.get(address) !== asked) return
  put({ ...held, rearchived: new Map(held.rearchived).set(address, object) })
}

/** For tests: forget what this tab has read. */
export function resetTopicsColumn(): void {
  topicsReading = false
  listsReading.clear()
  pastReading.clear()
  lastViewer = null
  rearchiveAsked.clear()
  put(EMPTY)
}

const ARCHIVED_WITH = { archivedWith: true }

const byTitle = (a: ForeignObject, b: ForeignObject) =>
  (a.slots.title?.value ?? '').localeCompare(b.slots.title?.value ?? '', undefined, { sensitivity: 'base' })

/**
 * **Peek's Topics screen** (TOP-4; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md):
 * the topics you are a member of, each with the files its list holds, one
 * level deep and from any Folder; then every other topic you can read, to
 * open and join. Only what is active (Miky, 2 Nov, b1ace226): a topic or a
 * listed file archived on its own or with a file above it (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md)
 * is left out of the list: the archived topics are the closed "Archived"
 * section at the end, and a topic's archived files are behind one "Archived"
 * line under it, which opens them in a dialog (Miky, 2 Nov: "it should not
 * distract you, you should have options to access it").
 *
 * Reads: every topic you can read (one request), then all your topics' lists
 * at once (`topicLists`, three requests), then the titles of both in one
 * resolve each. A listed file that does not resolve — unreadable, deleted —
 * is not drawn, as the topic's right column does not draw it.
 *
 * Which topics are yours is judged as the topic's page judges it, over all
 * history (Miky, 2 Nov, 7525c414): the membership read is bounded by the
 * horizon the dots are judged over, so a topic it has no word on — joined
 * long ago, nothing since — is asked about once more, all such topics in one
 * request. The dots stay on the membership read.
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
  const { pubkey, mineHeld, topicsResolved, objectOf, live, archived } = useReadableTopicsHeld()
  const membership = useMembership()
  const { isMember, judges } = membership
  const known = membership.state !== 'unknown'
  const { past, pastFailed } = mineHeld
  // The topics the membership read has no word on: whether they are yours is read over all history.
  const unheardKey = useMemo(
    () => (known ? live.filter((topic) => !judges(topic.address!) && !isMember(topic.address!)).map((topic) => topic.address!) : []).join(','),
    [known, live, judges, isMember],
  )
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !unheardKey) return
    const want = unheardKey.split(',').filter((topic) => !past.has(topic) && !pastFailed.has(topic))
    if (want.length) void readPast(v, want)
  }, [viewer, unheardKey, past, pastFailed])
  const pastUnread = !!unheardKey && unheardKey.split(',').every((topic) => !past.has(topic) && !pastFailed.has(topic))
  const isYours = useCallback(
    (address: string) => isMember(address) || (!judges(address) && past.get(address) === true),
    [isMember, judges, past],
  )
  const mine = useMemo(() => live.filter((topic) => isYours(topic.address!)), [live, isYours])
  const mineKey = mine.map((topic) => topic.address).join(',')

  const { lists, stale } = mineHeld
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !mineKey) return
    const want = mineKey.split(',').filter((topic) => !lists.has(topic) || stale.has(topic))
    if (want.length) void readLists(v, want)
  }, [viewer, mineKey, lists, stale])

  const listed = useMemo(() => [...new Set(mine.flatMap((topic) => lists.get(topic.address!) ?? []))], [mine, lists])
  // An issue of an archived project is archived with it: left out under its topic, as an archived topic is.
  const fileObjects = useResolvedReferences(listed, ARCHIVED_WITH)

  const state = useMemo<TopicsColumnState>(() => {
    if (mineHeld.failed && mineHeld.topics === null) return { failed: true }
    if (mineHeld.topics === null || !known || !topicsResolved || pastUnread) return 'loading'
    /*
      Loading only until the first answer: after it, a topic just joined is
      drawn at once and its files arrive under it, and a list read again keeps
      its rows, rather than the whole column going back to a skeleton.
    */
    if (mine.length && mine.every((topic) => !lists.has(topic.address!))) return mineHeld.failed ? { failed: true } : 'loading'
    if (listed.length && listed.every((address) => !(address in fileObjects))) return 'loading'
    return {
      mine: mine.map((topic) => {
        const listedFiles = (lists.get(topic.address!) ?? []).flatMap((address) => {
          const file = objectOf(address, fileObjects)
          return file ? [file] : []
        })
        return { topic, files: listedFiles.filter((file) => !isArchived(file)), archivedFiles: listedFiles.filter((file) => isArchived(file)) }
      }),
      others: live.filter((topic) => !isYours(topic.address!)),
      archived,
    }
  }, [mineHeld.failed, mineHeld.topics, known, topicsResolved, pastUnread, mine, lists, listed, fileObjects, objectOf, live, archived, isYours])

  // Unknown while loading; a failed read cannot say, and Folders draws every file.
  const yours = useMemo(
    () =>
      typeof state !== 'object' ? null : 'failed' in state ? new Set<string>() : new Set(state.mine.flatMap(({ topic, files, archivedFiles }) => [topic.address, ...[...files, ...archivedFiles].map((file) => file.address)])),
    [state],
  )
  const column = useCallback(
    (address: string): 'topics' | 'folders' | undefined => (yours === null ? undefined : yours.has(address) ? 'topics' : 'folders'),
    [yours],
  )

  return { state, column, signedOut: !pubkey }
}

/**
 * Every active topic this viewer can read, with its title — and nothing about
 * the files the topics list. For a screen that names topics but not their
 * files (Peek's Teams column, TEA-5): it is ready once the topics resolve, and
 * it never waits for, or starts, the read of every listed file's fields, which
 * is the Topics screen's heaviest read (44 MB on QA-1's workspace, 6 Nov).
 * Shares the Topics screen's held topics, so neither reads them twice.
 */
export function useReadableTopics(): {
  topics: ForeignObject[]
  /** The topics' first answer has not come back yet. */
  loading: boolean
  failed: boolean
  signedOut: boolean
} {
  const { pubkey, mineHeld, topicsResolved, live } = useReadableTopicsHeld()
  const failed = mineHeld.failed && mineHeld.topics === null
  return { topics: live, loading: !failed && (mineHeld.topics === null || !topicsResolved), failed, signedOut: !pubkey }
}

/** The part both hooks share: the topics read (once per `FRESH_MS`), each resolved, archived ones apart. */
function useReadableTopicsHeld() {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  const mineHeld = now.pubkey === pubkey ? now : EMPTY

  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v) return
    lastViewer = v
    if (held.pubkey !== v.token.pubkey) put({ ...EMPTY, pubkey: v.token.pubkey })
    if (held.pastFailed.size) put({ ...held, pastFailed: new Set() })
    if (Date.now() - held.topicsAt >= FRESH_MS) void readTopics(v)
  }, [viewer, pubkey])

  // `archivedWith`: a topic under an archived project is archived with it, and its own `archived` does not say so.
  const topicObjects = useResolvedReferences(mineHeld.topics ?? [], ARCHIVED_WITH)
  const { rearchived } = mineHeld
  const objectOf = useCallback(
    (address: string, objects: Record<string, ForeignObject | null>) => (rearchived.has(address) ? rearchived.get(address) : objects[address]),
    [rearchived],
  )
  const readable = useMemo(
    () =>
      (mineHeld.topics ?? [])
        .map((address) => objectOf(address, topicObjects))
        .filter((topic): topic is ForeignObject => !!topic && !!topic.address)
        .sort(byTitle),
    [mineHeld.topics, topicObjects, objectOf],
  )
  const live = useMemo(() => readable.filter((topic) => !isArchived(topic)), [readable])
  const archived = useMemo(() => readable.filter((topic) => isArchived(topic)), [readable])
  const topicsResolved = (mineHeld.topics ?? []).every((address) => address in topicObjects)
  return { pubkey, mineHeld, topicsResolved, objectOf, live, archived }
}
