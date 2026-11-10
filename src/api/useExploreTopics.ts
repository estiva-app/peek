import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { topicActivityAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { topicMemberCountsAsViewer } from '@/nostr/topicMembers'
import { filePath } from '@/lib/objectUrl'
import { useRelayViewer } from './foreign'
import { useFolders } from './useFolderContents'
import { readTopicsAgain, useTopicsColumn, useTopicTimes } from './useTopicsColumn'
import { hasRelay } from './relayUrl'

/** Explore topics' tabs, as Ship's and Leaf's. */
export type ExploreTab = 'all' | 'yours' | 'others' | 'archived'

/** One row on Explore topics: the columns every app's Explore draws (Miky, 6 Nov). */
export interface ExploreRow {
  topic: ForeignObject
  address: string
  title: string
  /** The line under its name; absent, nothing is drawn there. */
  summary?: string
  /** Its page, as the column's row links it. */
  href: string
  /** Its team's name; absent until the teams are read. */
  team?: string
  /** How many people it lists; absent until read, or when that read failed. */
  members?: number
  /** When anything last happened in it, Unix seconds (the shared order rule); absent until read. */
  active?: number
  archived: boolean
  /** You are in it: no Join on it. */
  yours: boolean
}

export type ExploreState = 'loading' | { failed: true } | Record<ExploreTab, ExploreRow[]>

/*
  What Explore has read beside the column, for this tab: each topic's Members
  and Active, read for the tab on screen only and once per page open, so a cold
  open of Peek reads nothing more (the kickoff's load cost, as Ship and Leaf).
*/
interface Facts {
  pubkey: string | undefined
  members: ReadonlyMap<string, number | undefined>
  active: ReadonlyMap<string, number>
}
const NO_FACTS: Facts = { pubkey: undefined, members: new Map(), active: new Map() }
let facts: Facts = NO_FACTS
/** Asked since the page opened (`m:` members, `a:` active), answered or not: a failed one stays blank until the next open. */
const asked = new Set<string>()
const listeners = new Set<() => void>()
function put(next: Facts) {
  facts = next
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => facts

type Viewer = NonNullable<ReturnType<ReturnType<typeof useRelayViewer>>>

async function readMembers(viewer: Viewer, topics: readonly ForeignObject[]) {
  const pubkey = viewer.token.pubkey
  try {
    const counts = await topicMemberCountsAsViewer(
      topics.map((topic) => ({ address: topic.address!, folder: topic.folder ?? '' })),
      viewer.relayUrl,
      viewer.token,
    )
    if (facts.pubkey !== pubkey) return
    put({ ...facts, members: new Map([...facts.members, ...counts]) })
  } catch (error) {
    console.warn('[nostr] topic members read failed:', error)
  }
}

async function readActive(viewer: Viewer, topics: readonly ForeignObject[], createdAt: ReadonlyMap<string, number>) {
  const pubkey = viewer.token.pubkey
  try {
    const addresses = topics.map((topic) => topic.address!)
    const lists = await topicListsAsViewer(addresses, viewer.relayUrl, viewer.token)
    const activity = await topicActivityAsViewer(
      topics.map((topic) => ({
        address: topic.address!,
        createdAt: createdAt.get(topic.address!),
        folder: topic.folder ?? null,
        files: lists.get(topic.address!) ?? [],
      })),
      viewer.relayUrl,
      viewer.token,
    )
    if (facts.pubkey !== pubkey) return
    put({ ...facts, active: new Map([...facts.active, ...activity.at]) })
  } catch (error) {
    console.warn('[nostr] topic activity read failed:', error)
  }
}

/**
 * A topic is found by the start of a word of its title, every word typed, as
 * search is everywhere (Ship's and Leaf's `findsTopic`).
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/search-matches-every-word-as-a-word-start.md
 */
export function findsTopic(title: string, query: string): boolean {
  // Split as the title is, so "q4-pl" finds "Q4-plan".
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const titleWords = title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.every((word) => titleWords.some((titleWord) => titleWord.startsWith(word)))
}

const titleOf = (topic: ForeignObject) => topic.slots.title?.value ?? 'Untitled'

/**
 * **Explore topics** (TOPI-6): every topic you can read, from the Topics
 * column's own read, by tab — All, Other topics and Archived A to Z (Miky,
 * 6 Nov: "like browsing channels in Slack"), Your topics in the column's
 * order. A topic you join is yours as soon as the column hears it, so it
 * moves to Your topics at once (Miky, 10 Nov), and its Members is read again.
 *
 * Reads, beyond the column's: for the tab shown, each topic's Members (one
 * request), and the Active of those that are not yours (their lists, three
 * requests, then their activity); your topics' Active is the column's.
 */
export function useExploreTopics(tab: ExploreTab): { state: ExploreState; retry: () => void } {
  const { state: column } = useTopicsColumn()
  const times = useTopicTimes()
  const { folders } = useFolders()
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const held = useSyncExternalStore(subscribe, snapshot, snapshot)
  const known = held.pubkey === pubkey ? held : NO_FACTS

  // A new page open asks again what failed or is old: Members and Active are read once per open.
  useEffect(() => {
    asked.clear()
    put({ ...NO_FACTS, pubkey })
  }, [pubkey])

  const teamName = useMemo(() => {
    const names = new Map((folders ?? []).map((folder) => [folder.id, folder.name ?? 'Untitled team']))
    return (id: string | undefined) => (id ? names.get(id) : undefined)
  }, [folders])

  const ready = typeof column === 'object' && 'mine' in column ? column : undefined

  // A topic that turns yours while the page is open (a Join here or anywhere) has its people read again.
  const mineBefore = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (!ready) return
    const now = new Set(ready.mine.map((topic) => topic.address!))
    const before = mineBefore.current
    mineBefore.current = now
    if (!before) return
    const joined = ready.mine.filter((topic) => !before.has(topic.address!))
    const v = viewer()
    if (!joined.length || !hasRelay || !v) return
    // Read at once, whichever tab is shown: the row is drawn on Your topics and All from now on.
    for (const topic of joined) asked.add(`m:${topic.address}`)
    void readMembers(v, joined)
  }, [ready, viewer])

  const lists = useMemo((): Record<ExploreTab, ExploreRow[]> | undefined => {
    if (!ready) return undefined
    const yours = new Set(ready.mine.map((topic) => topic.address!))
    const rowOf = (topic: ForeignObject, archived: boolean): ExploreRow => {
      const address = topic.address!
      const title = titleOf(topic)
      const summary = topic.slots.subtitle?.value?.trim()
      const team = teamName(topic.folder)
      const members = known.members.get(address)
      const active = times.yours?.get(address) ?? known.active.get(address)
      return {
        topic,
        address,
        title,
        ...(summary ? { summary } : {}),
        href: filePath(address, topic.slots.title?.value),
        ...(team ? { team } : {}),
        ...(members !== undefined ? { members } : {}),
        ...(active ? { active } : {}),
        archived,
        yours: yours.has(address),
      }
    }
    const byTitle = (a: ExploreRow, b: ExploreRow) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    const mine = ready.mine.map((topic) => rowOf(topic, false))
    const others = ready.others.map((topic) => rowOf(topic, false)).sort(byTitle)
    return {
      all: [...mine, ...others].sort(byTitle),
      yours: mine,
      others,
      archived: ready.archived.map((topic) => rowOf(topic, true)).sort(byTitle),
    }
  }, [ready, teamName, known, times.yours])

  // The tab on screen reads what it lacks: Members for each row, Active for each row that is not yours.
  const shown = lists?.[tab]
  const createdAt = times.createdAt
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !shown || facts.pubkey !== v.token.pubkey) return
    const needMembers = shown.filter((row) => !asked.has(`m:${row.address}`)).map((row) => row.topic)
    const needActive = shown.filter((row) => !row.yours && !asked.has(`a:${row.address}`)).map((row) => row.topic)
    for (const topic of needMembers) asked.add(`m:${topic.address}`)
    for (const topic of needActive) asked.add(`a:${topic.address}`)
    if (needMembers.length) void readMembers(v, needMembers)
    if (needActive.length) void readActive(v, needActive, createdAt)
  }, [viewer, shown, createdAt, held.pubkey])

  const state: ExploreState = column === 'loading' ? 'loading' : 'failed' in column ? { failed: true } : lists ?? 'loading'
  return { state, retry: readTopicsAgain }
}

/** For tests: forget what Explore has read. */
export function resetExploreTopics(): void {
  asked.clear()
  put(NO_FACTS)
}
