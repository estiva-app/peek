import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { TOPICS, type Topic, type ConversationData } from '@/data/topicData'
import { TOPIC_HUDDLES, type Huddle } from '@/data/huddleData'
import { DM_CONVERSATIONS } from '@/data/dmData'
import { mockConvIdFor } from '@/api/directory'
import type { Person } from '@/data/peopleData'

interface CreateTopicFromDmInput {
  title: string
  dmId: string
  dmName: string
  invitees: Person[]
  /** The DM message id that triggered the promotion. Used to render the huddle anchor above this specific message. */
  seedMessageId: string
}

interface CreateTopicFromDmResult {
  topicId: string
  huddleId: string
  promotedAt: string
}

interface TopicStoreValue {
  /** All topics (static + runtime). */
  topics: Topic[]
  /** Runtime-created topics only — merged over the Convex list to cover the
   *  optimistic window until the create round-trip lands. */
  extraTopics: Topic[]
  /** Resolve huddles for a topic (static + runtime). */
  getHuddlesForTopic: (topicId: string) => Huddle[]
  /** Runtime-created huddles only (DM promotions) — merged over the Convex
   *  list to cover the optimistic window. */
  getExtraHuddlesForTopic: (topicId: string) => Huddle[]
  /** Runtime-only variant of findAllHuddlesByOriginDm (optimistic window). */
  findExtraHuddlesByOriginDm: (dmId: string) => Huddle[]
  /** Look up a topic by id. */
  findTopic: (topicId: string) => Topic | undefined
  /** Find the huddle that was promoted from the given DM (searches static + runtime). Returns the first match if multiple exist. */
  findHuddleByOriginDm: (dmId: string) => Huddle | undefined
  /** Find every huddle that was promoted from the given DM (searches static + runtime). */
  findAllHuddlesByOriginDm: (dmId: string) => Huddle[]
  /** Promote a DM into the first huddle of a freshly created topic. Returns the new topic id. */
  createTopicFromDm: (input: CreateTopicFromDmInput) => CreateTopicFromDmResult
  /** Create a standalone empty topic (no huddle). Returns its id. */
  createTopic: (title: string, invitees: string[]) => string
  /** Deleted topic ids — full source of truth in mock mode; the optimistic
   *  window over the Convex list otherwise (QA #2.8). */
  deletedTopicIds: Set<string>
  deleteTopicLocal: (topicId: string) => void
  /** Renamed titles by topic id — the mock source of truth, and the optimistic
   *  window over the Convex list otherwise, exactly like `deletedTopicIds`
   *  (PEE-2). Without it the sidebar keeps the old name until the query
   *  catches up, which is the one place a rename must look instant. */
  renameTopicLocal: (topicId: string, title: string) => void
  /** Add invitee names to a runtime topic (mock-mode Invite members). */
  addInviteesLocal: (topicId: string, names: string[]) => void
}

const TopicStoreContext = createContext<TopicStoreValue | null>(null)

let topicSeq = 0
function nextTopicId() {
  return `t_${Date.now()}_${++topicSeq}`
}

let huddleSeq = 0
function nextHuddleId() {
  return `h_${Date.now()}_${++huddleSeq}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatPromotedAt(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function formatLastActivity(d: Date): string {
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function formatTime(d: Date): string {
  const hh = d.getHours()
  const mm = d.getMinutes()
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 || 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
}

function findDmMessageById(dmId: string, messageId: string): ConversationData | undefined {
  // The mock fixture is keyed by legacy conversation numbers (§2.4).
  const convId = mockConvIdFor(dmId)
  const groups = convId === undefined ? undefined : DM_CONVERSATIONS[convId]
  if (!groups) return undefined
  for (const g of groups) {
    const found = g.convs.find((c) => c.id === messageId)
    if (found) return found
  }
  return undefined
}

/**
 * Gives every part below it the list of topics and their huddles, including
 * topics created, renamed or deleted in this session.
 */
export function TopicStoreProvider({ children }: { children: ReactNode }) {
  const [extraTopics, setExtraTopics] = useState<Topic[]>([])
  const [extraHuddles, setExtraHuddles] = useState<Record<string, Huddle[]>>({})
  const [deletedTopicIds, setDeletedTopicIds] = useState<Set<string>>(new Set())

  const [renamedTitles, setRenamedTitles] = useState<Map<string, string>>(new Map())

  const topics = useMemo(
    () =>
      [...TOPICS, ...extraTopics]
        .filter((t) => !deletedTopicIds.has(t.id))
        .map((t) => (renamedTitles.has(t.id) ? { ...t, title: renamedTitles.get(t.id)! } : t)),
    [extraTopics, deletedTopicIds, renamedTitles],
  )

  const deleteTopicLocal = useCallback((topicId: string) => {
    setDeletedTopicIds((prev) => new Set([...prev, topicId]))
  }, [])

  const renameTopicLocal = useCallback((topicId: string, title: string) => {
    setRenamedTitles((prev) => new Map(prev).set(topicId, title))
  }, [])

  const addInviteesLocal = useCallback((topicId: string, names: string[]) => {
    setExtraTopics((prev) =>
      prev.map((t) =>
        t.id === topicId
          ? { ...t, invitees: [...new Set([...(t.invitees ?? []), ...names])] }
          : t,
      ),
    )
  }, [])

  const findTopic = useCallback(
    (topicId: string) => topics.find((t) => t.id === topicId),
    [topics],
  )

  const getHuddlesForTopic = useCallback(
    (topicId: string) => [...(TOPIC_HUDDLES[topicId] ?? []), ...(extraHuddles[topicId] ?? [])],
    [extraHuddles],
  )

  const getExtraHuddlesForTopic = useCallback(
    (topicId: string) => extraHuddles[topicId] ?? [],
    [extraHuddles],
  )

  const findExtraHuddlesByOriginDm = useCallback(
    (dmId: string): Huddle[] => {
      const result: Huddle[] = []
      for (const huddles of Object.values(extraHuddles)) {
        for (const h of huddles) {
          if (h.originDmId === dmId) result.push(h)
        }
      }
      return result
    },
    [extraHuddles],
  )

  const findAllHuddlesByOriginDm = useCallback(
    (dmId: string): Huddle[] => {
      const result: Huddle[] = []
      for (const huddles of Object.values(extraHuddles)) {
        for (const h of huddles) {
          if (h.originDmId === dmId) result.push(h)
        }
      }
      for (const huddles of Object.values(TOPIC_HUDDLES)) {
        for (const h of huddles) {
          if (h.originDmId === dmId) result.push(h)
        }
      }
      return result
    },
    [extraHuddles],
  )

  const findHuddleByOriginDm = useCallback(
    (dmId: string): Huddle | undefined => findAllHuddlesByOriginDm(dmId)[0],
    [findAllHuddlesByOriginDm],
  )

  const createTopicFromDm = useCallback(
    ({ title, dmId, dmName, invitees, seedMessageId }: CreateTopicFromDmInput): CreateTopicFromDmResult => {
      const topicId = nextTopicId()
      const huddleId = nextHuddleId()
      const now = new Date()
      const promotedAt = formatPromotedAt(now)
      const lastActivity = formatLastActivity(now)

      const newTopic: Topic = {
        id: topicId,
        title,
        isResolved: false,
        invitees: ['You', ...invitees.map((p) => p.name)],
      }

      const huddleMembers = ['You', dmName]

      // Use the *seed* DM message (the one that triggered promotion) as the huddle
      // card preview, so the card represents the actual conversation being promoted
      // — not whatever happens to be the latest DM message at promotion time.
      const seedDm = findDmMessageById(dmId, seedMessageId)
      const previewConversation: ConversationData = seedDm ?? {
        id: `${huddleId}_origin`,
        authorName: 'You',
        timestamp: formatTime(now),
        body: 'No messages yet.',
        replyCount: 0,
      }

      const newHuddle: Huddle = {
        id: huddleId,
        topicId,
        members: huddleMembers,
        state: 'active',
        lastActivity,
        originDmId: dmId,
        promotedAt,
        promotedAtMs: now.getTime(),
        seedMessageId,
        conversation: previewConversation,
      }

      setExtraTopics((prev) => [...prev, newTopic])
      setExtraHuddles((prev) => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), newHuddle] }))

      return { topicId, huddleId, promotedAt }
    },
    [],
  )

  const createTopic = useCallback((title: string, invitees: string[]): string => {
    const topicId = nextTopicId()
    setExtraTopics((prev) => [
      ...prev,
      { id: topicId, title, isResolved: false, invitees: ['You', ...invitees] },
    ])
    return topicId
  }, [])

  const value = useMemo<TopicStoreValue>(
    () => ({ topics, extraTopics, getHuddlesForTopic, getExtraHuddlesForTopic, findTopic, findHuddleByOriginDm, findAllHuddlesByOriginDm, findExtraHuddlesByOriginDm, createTopicFromDm, createTopic, deletedTopicIds, deleteTopicLocal, renameTopicLocal, addInviteesLocal }),
    [topics, extraTopics, getHuddlesForTopic, getExtraHuddlesForTopic, findTopic, findHuddleByOriginDm, findAllHuddlesByOriginDm, findExtraHuddlesByOriginDm, createTopicFromDm, createTopic, deletedTopicIds, deleteTopicLocal, renameTopicLocal, addInviteesLocal],
  )

  return <TopicStoreContext.Provider value={value}>{children}</TopicStoreContext.Provider>
}

export function useTopicStore(): TopicStoreValue {
  const ctx = useContext(TopicStoreContext)
  if (!ctx) throw new Error('useTopicStore must be used within TopicStoreProvider')
  return ctx
}
