/**
 * The Desk reads the listed files' news of its own topics only (ACT-9; Miky, 11 Nov: the Desk grows only by that
 * read), and not a topic the Topics column already holds in this tab.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'

const TOPIC_A = '30840:aa:topic-a'
const TOPIC_B = '30840:aa:topic-b'
const PAGE = '30842:bb:page-1'
const COMMENT = { id: 'c-1', pubkey: 'qa2', created_at: 1_700_000_000, kind: 1111, content: 'Totals moved', tags: [['A', PAGE]], sig: '' }

const relay = vi.hoisted(() => ({
  listsAsked: [] as string[][],
  activityAsked: [] as string[][],
  column: new Map<string, unknown>(),
}))

vi.mock('@/nostr/foreign', () => ({
  topicListsAsViewer: async (topics: string[]) => {
    relay.listsAsked.push([...topics])
    return new Map(topics.map((topic) => [topic, topic === TOPIC_A ? [{ address: PAGE, folder: 'team' }] : []]))
  },
  topicActivityAsViewer: async (topics: { address: string; files: { address: string }[] }[]) => {
    relay.activityAsked.push(topics.map((topic) => topic.address))
    return { at: new Map(), comments: new Map([[PAGE, [COMMENT]]]), parents: new Map() }
  },
}))
vi.mock('@/nostr/liveTopics', () => ({ getLiveClient: () => null }))
vi.mock('@/api/internal/membership', () => ({ useMembership: () => ({ namedComments: [] }) }))
vi.mock('./foreign', () => ({ useRelayViewer: () => () => ({ relayUrl: 'wss://relay', token: { pubkey: 'qa1' } }) }))
vi.mock('./relayUrl', () => ({ hasRelay: true }))
vi.mock('./useTopicsColumn', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./useTopicsColumn')),
  useListedNews: () => relay.column,
}))

const topic = (address: string) => ({ address, ref: address, folder: 'team', kind: 30840 }) as unknown as ForeignObject

beforeEach(() => {
  relay.listsAsked = []
  relay.activityAsked = []
  relay.column = new Map()
})

describe('the Desk’s topics’ listed news (ACT-9)', () => {
  it('reads the lists and comments of the Desk’s own topics, and folds a listed page’s comment under its topic', async () => {
    const { useDeskListedNews } = await import('./deskListedNews')
    const topics = [topic(TOPIC_A)]
    const { result } = renderHook(() => useDeskListedNews(topics))
    await waitFor(() => expect(result.current.get(TOPIC_A)).toBeTruthy())
    expect(relay.listsAsked).toEqual([[TOPIC_A]])
    expect(result.current.get(TOPIC_A)).toEqual([{ file: PAGE, events: [COMMENT] }])
  })

  it('does not read a topic the Topics column already holds: its news is the column’s', async () => {
    const held = [{ file: PAGE, events: [] }]
    relay.column = new Map([[TOPIC_B, held]])
    const { useDeskListedNews } = await import('./deskListedNews')
    const topics = [topic(TOPIC_A), topic(TOPIC_B)]
    const { result } = renderHook(() => useDeskListedNews(topics))
    await waitFor(() => expect(result.current.get(TOPIC_A)).toBeTruthy())
    expect(relay.listsAsked).toEqual([[TOPIC_A]])
    expect(relay.activityAsked).toEqual([[TOPIC_A]])
    expect(result.current.get(TOPIC_B)).toBe(held)
  })
})
