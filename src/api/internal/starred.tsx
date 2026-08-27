import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { STARRED_ENTRIES, type StarredEntry } from '@/data/deskData'
import { useAvatarSrc } from '@/api/avatars'
import { hasConvex } from '@/api/store'
import { useStarsSync } from '@/nostr/useStarsSync'
import type { TopicStateStatus } from '@/components/ui/TopicState'

const entryLabel = (e: StarredEntry) => (e.kind === 'dm' ? e.name : e.title)
const entryKey = (e: StarredEntry) => (e.kind === 'dm' ? `dm:${e.dmId}` : `topic:${e.topicId}`)

interface StarDmInput {
  dmId: string
  name: string
  avatarSrc?: string
}

interface StarTopicInput {
  topicId: string
  title: string
  topicStatus: TopicStateStatus
}

interface StarredContextValue {
  entries: StarredEntry[]
  isDmStarred: (dmId: string) => boolean
  isTopicStarred: (topicId: string) => boolean
  toggleDm: (input: StarDmInput) => void
  toggleTopic: (input: StarTopicInput) => void
  /** True while the Convex stars query is in flight. */
  isLoading: boolean
  /**
   * Stars the relay holds that this deployment does not (CRO-11).
   *
   * The person owns the set, so it lives on the relay as a SPEC §12 blob and
   * Convex renders it. This is what a "restore my stars" affordance would read;
   * it is deliberately not applied automatically — see `useStarsSync`.
   */
  missingLocally: { topics: string[]; people: string[] }
}

const StarredContext = createContext<StarredContextValue | null>(null)

export function StarredProvider({ children }: { children: ReactNode }) {
  const avatarSrcFor = useAvatarSrc()
  // Mock-mode state (full source of truth without a deployment).
  const [mockEntries, setMockEntries] = useState<StarredEntry[]>(STARRED_ENTRIES)
  // Convex-mode optimistic overlay: session toggles applied over the query
  // until it catches up (starred=true carries the entry to render meanwhile).
  const [pending, setPending] = useState<Map<string, { starred: boolean; entry?: StarredEntry }>>(new Map())
  const remote = useQuery(api.desk.starsList, hasConvex ? {} : 'skip')
  const toggleRemote = useMutation(api.desk.toggleStar)
  // Where the relay lives — a query rather than a build-time variable, so the
  // bundle and the backend cannot disagree about it (convex/nostr/config.ts).
  const relayUrl = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')?.relayUrl
  const stars = useStarsSync(relayUrl)

  const rawEntries = useMemo<StarredEntry[]>(() => {
    if (!hasConvex) return mockEntries
    const base: StarredEntry[] = (remote ?? []).map((e) =>
      e.kind === 'dm' ? { ...e, avatarSrc: avatarSrcFor(e.name) } : e,
    )
    const baseKeys = new Set(base.map(entryKey))
    const kept = base.filter((e) => pending.get(entryKey(e))?.starred !== false)
    const added = [...pending.values()]
      .filter((p) => p.starred && p.entry && !baseKeys.has(entryKey(p.entry)))
      .map((p) => p.entry!)
    return [...kept, ...added]
  }, [mockEntries, remote, pending, avatarSrcFor])

  const entries = useMemo(
    () => [...rawEntries].sort((a, b) => entryLabel(a).localeCompare(entryLabel(b), undefined, { sensitivity: 'base' })),
    [rawEntries],
  )

  /*
    Publish the set the person can see, not the toggle that changed it.

    Driving this from the handlers would publish twice per toggle — once
    optimistically and once when the Convex query caught up — and would miss a
    star that arrived from another tab. `starsToPublish` returns undefined for an
    unchanged set, so a re-render costs nothing.

    Mock mode publishes nothing: there is no session and no relay, and a fixture
    is not the person's data.
  */
  useEffect(() => {
    if (!hasConvex) return
    // `remote === undefined` is the query in flight. Publishing then would
    // briefly assert an empty set, which last-write-wins would make permanent.
    if (remote === undefined) return
    void stars.publish({
      topics: rawEntries
        .filter((e): e is Extract<StarredEntry, { kind: 'topic' }> => e.kind === 'topic')
        .map((e) => ({ id: e.topicId })),
      people: rawEntries
        .filter((e): e is Extract<StarredEntry, { kind: 'dm' }> => e.kind === 'dm')
        .map((e) => ({ key: e.dmId })),
    })
  }, [rawEntries, remote, stars])

  const missingLocally = useMemo(() => {
    const missing = stars.restoreFromRelay(
      rawEntries.filter((e) => e.kind === 'topic').map((e) => (e as Extract<StarredEntry, { kind: 'topic' }>).topicId),
      rawEntries.filter((e) => e.kind === 'dm').map((e) => (e as Extract<StarredEntry, { kind: 'dm' }>).dmId),
    )
    return { topics: missing.topics.map((t) => t.id), people: missing.people.map((p) => p.key) }
  }, [stars, rawEntries])

  const isDmStarred = useCallback(
    (dmId: string) => rawEntries.some((e) => e.kind === 'dm' && e.dmId === dmId),
    [rawEntries],
  )

  const isTopicStarred = useCallback(
    (topicId: string) => rawEntries.some((e) => e.kind === 'topic' && e.topicId === topicId),
    [rawEntries],
  )

  const toggleDm = useCallback(({ dmId, name, avatarSrc }: StarDmInput) => {
    if (!hasConvex) {
      setMockEntries((prev) => {
        const exists = prev.some((e) => e.kind === 'dm' && e.dmId === dmId)
        if (exists) return prev.filter((e) => !(e.kind === 'dm' && e.dmId === dmId))
        return [...prev, { id: `star_dm_${dmId}`, kind: 'dm', dmId, name, avatarSrc }]
      })
      return
    }
    const key = `dm:${dmId}`
    const currentlyStarred = rawEntries.some((e) => e.kind === 'dm' && e.dmId === dmId)
    setPending((prev) => {
      const next = new Map(prev)
      next.set(key, {
        starred: !currentlyStarred,
        entry: { id: `star_dm_${dmId}`, kind: 'dm', dmId, name, avatarSrc: avatarSrc ?? avatarSrcFor(name) },
      })
      return next
    })
    void toggleRemote({ kind: 'dm', targetKey: dmId })
  }, [rawEntries, toggleRemote, avatarSrcFor])

  const toggleTopic = useCallback(({ topicId, title, topicStatus }: StarTopicInput) => {
    if (!hasConvex) {
      setMockEntries((prev) => {
        const exists = prev.some((e) => e.kind === 'topic' && e.topicId === topicId)
        if (exists) return prev.filter((e) => !(e.kind === 'topic' && e.topicId === topicId))
        return [...prev, { id: `star_topic_${topicId}`, kind: 'topic', topicId, title, topicStatus }]
      })
      return
    }
    const key = `topic:${topicId}`
    const currentlyStarred = rawEntries.some((e) => e.kind === 'topic' && e.topicId === topicId)
    setPending((prev) => {
      const next = new Map(prev)
      next.set(key, {
        starred: !currentlyStarred,
        entry: { id: `star_topic_${topicId}`, kind: 'topic', topicId, title, topicStatus },
      })
      return next
    })
    void toggleRemote({ kind: 'topic', targetKey: topicId })
  }, [rawEntries, toggleRemote])

  const isLoading = hasConvex && remote === undefined

  return (
    <StarredContext.Provider
      value={{ entries, isDmStarred, isTopicStarred, toggleDm, toggleTopic, isLoading, missingLocally }}
    >
      {children}
    </StarredContext.Provider>
  )
}

export function useStarred() {
  const ctx = useContext(StarredContext)
  if (!ctx) throw new Error('useStarred must be used inside StarredProvider')
  return ctx
}
