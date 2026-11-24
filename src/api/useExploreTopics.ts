import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { topicActivityAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { topicMembersAsViewer } from '@/nostr/topicMembers'
import { filePath } from '@/lib/objectUrl'
import { launcherMatch } from '@/lib/launcherSearch'
import { useRelayViewer, workspaceKeys } from './foreign'
import { useFolders } from './useFolderContents'
import { readTopicsAgain, useTopicsColumn, useTopicTimes } from './useTopicsColumn'
import { initiativesOf } from './initiatives'
import { useTeams } from './useTeams'
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
  /** Who they are, by key, in the listing's order: the members pill's faces (Katerina, 17 November). Absent until read. */
  people?: readonly string[]
  /** When anything last happened in it, Unix seconds (the shared order rule); absent until read. */
  active?: number
  archived: boolean
  /** You are in it: no Join on it. */
  yours: boolean
}

export type ExploreState = 'loading' | 'signedOut' | { failed: true } | Record<ExploreTab, ExploreRow[]>

/*
  What Explore has read beside the column, for this tab: each topic's Members
  and Active, read for the tab on screen only and once per page open, so a cold
  open of Peek reads nothing more (the kickoff's load cost, as Ship and Leaf).
*/
interface Facts {
  pubkey: string | undefined
  members: ReadonlyMap<string, number | undefined>
  /** Who each lists, by key: the faces beside the number (17 November). */
  people: ReadonlyMap<string, readonly string[]>
  active: ReadonlyMap<string, number>
}
const NO_FACTS: Facts = { pubkey: undefined, members: new Map(), people: new Map(), active: new Map() }
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
    // Everyone with a profile: a topic's members are the changes naming one of them (SPEC §11.8). None read is a failed read.
    const people = await workspaceKeys(viewer.relayUrl, viewer.token)
    if (!people) throw new Error('the people directory could not be read')
    const lists = await topicMembersAsViewer(
      topics.map((topic) => ({ address: topic.address!, folder: topic.folder ?? '' })),
      viewer.relayUrl,
      viewer.token,
      people,
    )
    if (facts.pubkey !== pubkey) return
    const counts = [...lists].map(([address, people]): [string, number | undefined] => [address, people?.length])
    const known = [...lists].flatMap(([address, people]): [string, readonly string[]][] => (people ? [[address, people]] : []))
    put({ ...facts, members: new Map([...facts.members, ...counts]), people: new Map([...facts.people, ...known]) })
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
  // The launcher's one rule, so a quoted phrase or a minus word means the same here.
  return launcherMatch(title, query)
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
  // Initiatives only: a space is a team's topic now, under its team in Teams (Katerina, 16 November, Q-01 A).
  const { state: topics, signedOut } = useTopicsColumn()
  const { teams, failed: teamsFailed } = useTeams()
  const column = useMemo(() => initiativesOf(topics, teams, teamsFailed), [topics, teams, teamsFailed])
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

  // A topic that turns yours or stops being yours while the page is open (a Join or Leave here or anywhere) has its people read again.
  const mineBefore = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (!ready) return
    const now = new Set(ready.mine.map((topic) => topic.address!))
    const before = mineBefore.current
    mineBefore.current = now
    if (!before) return
    const changed = [...ready.mine, ...ready.others].filter((topic) => now.has(topic.address!) !== before.has(topic.address!))
    const v = viewer()
    if (!changed.length || !hasRelay || !v) return
    // Read at once, whichever tab is shown: the row moves between tabs with it.
    for (const topic of changed) asked.add(`m:${topic.address}`)
    void readMembers(v, changed)
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
      const people = known.people.get(address)
      const active = times.yours?.get(address) ?? known.active.get(address)
      return {
        topic,
        address,
        title,
        ...(summary ? { summary } : {}),
        href: filePath(address, topic.slots.title?.value) ?? '#',
        ...(team ? { team } : {}),
        ...(members !== undefined ? { members } : {}),
        ...(people ? { people } : {}),
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

  const state: ExploreState = signedOut ? 'signedOut' : column === 'loading' ? 'loading' : 'failed' in column ? { failed: true } : lists ?? 'loading'
  return { state, retry: readTopicsAgain }
}

/**
 * Who is in some topics and when each was last active, read as Explore reads them and kept with Explore's, read again
 * each time the page asking opens or its list changes (B-05, B-08): a team's page lists its topics and initiatives with
 * Explore's facts (Katerina, 16 November, TP-09). Who is counted is Explore's and a place's own pill's: people at All or
 * Important (Q-31). A topic of yours takes the column's time, with no read of its own.
 */
export function useTopicFacts(topics: readonly ForeignObject[]): {
  members: ReadonlyMap<string, number | undefined>
  /** Who each lists, by key, in the listing's order: the members pill's faces (17 November). */
  people: ReadonlyMap<string, readonly string[]>
  active: ReadonlyMap<string, number>
} {
  const times = useTopicTimes()
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const held = useSyncExternalStore(subscribe, snapshot, snapshot)
  const known = held.pubkey === pubkey ? held : NO_FACTS
  const key = topics.map((topic) => topic.address).join(',')
  // What the read takes, as it is when the list changes: the column's times change with every message, the list does not.
  const now = useRef({ topics, yours: times.yours, createdAt: times.createdAt })
  // Before the read below: effects run in order, so it reads them as they are now.
  useEffect(() => {
    now.current = { topics, yours: times.yours, createdAt: times.createdAt }
  })
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !key) return
    if (facts.pubkey !== v.token.pubkey) put({ ...NO_FACTS, pubkey: v.token.pubkey })
    const { topics: list, yours, createdAt } = now.current
    for (const topic of list) asked.add(`m:${topic.address}`)
    void readMembers(v, list)
    const needActive = list.filter((topic) => !yours?.has(topic.address!))
    for (const topic of needActive) asked.add(`a:${topic.address}`)
    if (needActive.length) void readActive(v, needActive, createdAt)
  }, [viewer, key])
  const yours = times.yours
  const active = useMemo(() => new Map([...known.active, ...(yours ?? [])]), [known.active, yours])
  return { members: known.members, people: known.people, active }
}

/** For tests: forget what Explore has read. */
export function resetExploreTopics(): void {
  asked.clear()
  put(NO_FACTS)
}
