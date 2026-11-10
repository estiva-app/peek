/**
 * Explore topics' Members (TOPI-6): how many people each topic lists, every
 * topic in one relay read. What the relay answers for one topic's people must
 * never count on another's, though the read asks for both at once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLevelChange, placeFilters } from '@estiva-app/conversation'

const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const AUTHOR = 'a'.repeat(64)
const ALICE = 'c'.repeat(64)
const BOB = 'd'.repeat(64)
const TEAM = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const TOPIC_A = `30840:${AUTHOR}:topic-a`
const TOPIC_B = `30840:${AUTHOR}:topic-b`

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }
const relay = vi.hoisted(() => ({ events: [] as Event[], ok: true, asked: [] as Record<string, unknown>[][] }))

/** A relay answering each filter as NIP-01 reads one: kinds, authors and `#x` tags. */
function answers(event: Event, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const wanted = value as unknown[]
    if (key === 'kinds') return wanted.includes(event.kind)
    if (key === 'authors') return wanted.includes(event.pubkey)
    if (key.startsWith('#')) return event.tags.some((tag) => tag[0] === key.slice(1) && wanted.includes(tag[1]))
    return true
  })
}
vi.mock('./bridge', () => ({
  queryRelay: async (_url: string, filters: Record<string, unknown>[]) => {
    relay.asked.push(filters)
    if (!relay.ok) return { ok: false, events: [], reason: 'busy' }
    return { ok: true, events: relay.events.filter((event) => filters.some((filter) => answers(event, filter))) }
  },
}))

const { topicMemberCountsAsViewer } = await import('./topicMembers')

let seq = 0
const levelOn = (pubkey: string, place: string) => ({
  ...buildLevelChange(pubkey, 1_700_000_000_000 + seq * 1000, { place, folder: TEAM, level: 'all' }),
  pubkey,
  id: String(++seq).padStart(64, '0'),
  sig: '0'.repeat(128),
})
const token = { accessToken: 't', pubkey: VIEWER } as never
const topic = (address: string) => ({ address, folder: TEAM })

beforeEach(() => {
  relay.events = []
  relay.ok = true
  relay.asked = []
})

describe('topicMemberCountsAsViewer (Explore topics’ Members)', () => {
  it('counts each topic’s own people only, though one read asks for every topic', async () => {
    relay.events = [levelOn(ALICE, TOPIC_A), levelOn(BOB, TOPIC_A)]
    const counts = await topicMemberCountsAsViewer([topic(TOPIC_A), topic(TOPIC_B)], 'https://relay.test', token)
    // The two who chose a level on A; nobody on B, though the read brought A's changes back for both.
    expect(counts.get(TOPIC_A)).toBe(2)
    expect(counts.get(TOPIC_B)).toBe(0)
    expect(relay.asked).toHaveLength(1)
  })

  it('asks the relay for no more filters than one topic does, however many topics', async () => {
    await topicMemberCountsAsViewer([topic(TOPIC_A), topic(TOPIC_B)], 'https://relay.test', token)
    const one = placeFilters({ address: TOPIC_A, team: TEAM }, VIEWER).filter((filter) => !(filter.kinds as number[]).includes(30078))
    expect(relay.asked[0]!.length).toBe(one.length)
  })

  it('throws when the relay refuses, so a failed read is never drawn as nobody', async () => {
    relay.ok = false
    await expect(topicMemberCountsAsViewer([topic(TOPIC_A)], 'https://relay.test', token)).rejects.toThrow()
  })
})
