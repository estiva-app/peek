import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StreamMessage } from '@/nostr/channelStreams'

/*
  The same seams `useTeamUnread.test.tsx` pins, for the same reason: the
  judging is `topicUnread.test.ts`'s, how messages are read and kept is
  `useChannelStreams.test.tsx`'s, and this is the hook's contract — one store
  call for the listed topics' channels, a topic with no channel never asked
  about, nothing judged before the frontier has landed, and a dot that goes out
  when the frontier moves.
*/
const store = vi.hoisted(() => ({
  asked: [] as string[][],
  streams: {} as Record<string, StreamMessage[]>,
  at: 0,
  version: 0,
  listeners: new Set<() => void>(),
}))
vi.mock('./useChannelStreams', async () => {
  const { useSyncExternalStore, useMemo, useEffect } = await import('react')
  return {
    useChannelStreams: (channels: readonly string[]) => {
      const key = channels.join(',')
      useEffect(() => {
        store.asked.push(key ? key.split(',') : [])
      }, [key])
      const version = useSyncExternalStore(
        (listener) => {
          store.listeners.add(listener)
          return () => store.listeners.delete(listener)
        },
        () => store.version,
      )
      return useMemo(() => {
        const streams: Record<string, StreamMessage[]> = {}
        for (const channel of key ? key.split(',') : []) {
          if (store.streams[channel]) streams[channel] = store.streams[channel]
        }
        return { at: store.at, streams }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key, version])
    },
  }
})
const frontier = vi.hoisted(() => ({
  ready: false,
  markers: {} as Record<string, number>,
  version: 0,
  listeners: new Set<() => void>(),
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
vi.mock('@/nostr/useReadStateSync', async () => {
  const { useSyncExternalStore, useMemo } = await import('react')
  return {
    useReadFrontier: () => {
      const version = useSyncExternalStore(
        (listener) => {
          frontier.listeners.add(listener)
          return () => frontier.listeners.delete(listener)
        },
        () => frontier.version,
      )
      return useMemo(
        () => ({
          marker: (context: string | undefined) => (context ? frontier.markers[context] : undefined),
          ready: frontier.ready,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version],
      )
    },
  }
})

import { useTopicUnread } from './useTopicUnread'

const CHANNEL_A = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-8222-222222222222'
const THEM = 'd'.repeat(64)
const NOW = Math.floor(Date.now() / 1000)

const topics = [
  { id: 't_a', folderId: CHANNEL_A },
  { id: 't_b', folderId: CHANNEL_B },
]

const said = (id: string, at: number, urgent = false): StreamMessage => ({
  body: '',
  id,
  at,
  by: THEM,
  root: id,
  about: [],
  urgent,
})

function advance(markers: Record<string, number>, ready = true) {
  act(() => {
    frontier.markers = { ...frontier.markers, ...markers }
    frontier.ready = ready
    frontier.version++
    for (const listener of frontier.listeners) listener()
  })
}

/** The store answering — its first read landing, or the socket delivering. */
function hold(streams: Record<string, StreamMessage[]>) {
  act(() => {
    store.streams = streams
    store.at = NOW
    store.version++
    for (const listener of store.listeners) listener()
  })
}

// A: an ordinary message an hour ago, nobody has read it. B: nothing.
const HELD = { [CHANNEL_A]: [said('m', NOW - 3600)], [CHANNEL_B]: [] }

beforeEach(() => {
  frontier.ready = false
  frontier.markers = {}
  store.asked = []
  store.streams = {}
  store.at = 0
})
afterEach(() => {
  frontier.listeners.clear()
  store.listeners.clear()
})

describe('useTopicUnread', () => {
  it('asks the store for every listed channel at once, keyed back to the topic id', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold(HELD)
    expect(store.asked).toEqual([[CHANNEL_A, CHANNEL_B]])

    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))
    expect(result.current.unread.t_b).toBe(false)
    expect(result.current.urgent.t_a).toBe(false)
  })

  it('judges nothing until the frontier has landed — absent markers would light everything', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold(HELD)
    expect(result.current.unread).toEqual({})
    expect(result.current.urgent).toEqual({})
  })

  it('judges nothing for a channel the store has not answered', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold({ [CHANNEL_B]: [] })
    advance({})
    expect(result.current.unread).toEqual({ t_b: false })
  })

  it('a topic with no channel is never asked about, and gets no entry', async () => {
    const { result } = renderHook(() => useTopicUnread([...topics, { id: 't_local', folderId: null }]))
    hold(HELD)
    expect(store.asked).toEqual([[CHANNEL_A, CHANNEL_B]])
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))
    expect('t_local' in result.current.unread).toBe(false)
  })

  it('a frontier that moves turns the dot off', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold(HELD)
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))

    advance({ [CHANNEL_A]: NOW - 60 })
    await waitFor(() => expect(result.current.unread.t_a).toBe(false))
  })

  it('an urgent message raises the indicator instead of the dot', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold({ [CHANNEL_A]: [said('m', NOW - 3600, true)], [CHANNEL_B]: [] })
    advance({})
    await waitFor(() => expect(result.current.urgent.t_a).toBe(true))
    expect(result.current.unread.t_a).toBe(false)
  })

  it('a message that arrives later lights the row, with nothing asked again', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    hold(HELD)
    advance({ [CHANNEL_A]: NOW - 60, [CHANNEL_B]: NOW - 60 })
    await waitFor(() => expect(result.current.unread.t_a).toBe(false))

    hold({ [CHANNEL_A]: [said('m', NOW - 3600)], [CHANNEL_B]: [said('n', NOW - 30)] })
    await waitFor(() => expect(result.current.unread.t_b).toBe(true))
    expect(store.asked).toHaveLength(1)
  })

  it('asks for nothing when no topic has a channel', () => {
    renderHook(() => useTopicUnread([{ id: 't_local', folderId: null }]))
    expect(store.asked).toEqual([[]])
  })
})
