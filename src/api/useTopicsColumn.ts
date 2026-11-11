import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { byActivity, isArchived, relayNamesTeams, watchTopicActivity, type ActivityFile, type ActivityWatch, type ForeignObject, type TopicActivity } from '@estiva-app/interop'
import { fileIdOf, type SignedEvent } from '@estiva-app/protocol'
import { anchorIdsOf, anchorsOf } from '@estiva-app/conversation'
import { resolveObjectAsViewer, topicActivityAsViewer, topicAddressesAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { getLiveClient } from '@/nostr/liveTopics'
import { peekRelay } from '@/nostr/relayInfo'
import { readTopicOrder, writeTopicOrder } from '@/lib/topicOrder'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useMembership } from '@/api/internal/membership'
import { fetchChangesNaming } from '@/nostr/fileMembers'
import { useRelayViewer, useResolvedReferences } from './foreign'
import { topicFollowingOf, type ListedNews } from './placeDots'
import { hasRelay } from './relayUrl'

export type TopicsColumnState =
  | 'loading'
  | { failed: true }
  | {
      /**
       * The topics you are a member of, one flat list, newest activity first
       * (TOPI-10): no files under them.
       */
      mine: ForeignObject[]
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
  /** Each topic's root time, Unix seconds: its time in the order while nothing has happened in it. */
  createdAt: ReadonlyMap<string, number>
  topicsAt: number
  failed: boolean
  /** Each of your topics' listed files, with each file's team: what the order judges a change on it by. */
  lists: ReadonlyMap<string, readonly ActivityFile[]>
  /**
   * Each of your topics' newest activity, Unix seconds (TOPI-10): the read for
   * `key` (the topics and their lists it was read over), raised since by the
   * live watch while `live`. `null` before the first answer.
   */
  activity: {
    key: string
    at: ReadonlyMap<string, number>
    /**
     * Each file a topic lists directly, by address: the comments about it the read already fetched to time its
     * topics (its newest one or few), and every new one the watch hears (TOPI-3). What a topic's dot judges at All,
     * with no read of its own (`useListedNews`).
     */
    comments: ReadonlyMap<string, readonly SignedEvent[]>
    /**
     * Each file found under a listed one, by address: the file it sits directly under (ACT-2). What tells a listed
     * project's issue, whose comments naming the viewer light the topic, from a page two levels down.
     */
    parents: ReadonlyMap<string, string>
    readAt: number
    live: boolean
  } | null
  /** The `key` whose activity read failed: drawn in the order this browser last saw, and asked again on the next mount. */
  activityFailed: string | null
  /** The times this browser last drew the topics in, for the first draw: no skeleton while the order is read again. */
  stored: ReadonlyMap<string, number>
  /** Lists to read again: an Add file or Remove on the topic, or an old answer. */
  stale: ReadonlySet<string>
  /** Files read again after an Archive or Unarchive in this tab, drawn over the column's first answer. */
  rearchived: ReadonlyMap<string, ForeignObject | null>
  /**
   * Topics the membership read has no word on, read over all history: the
   * changes naming you on each, for the shared following fold. Nothing older
   * than its horizon changes, so an answer is kept for the tab.
   */
  past: ReadonlyMap<string, readonly SignedEvent[]>
  /** Topics whose past read failed: drawn as the membership read has them, and asked again on the next mount. */
  pastFailed: ReadonlySet<string>
}

const FRESH_MS = 60_000
const EMPTY: Held = {
  pubkey: undefined,
  topics: null,
  createdAt: new Map(),
  topicsAt: 0,
  failed: false,
  lists: new Map(),
  activity: null,
  activityFailed: null,
  stored: new Map(),
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
/** The activity `key` being read now, if any. */
let activityReading: string | null = null
/**
 * The last activity answer, kept current in place by its live watch: one
 * watch per tab, open while any mount wants the order (`watchUsers`), so the
 * column and the file page beside it share it.
 */
let current: { key: string; activity: TopicActivity; since: number; relayUrl: string; watch: ActivityWatch | null } | null = null
let watchUsers = 0


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
    const createdAt = await topicAddressesAsViewer(viewer.relayUrl, viewer.token)
    // Every list held is from before this answer: each is read again, still drawn meanwhile.
    if (held.pubkey === pubkey) put({ ...held, topics: [...createdAt.keys()], createdAt, topicsAt: Date.now(), failed: false, stale: new Set(held.lists.keys()) })
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
    const changes = await fetchChangesNaming({ relayUrl: viewer.relayUrl, accessToken: viewer.token.accessToken, pubkey }, ask)
    if (!changes) throw new Error('the relay did not answer')
    if (held.pubkey !== pubkey) return
    const past = new Map(held.past)
    for (const topic of ask) past.set(topic, changes.filter((change) => change.tags.some((t) => t[0] === 'a' && t[1] === topic)))
    put({ ...held, past })
  } catch (error) {
    failedRead(error, 'topic memberships')
    if (held.pubkey === pubkey) put({ ...held, pastFailed: new Set([...held.pastFailed, ...ask]) })
  } finally {
    for (const topic of ask) pastReading.delete(`${pubkey}:${topic}`)
  }
}

/**
 * Your topics' newest activity (TOPI-10): one read over every topic and the
 * files it lists, then the live watch keeps it current while a mount wants it.
 */
async function readActivity(viewer: Viewer, key: string, topics: readonly ForeignObject[]) {
  if (activityReading === key) return
  activityReading = key
  const pubkey = viewer.token.pubkey
  // Heard from when the read was asked, so nothing written while it was out is missed.
  const since = Math.floor(Date.now() / 1000)
  try {
    const activity = await topicActivityAsViewer(
      topics.map((topic) => ({
        address: topic.address!,
        createdAt: held.createdAt.get(topic.address!),
        // Its team from its root: a change to it counts only there, and the watch names it.
        folder: topic.folder ?? null,
        files: held.lists.get(topic.address!) ?? [],
      })),
      viewer.relayUrl,
      viewer.token,
    )
    if (held.pubkey !== pubkey || activityReading !== key) return
    stopWatch()
    current = { key, activity, since, relayUrl: viewer.relayUrl, watch: null }
    startWatch()
    put({
      ...held,
      activity: { key, at: new Map(activity.at), comments: commentsOf(activity), parents: parentsOf(activity), readAt: Date.now(), live: !!current.watch },
      activityFailed: null,
    })
    writeTopicOrder(pubkey, activity.at)
  } catch (error) {
    failedRead(error, 'topic activity')
    if (held.pubkey === pubkey && activityReading === key) put({ ...held, activityFailed: key })
  } finally {
    if (activityReading === key) activityReading = null
  }
}

/** Open the live watch over the last answer, when a mount wants it and none is open. */
function startWatch() {
  if (!current || current.watch || watchUsers === 0) return
  const client = getLiveClient(current.relayUrl)
  if (!client) return
  const { key, activity } = current
  const pubkey = held.pubkey
  current.watch = watchTopicActivity(
    client.relay,
    activity,
    () => {
      if (current?.key !== key || held.pubkey !== pubkey || held.activity?.key !== key) return
      // A new file under a listed one moves its topic: the watch has recorded its parent, and listens to it from now on.
      put({ ...held, activity: { ...held.activity, at: new Map(activity.at), parents: parentsOf(activity, held.activity.parents) } })
      if (pubkey) writeTopicOrder(pubkey, activity.at)
    },
    // Asks by file alone on a relay that says it sends a kept-open request what asking again would return
    // (ours), so a comment filed in a team the topic does not name still re-sorts it live.
    // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-request-kept-open-hears-what-asking-again-would-return.md
    {
      since: current.since,
      namesTeams: relayNamesTeams(peekRelay()),
      onClosed: (reason) => console.warn('[nostr] topic activity watch closed:', reason),
      // A new comment on a listed file or one level under, whether or not it moved its topic: the topic's dot judges it (TOPI-3, ACT-2).
      onComment: () => {
        if (current?.key !== key || held.pubkey !== pubkey || held.activity?.key !== key) return
        put({ ...held, activity: { ...held.activity, comments: commentsOf(activity), parents: parentsOf(activity, held.activity.parents) } })
      },
    },
  )
}

/** The watch appends to `activity.comments` in place: a copy, so what is held changes when it does. */
const commentsOf = (activity: TopicActivity): ReadonlyMap<string, readonly SignedEvent[]> =>
  new Map([...(activity.comments ?? new Map<string, SignedEvent[]>())].map(([file, events]) => [file, [...events]]))

/**
 * The watch adds to `activity.parents` in place too: a copy, likewise. It only ever adds, so the copy `held` stands
 * while the count is the same, and a message that moves a topic does not judge every topic's files again.
 */
const parentsOf = (activity: TopicActivity, held?: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
  held && held.size === (activity.parents?.size ?? 0) ? held : new Map(activity.parents ?? [])

function stopWatch() {
  current?.watch?.stop()
  if (current) current.watch = null
}

/**
 * A mount that draws the order: the watch stays open while there is one. With
 * none left it closes, and the order held is no longer current: the next
 * mount reads it again, drawing it meanwhile.
 */
function wantActivity(): () => void {
  watchUsers++
  startWatch()
  if (current?.watch && held.activity?.key === current.key && !held.activity.live) put({ ...held, activity: { ...held.activity, live: true } })
  return () => {
    watchUsers--
    if (watchUsers > 0) return
    stopWatch()
    current = null
    /*
      Not drawn differently, so no one is told. Old at once (`readAt: 0`):
      nothing keeps it current now, so the next mount reads it again and opens
      a new watch, however soon it comes — even back within a minute.
    */
    if (held.activity) held = { ...held, activity: { ...held.activity, live: false, readAt: 0 } }
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
 * included, so a topic moves to or from "Archived", and a listed file to or
 * from its topic Overview's "Archived" line ({@link useRearchived}), without a
 * reload. Archiving a topic's parent moves the topic on the next read.
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

/**
 * The files read again after an Archive or Unarchive in this tab
 * ({@link fileArchiveChanged}), to draw over an older held answer: a topic's
 * Overview moves a listed file to or from its Archived line with them.
 */
export function useRearchived(): ReadonlyMap<string, ForeignObject | null> {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  return now.pubkey === pubkey ? now.rearchived : EMPTY.rearchived
}

/**
 * What each of your topics' listed files has said lately, by topic address (TOPI-3, ACT-2): every file its list
 * holds directly, and every file one level under one of those (`under`: a listed project's issue, a listed
 * document's page), each with the comments the Topics column's read and its live watch hold for it and the comments
 * naming you the membership read holds on it (yours, and those tagging you). What a topic's dot judges
 * (`listedHaveUnread`). No read of its own: it is what `useTopicsColumn` and the membership read already hold,
 * empty until the column has read.
 */
export function useListedNews(): ReadonlyMap<string, ListedNews> {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  const { namedComments } = useMembership()
  const mine = now.pubkey === pubkey
  const lists = now.lists
  const comments = now.activity?.comments
  const parents = now.activity?.parents
  return useMemo(
    () => (mine && comments ? listedNewsOf(lists, comments, parents, namedComments) : new Map<string, ListedNews>()),
    [mine, lists, comments, parents, namedComments],
  )
}

/**
 * Each topic's listed files and the files one level under them, with the comments held on each and those naming
 * you: what a topic's dot judges (`listedHaveUnread`). Pure, so the Topics column and the Desk's own read of its
 * topics (`useDeskListedNews`, ACT-9) fold the same way.
 */
export function listedNewsOf(
  lists: ReadonlyMap<string, readonly ActivityFile[]>,
  comments: ReadonlyMap<string, readonly SignedEvent[]>,
  parents: ReadonlyMap<string, string> | undefined,
  namedComments: readonly SignedEvent[] | undefined,
): Map<string, ListedNews> {
    const news = new Map<string, ListedNews>()
    const named = namedByFile(namedComments ?? [])
    const eventsOn = (file: string) => merged(comments.get(file) ?? [], [...(named.get(file) ?? []), ...(named.get(fileIdOf(file) ?? '') ?? [])])
    // Each file found under a listed one, by the file it sits directly under.
    const children = new Map<string, string[]>()
    for (const [file, parent] of parents ?? []) {
      const list = children.get(parent)
      if (list) list.push(file)
      else children.set(parent, [file])
    }
    for (const [topic, files] of lists) {
      const listed = new Set(files.map((file) => file.address))
      const under = [...listed].flatMap((parent) => (children.get(parent) ?? []).filter((file) => !listed.has(file)))
      news.set(topic, [
        ...[...listed].map((file) => ({ file, events: eventsOn(file) })),
        ...[...new Set(under)].map((file) => ({ file, events: eventsOn(file), under: true })),
      ])
    }
    return news
}

/** The watch appends to `activity.comments` and `parents` in place: copies, for a fold that must see them change. */
export const activityCommentsOf = commentsOf
export const activityParentsOf = (activity: TopicActivity) => parentsOf(activity)

/** The comments naming the viewer, by what they are on: the file's address and its id, as the shared rule reads a comment's file (§6.4). */
function namedByFile(named: readonly SignedEvent[]): ReadonlyMap<string, readonly SignedEvent[]> {
  const byFile = new Map<string, SignedEvent[]>()
  for (const event of named) {
    for (const key of new Set([...anchorsOf(event), ...anchorIdsOf(event)])) {
      const list = byFile.get(key)
      if (list) list.push(event)
      else byFile.set(key, [event])
    }
  }
  return byFile
}

/** Both lists as one, each comment once, oldest first. */
function merged(held: readonly SignedEvent[], named: readonly SignedEvent[]): readonly SignedEvent[] {
  if (named.length === 0) return held
  const byId = new Map<string, SignedEvent>()
  for (const event of [...held, ...named]) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
}

/**
 * What the column already holds about each topic's time (TOPI-6), for Explore
 * topics: your topics' newest activity, Unix seconds, `undefined` until read;
 * and every readable topic's root time, what a topic's activity falls back to.
 * No read of its own.
 */
export function useTopicTimes(): { yours: ReadonlyMap<string, number> | undefined; createdAt: ReadonlyMap<string, number> } {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const now = useSyncExternalStore(subscribe, snapshot, snapshot)
  const mine = now.pubkey === pubkey
  return { yours: mine ? now.activity?.at : undefined, createdAt: mine ? now.createdAt : EMPTY.createdAt }
}

/** Explore topics' Try again (TOPI-6): read every topic you can read again now, as a mount a minute later would. */
export function readTopicsAgain(): void {
  if (lastViewer) void readTopics(lastViewer)
}

/** For tests: forget what this tab has read. */
export function resetTopicsColumn(): void {
  topicsReading = false
  listsReading.clear()
  pastReading.clear()
  lastViewer = null
  rearchiveAsked.clear()
  activityReading = null
  stopWatch()
  current = null
  watchUsers = 0
  put(EMPTY)
}

/*
  Roots only (ALO-14): both screens draw a topic's title, summary and archive,
  never its comments or children — Topics reads its lists itself (`readLists`).
  The whole read asked three filters a topic, and on QA-1's 25 topics those
  were the 128-filter reads Teams' own waited behind.
*/
const TOPIC_READ = { archivedWith: true, roots: true }

const byTitle = (a: ForeignObject, b: ForeignObject) =>
  (a.slots.title?.value ?? '').localeCompare(b.slots.title?.value ?? '', undefined, { sensitivity: 'base' })

/** What the activity was read over: your topics and the files each lists. A topic joined or a file added reads it again. */
const activityKeyOf = (topics: readonly ForeignObject[], lists: ReadonlyMap<string, readonly ActivityFile[]>) =>
  topics
    .map((topic) => `${topic.address}=${(lists.get(topic.address!) ?? []).map((file) => file.address).join(',')}`)
    .sort()
    .join(';')

/**
 * **Peek's Topics screen** (TOP-4, TOPI-10): the topics you are a member of,
 * one flat list, newest activity first, with no files under them (Miky, 3 and
 * 6 Nov); then every other topic you can read, to open and join. Only what is
 * active (Miky, 2 Nov, b1ace226): a topic archived on its own or with a file
 * above it (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md)
 * is in the closed "Archived" section at the end; a topic's archived files are
 * at the end of its Overview.
 *
 * The order is interop's shared rule (`readTopicActivity`; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/each-file-on-a-topic-keeps-its-own-place-and-look.md):
 * where anything last happened, deep — a message, a file added, a change or a
 * comment on a listed file or a file under one — never a rename, a join or
 * arranging. Kept current live (`watchTopicActivity`, one subscription per
 * tab), and drawn at once in the order this browser last saw while it is read
 * again.
 *
 * Reads: every topic you can read (one request), then all your topics' lists
 * at once (`topicLists`, three requests), the topics' titles in one resolve,
 * then the order (about seven requests, whatever the number of topics).
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
  const { viewer, pubkey, mineHeld, topicsResolved, live, archived } = useReadableTopicsHeld()
  const membership = useMembership()
  const { me, changesOf, floor, termsOf } = membership
  const known = membership.state !== 'unknown'
  const { past, pastFailed } = mineHeld
  /*
    The membership read has a word on you in a topic when a change naming you
    on it is inside its horizon, or you made it: the newest change decides, so
    nothing older can change the answer.
  */
  const heard = useCallback((address: string) => address.split(':')[1] === me || changesOf(address).length > 0, [me, changesOf])
  // The topics the membership read has no word on: whether they are yours is read over all history.
  const unheardKey = useMemo(
    () => (known ? live.filter((topic) => !heard(topic.address!)).map((topic) => topic.address!) : []).join(','),
    [known, live, heard],
  )
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !unheardKey) return
    const want = unheardKey.split(',').filter((topic) => !past.has(topic) && !pastFailed.has(topic))
    if (want.length) void readPast(v, want)
  }, [viewer, unheardKey, past, pastFailed])
  const pastUnread = !!unheardKey && unheardKey.split(',').every((topic) => !past.has(topic) && !pastFailed.has(topic))
  /*
    Yours is the shared rule Ship's Topics reads too (interop's `following.in`,
    TEA-6): made, joined, added or a level chosen since your last leave;
    writing in it is not following it, and a topic you muted is not yours, as
    the switch shows a mute as Not following. A space's team default is not
    read here, as Ship's is not. Decided by Miky, 6 Nov, so the two apps agree
    from the day the switch ships.
    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/writing-in-a-place-never-follows-it.md
  */
  const isYours = useCallback(
    (topic: ForeignObject) => {
      const address = topic.address!
      if (!me || termsOf(address).muted) return false
      const old = !heard(address)
      const changes = old ? past.get(address) : changesOf(address)
      if (!changes) return false
      return topicFollowingOf({ address, folder: topic.folder ?? '', me, changes, floor: old ? 0 : floor }).in
    },
    [me, termsOf, heard, past, changesOf, floor],
  )
  const mine = useMemo(() => live.filter((topic) => isYours(topic)), [live, isYours])
  const mineKey = mine.map((topic) => topic.address).join(',')

  const { lists, stale } = mineHeld
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !mineKey) return
    const want = mineKey.split(',').filter((topic) => !lists.has(topic) || stale.has(topic))
    if (want.length) void readLists(v, want)
  }, [viewer, mineKey, lists, stale])

  /*
    The order (TOPI-10): read once every topic of yours has its list, since a
    change to a listed file counts; again when a topic is joined or a file
    added, or on a mount after the watch closed. Kept current live meanwhile.
  */
  const { activity, activityFailed, stored, createdAt } = mineHeld
  const activityKey = mine.length > 0 && mine.every((topic) => lists.has(topic.address!)) ? activityKeyOf(mine, lists) : ''
  useEffect(() => wantActivity(), [])
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !activityKey || activityFailed === activityKey) return
    const current = activity?.key === activityKey && (activity.live || Date.now() - activity.readAt < FRESH_MS)
    // The same key is the same read: one already out, or answered and current, is not asked again.
    if (!current) void readActivity(v, activityKey, mine)
  }, [viewer, activityKey, activity, activityFailed, mine])

  const ordered = useMemo(() => {
    // The read's answer; before it, what this browser drew last; for a topic neither knows, its own time.
    const at = new Map(mine.map((topic) => [topic.address!, activity?.at.get(topic.address!) ?? stored.get(topic.address!) ?? createdAt.get(topic.address!) ?? 0]))
    const order = byActivity(at)
    return [...mine].sort((a, b) => order(a.address!, b.address!))
  }, [mine, activity, stored, createdAt])
  // Nothing to draw the order by until the read answers: the first time on this browser, a skeleton rather than a jump.
  const orderUnknown = mine.length > 0 && !activity && activityFailed !== activityKey && mine.every((topic) => !stored.has(topic.address!))

  const state = useMemo<TopicsColumnState>(() => {
    if (mineHeld.failed && mineHeld.topics === null) return { failed: true }
    if (mineHeld.topics === null || !known || !topicsResolved || pastUnread) return 'loading'
    /*
      Loading only until the first answer: after it, a topic just joined is
      drawn at once, and a list read again keeps the rows, rather than the
      whole column going back to a skeleton.
    */
    if (mine.length && mine.every((topic) => !lists.has(topic.address!))) return mineHeld.failed ? { failed: true } : 'loading'
    if (orderUnknown) return 'loading'
    return { mine: ordered, others: live.filter((topic) => !isYours(topic)), archived }
  }, [mineHeld.failed, mineHeld.topics, known, topicsResolved, pastUnread, mine, lists, orderUnknown, ordered, live, archived, isYours])

  // Unknown while loading; a failed read cannot say, and Folders draws every file.
  const yours = useMemo(
    () =>
      typeof state !== 'object'
        ? null
        : 'failed' in state
          ? new Set<string>()
          : new Set(state.mine.flatMap((topic) => [topic.address, ...(lists.get(topic.address!) ?? []).map((file) => file.address)])),
    [state, lists],
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
    if (held.pubkey !== v.token.pubkey) {
      // Somebody else's order is not theirs to hear: the watch closes, and the next read is the new viewer's.
      stopWatch()
      current = null
      activityReading = null
      put({ ...EMPTY, pubkey: v.token.pubkey, stored: readTopicOrder(v.token.pubkey) })
    }
    if (held.pastFailed.size || held.activityFailed) put({ ...held, pastFailed: new Set(), activityFailed: null })
    if (Date.now() - held.topicsAt >= FRESH_MS) void readTopics(v)
  }, [viewer, pubkey])

  // `archivedWith`: a topic under an archived project is archived with it, and its own `archived` does not say so.
  const topicObjects = useResolvedReferences(mineHeld.topics ?? [], TOPIC_READ)
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
  return { viewer, pubkey, mineHeld, topicsResolved, objectOf, live, archived }
}
