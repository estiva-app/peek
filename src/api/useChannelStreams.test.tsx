import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { SignedEvent } from '@estiva-app/protocol'

/*
  The binding end to end — the real store, the real cadence, the real hook —
  with the edges faked: the relay's `POST /query` (counted, because the request
  is what the relay meters), the socket, and the viewer. The store's own rules
  are `channelStore.test.ts`'s; this is what Peek wires around them.
*/
const relay = vi.hoisted(() => ({
  events: [] as SignedEvent[],
  posts: [] as Record<string, unknown>[][],
  refuse: [] as string[],
}))
vi.mock('@/nostr/bridge', () => ({
  queryRelay: async (_url: string, filters: Record<string, unknown>[]) => {
    relay.posts.push(filters)
    const refusal = relay.refuse.shift()
    if (refusal) return { ok: false, events: [], reason: refusal }
    const events = filters.flatMap((filter) =>
      relay.events.filter(
        (event) =>
          (filter['#h'] as string[]).includes(event.tags.find((t) => t[0] === 'h')![1]) &&
          event.created_at >= (filter.since as number),
      ),
    )
    return { ok: true, events }
  },
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: viewer.pubkey, accessToken: 't' }), storedToken: () => ({ pubkey: viewer.pubkey, accessToken: 't' }) }))
const viewer = vi.hoisted(() => ({ pubkey: 'c'.repeat(64) }))
vi.mock('./foreign', () => {
  // Stable per viewer: a fresh function per render re-runs every effect.
  const byPubkey = new Map<string, () => unknown>()
  return {
    useRelayViewer: () => {
      const key = viewer.pubkey
      if (!byPubkey.has(key)) {
        byPubkey.set(key, () => ({ relayUrl: 'https://relay.test', token: { pubkey: key, accessToken: 't' } }))
      }
      return byPubkey.get(key)
    },
  }
})
const socket = vi.hoisted(() => ({
  state: 'live' as string,
  stateListeners: new Set<(state: string) => void>(),
  watches: [] as { channels: string[]; since?: number; kinds?: readonly number[]; stopped: boolean }[],
  deliver: undefined as ((channel: string, event?: SignedEvent) => void) | undefined,
}))
vi.mock('@/nostr/useLiveClient', () => {
  const client = {
    state: () => socket.state,
    onState: (listener: (state: string) => void) => {
      socket.stateListeners.add(listener)
      return () => socket.stateListeners.delete(listener)
    },
    watchChannels: (
      channels: readonly string[],
      listener: (channel: string, event?: SignedEvent) => void,
      options?: { kinds?: readonly number[]; since?: number },
    ) => {
      const entry = { channels: [...channels], since: options?.since, kinds: options?.kinds, stopped: false }
      socket.watches.push(entry)
      socket.deliver = listener
      return { stop: () => void (entry.stopped = true) }
    },
  }
  return { useLiveClient: () => ({ live: client, relayState: socket.state }) }
})

import { relayBudget } from '@/nostr/relayBudget'
import { CATCH_UP_MS, LOOKBACK_SECONDS, RESYNC_MS, resetChannelStreamsForTests, useChannelStreams } from './useChannelStreams'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const NOW = Math.floor(Date.now() / 1000)

let serial = 0
function said(channel: string, at: number): SignedEvent {
  serial += 1
  return { id: `m${serial}`, kind: 9, pubkey: 'd'.repeat(64), created_at: at, tags: [['h', channel]], content: '', sig: '' }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

/** The team column and the topics column, mounted together as the sidebar does. */
function sidebar(team: string[], topics: string[]) {
  return renderHook(() => ({ team: useChannelStreams(team), topics: useChannelStreams(topics) }))
}

beforeEach(() => {
  relay.events = [said(A, NOW - 3600), said(C, NOW - 60)]
  relay.posts = []
  relay.refuse = []
  socket.state = 'live'
  socket.stateListeners.clear()
  socket.watches = []
  socket.deliver = undefined
  viewer.pubkey = 'c'.repeat(64)
  setVisibility('visible')
})
afterEach(() => {
  resetChannelStreamsForTests()
  // A refusal a test provoked is the tab's pause now (PER-13), and the next
  // test's first read would wait it out.
  relayBudget.reset()
  vi.useRealTimers()
})

describe('useChannelStreams', () => {
  it('reads both columns’ channels in one request, and answers nothing before it lands', async () => {
    const { result } = sidebar([A, B], [B, C])
    expect(result.current.team.streams).toEqual({})

    await waitFor(() => expect(Object.keys(result.current.topics.streams).sort()).toEqual([B, C]))
    expect(relay.posts).toHaveLength(1)
    expect(relay.posts[0].map((filter) => (filter['#h'] as string[])[0]).sort()).toEqual([A, B, C])
    expect(result.current.team.streams[A].map((m) => m.at)).toEqual([NOW - 3600])
    expect(result.current.team.streams[B]).toEqual([])
  })

  it('watches the union once, both message kinds, bounded by the lookback', async () => {
    sidebar([A, B], [B, C])
    await waitFor(() => expect(socket.watches.filter((w) => !w.stopped)).toHaveLength(1))
    const [watch] = socket.watches.filter((w) => !w.stopped)
    expect(watch.channels).toEqual([A, B, C])
    expect(watch.kinds).toEqual([9, 1111])
    expect(watch.since).toBeGreaterThanOrEqual(NOW - LOOKBACK_SECONDS - 1)
  })

  it('shows what the socket delivers without asking the relay again', async () => {
    const { result } = sidebar([A], [C])
    await waitFor(() => expect(result.current.team.streams[A]).toBeDefined())
    const posts = relay.posts.length

    act(() => socket.deliver?.(A, said(A, NOW)))
    expect(result.current.team.streams[A].map((m) => m.at)).toEqual([NOW - 3600, NOW])
    expect(relay.posts).toHaveLength(posts)
  })

  it('catches up from the cursor when the socket comes back, not over the horizon', async () => {
    socket.state = 'connecting'
    const { result } = sidebar([A], [])
    await waitFor(() => expect(result.current.team.streams[A]).toBeDefined())

    act(() => {
      socket.state = 'live'
      for (const listener of socket.stateListeners) listener('live')
    })
    await waitFor(() => expect(relay.posts).toHaveLength(2))
    expect(relay.posts[1][0].since).toBeGreaterThanOrEqual(NOW - LOOKBACK_SECONDS - 1)
  })

  it('catches up on the minute and resyncs on the five while visible, and neither while hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = sidebar([A], [])
    await waitFor(() => expect(result.current.team.streams[A]).toBeDefined())
    expect(relay.posts).toHaveLength(1)

    await act(() => vi.advanceTimersByTimeAsync(CATCH_UP_MS))
    expect(relay.posts).toHaveLength(2)
    expect(relay.posts[1][0].since).toBeGreaterThan(NOW - 24 * 60 * 60)

    setVisibility('hidden')
    await act(() => vi.advanceTimersByTimeAsync(RESYNC_MS))
    expect(relay.posts).toHaveLength(2)

    setVisibility('visible')
    await act(() => vi.advanceTimersByTimeAsync(RESYNC_MS))
    const horizonRead = relay.posts.find((post, i) => i > 1 && (post[0].since as number) < NOW - 24 * 60 * 60)
    expect(horizonRead).toBeDefined()
  })

  it('waits out a quota refusal at the second the relay named', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    relay.refuse = ['rate-limited: quota exceeded; retry in 8s']
    const { result } = sidebar([A], [])
    await act(() => vi.advanceTimersByTimeAsync(7_000))
    expect(result.current.team.streams[A]).toBeUndefined()

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    await waitFor(() => expect(result.current.team.streams[A]).toBeDefined())
    expect(relay.posts).toHaveLength(2)
  })

  it('gives another viewer a store of their own', async () => {
    const first = sidebar([A], [])
    await waitFor(() => expect(first.result.current.team.streams[A]).toBeDefined())
    first.unmount()

    viewer.pubkey = 'e'.repeat(64)
    const second = sidebar([A], [])
    await waitFor(() => expect(second.result.current.team.streams[A]).toBeDefined())
    expect(relay.posts).toHaveLength(2)
    expect(socket.watches[0].stopped).toBe(true)
  })
})
