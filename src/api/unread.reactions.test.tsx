/**
 * A reaction to your message in a DM (ACT-7): the DM's row lights orange when it is all that is new there, its card
 * lists it, and an urgent DM keeps its urgent mark. The DM's own unread and urgent come from the channel fold, stubbed
 * here; the reactions are the shared rule's (`reactionsToMe`) over events as the relay would hand them.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { REACTIONS_TO_ME_FROM, reactionStreamOf, reactionsToMe } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'
import type { ReactionsToMe } from './useReactionsToMe'

const ME = 'c'.repeat(64)
const KATERINA = 'b'.repeat(64)
const CHANNEL = '0f1e2d3c-4b5a-4968-8776-655443322110'
const NOW = REACTIONS_TO_ME_FROM + 24 * 60 * 60

const state = vi.hoisted(() => ({
  fold: { unread: {} as Record<string, boolean>, urgent: {} as Record<string, boolean>, news: {} as Record<string, unknown[]> },
  merged: {} as Record<string, number>,
  source: undefined as unknown,
}))
vi.mock('./relayUrl', () => ({ hasRelay: true, RELAY_URL: 'wss://relay.test' }))
vi.mock('./internal/dms', () => ({ useDmChannels: () => ({ partners: ['b'.repeat(64)], channelOf: () => '0f1e2d3c-4b5a-4968-8776-655443322110' }) }))
vi.mock('./useTopicUnread', () => ({ useTopicUnread: () => state.fold }))
vi.mock('./useReactionsToMe', () => ({ useReactionsToMe: () => state.source }))
vi.mock('@/nostr/useReadStateSync', () => ({
  useReadFrontier: () => ({ ready: true, marker: (context: string) => state.merged[context], merged: state.merged }),
  recordContainerRead: () => {},
  recordFileRead: () => {},
  recordThreadRead: () => {},
}))

const { useUnread } = await import('./unread')

/** The tab's source as the store publishes it, from the events the relay would hand it. */
function sourceOf(events: SignedEvent[]): ReactionsToMe {
  const targets = new Map(events.filter((event) => event.kind !== 7).map((event) => [event.id, event] as const))
  const list = reactionsToMe(events.filter((event) => event.kind === 7), targets, ME, { nowMs: NOW * 1000 })
  const streamOf = new Map(list.map((reaction) => [reaction.id, reactionStreamOf(targets.get(reaction.target)!)] as const))
  const byContext = new Map<string, typeof list>()
  for (const reaction of list) for (const context of streamOf.get(reaction.id) ?? []) byContext.set(context, [...(byContext.get(context) ?? []), reaction])
  return { ready: true, list, streamOf, targetOf: targets, byContext }
}

const message = signed({ kind: 9, created_at: NOW - 3600, content: 'Sent the draft', tags: [['h', CHANNEL]] }, ME)
const thumbs = signed({ kind: 7, created_at: NOW - 60, content: '👍', tags: [['e', message.id], ['p', ME], ['k', '9'], ['h', CHANNEL]] }, KATERINA)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  state.fold = { unread: {}, urgent: {}, news: {} }
  state.merged = {}
  state.source = sourceOf([message, thumbs])
})

describe('a reaction to your message in a DM (ACT-7)', () => {
  it('alone lights the DM orange, and its card names who reacted with what', () => {
    const { result } = renderHook(() => useUnread())
    expect(result.current.dmHasUnread(KATERINA)).toBe(true)
    expect(result.current.dmTone(KATERINA)).toBe('reaction')
    expect(result.current.dmNews(KATERINA).map((line) => [line.by, line.reaction?.emoji, line.words])).toEqual([[KATERINA, '👍', 'Sent the draft']])
  })

  it('an urgent DM keeps its urgent mark and is not orange, and its card lists the reaction too', () => {
    state.fold = { unread: {}, urgent: { [KATERINA]: true }, news: {} }
    const { result } = renderHook(() => useUnread())
    expect(result.current.dmIsUrgent(KATERINA)).toBe(true)
    expect(result.current.dmTone(KATERINA)).toBe('blue')
    expect(result.current.dmNews(KATERINA).some((line) => line.reaction)).toBe(true)
  })

  it('a new message there keeps one blue dot', () => {
    state.fold = { unread: { [KATERINA]: true }, urgent: {}, news: {} }
    const { result } = renderHook(() => useUnread())
    expect(result.current.dmTone(KATERINA)).toBe('blue')
  })

  it('seen up to that reaction, the DM is dark again', () => {
    state.merged = { [`reactions:${CHANNEL}`]: thumbs.created_at }
    const { result } = renderHook(() => useUnread())
    expect(result.current.dmHasUnread(KATERINA)).toBe(false)
    expect(result.current.dmNews(KATERINA)).toHaveLength(0)
  })
})
