import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StreamMessage } from '@/nostr/channelStreams'

/*
  The same seams `useTeamUnread.test.tsx` pins, for the same reason: the
  judging is `topicUnread.test.ts`'s, and this is the hook's contract — one
  batched read for the listed topics, a topic with no channel never asked
  about, nothing judged before the frontier has landed, and a dot that goes
  out when the frontier moves without a second read.
*/
const relay = vi.hoisted(() => ({
  channelStreams: vi.fn<(ids: readonly string[]) => Promise<Record<string, StreamMessage[]>>>(),
}))
const frontier = vi.hoisted(() => ({
  ready: false,
  markers: {} as Record<string, number>,
  version: 0,
  listeners: new Set<() => void>(),
}))
vi.mock('@/api/foreign', () => ({ useForeignObjects: () => ({ channelStreams: relay.channelStreams }) }))
/** The socket, present or absent — both are real states for this hook. */
const live = vi.hoisted(() => ({
  present: true,
  watched: [] as string[][],
  stops: 0,
  fire: undefined as ((channelUuid: string) => void) | undefined,
}))
vi.mock('@/nostr/liveTopics', () => ({
  peekLiveTopics: () =>
    live.present
      ? {
          watchChannels: (ids: readonly string[], listener: (id: string) => void) => {
            live.watched.push([...ids])
            live.fire = listener
            return {
              stop: () => {
                live.stops++
                live.fire = undefined
              },
            }
          },
        }
      : null,
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
/** Captured so a test can fire the hook's only re-read path by hand. */
const refresh = vi.hoisted(() => ({ fire: undefined as (() => void) | undefined }))
vi.mock('@/lib/useRefreshTriggers', () => ({
  useRefreshTriggers: (fn: () => void, opts?: { enabled?: boolean }) => {
    refresh.fire = opts?.enabled === false ? undefined : fn
  },
}))
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

import { TOPIC_UNREAD_SETTLE_MS, useTopicUnread } from './useTopicUnread'

const CHANNEL_A = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-8222-222222222222'
const THEM = 'd'.repeat(64)
const NOW = Math.floor(Date.now() / 1000)

const topics = [
  { id: 't_a', folderId: CHANNEL_A },
  { id: 't_b', folderId: CHANNEL_B },
]

const said = (id: string, at: number, urgent = false): StreamMessage => ({
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

beforeEach(() => {
  frontier.ready = false
  frontier.markers = {}
  live.present = true
  live.watched = []
  live.stops = 0
  live.fire = undefined
  relay.channelStreams.mockResolvedValue({
    // A: an ordinary message an hour ago, nobody has read it. B: nothing.
    [CHANNEL_A]: [said('m', NOW - 3600)],
    [CHANNEL_B]: [],
  })
})
afterEach(() => {
  relay.channelStreams.mockReset()
  frontier.listeners.clear()
  refresh.fire = undefined
})

describe('useTopicUnread', () => {
  it('reads every listed channel in one call, keyed back to the topic id', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    expect(relay.channelStreams.mock.calls[0][0]).toEqual([CHANNEL_A, CHANNEL_B])

    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))
    expect(result.current.unread.t_b).toBe(false)
    expect(result.current.urgent.t_a).toBe(false)
  })

  it('judges nothing until the frontier has landed — absent markers would light everything', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalled())
    expect(result.current.unread).toEqual({})
    expect(result.current.urgent).toEqual({})
  })

  it('a topic with no channel is never asked about, and gets no entry', async () => {
    const { result } = renderHook(() =>
      useTopicUnread([...topics, { id: 't_local', folderId: null }]),
    )
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalled())
    expect(relay.channelStreams.mock.calls[0][0]).toEqual([CHANNEL_A, CHANNEL_B])
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))
    expect('t_local' in result.current.unread).toBe(false)
  })

  it('a frontier that moves turns the dot off without a second read', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))

    advance({ [CHANNEL_A]: NOW - 60 })
    await waitFor(() => expect(result.current.unread.t_a).toBe(false))
    expect(relay.channelStreams).toHaveBeenCalledTimes(1)
  })

  it('the cached mark clears a dot the relay frontier alone would light', async () => {
    const { rerender, result } = renderHook(
      ({ marks }: { marks?: Record<string, number> }) => useTopicUnread(topics, marks),
      { initialProps: {} as { marks?: Record<string, number> } },
    )
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalled())
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))

    rerender({ marks: { [CHANNEL_A]: NOW - 60 } })
    await waitFor(() => expect(result.current.unread.t_a).toBe(false))
  })

  it('an urgent message raises the indicator instead of the dot', async () => {
    relay.channelStreams.mockResolvedValue({
      [CHANNEL_A]: [said('m', NOW - 3600, true)],
      [CHANNEL_B]: [],
    })
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalled())
    advance({})
    await waitFor(() => expect(result.current.urgent.t_a).toBe(true))
    expect(result.current.unread.t_a).toBe(false)
  })

  it('a failed re-read leaves the last answer standing rather than blanking every row', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))

    relay.channelStreams.mockRejectedValue(new Error('relay down'))
    act(() => refresh.fire?.())
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(2))
    expect(result.current.unread.t_a).toBe(true)
  })

  it('a refresh trigger re-reads, and a message that arrived since lights the row', async () => {
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    advance({ [CHANNEL_A]: NOW - 60, [CHANNEL_B]: NOW - 60 })
    await waitFor(() => expect(result.current.unread.t_a).toBe(false))

    relay.channelStreams.mockResolvedValue({
      [CHANNEL_A]: [said('m', NOW - 3600)],
      [CHANNEL_B]: [said('n', NOW - 30)],
    })
    act(() => refresh.fire?.())
    await waitFor(() => expect(result.current.unread.t_b).toBe(true))
  })

  it('asks for nothing when no topic has a channel, and arms no refresh or watch either', () => {
    renderHook(() => useTopicUnread([{ id: 't_local', folderId: null }]))
    expect(relay.channelStreams).not.toHaveBeenCalled()
    expect(refresh.fire).toBeUndefined()
    expect(live.watched).toEqual([])
  })
})

describe('the socket path', () => {
  it('watches every listed channel in one call, and stops on unmount', async () => {
    const { unmount } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(live.watched).toHaveLength(1))
    expect(live.watched[0]).toEqual([CHANNEL_A, CHANNEL_B])
    unmount()
    expect(live.stops).toBe(1)
  })

  it('a burst in one channel is one re-read, not one each', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useTopicUnread(topics))
      await vi.waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
      advance({ [CHANNEL_A]: NOW - 60, [CHANNEL_B]: NOW - 60 })
      await vi.waitFor(() => expect(result.current.unread.t_b).toBe(false))

      relay.channelStreams.mockResolvedValue({
        [CHANNEL_A]: [],
        [CHANNEL_B]: [said('n', NOW - 1), said('o', NOW), said('p', NOW)],
      })
      act(() => {
        live.fire?.(CHANNEL_B)
        live.fire?.(CHANNEL_B)
        live.fire?.(CHANNEL_B)
      })
      // Nothing yet: the settle window is still open.
      expect(relay.channelStreams).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOPIC_UNREAD_SETTLE_MS)
      })
      expect(relay.channelStreams).toHaveBeenCalledTimes(2)
      await vi.waitFor(() => expect(result.current.unread.t_b).toBe(true))
    } finally {
      vi.useRealTimers()
    }
  })

  it('the interval fallback stays armed, because a wide filter may silently not fan out', async () => {
    renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(live.watched).toHaveLength(1))
    // Both paths, on purpose: a relay build with the singular
    // `extract_channel_ids_from_filters` accepts the REQ and delivers nothing.
    expect(refresh.fire).toBeDefined()
  })

  it('works with no socket at all — the refresh triggers still drive it', async () => {
    live.present = false
    const { result } = renderHook(() => useTopicUnread(topics))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    expect(live.watched).toEqual([])
    advance({})
    await waitFor(() => expect(result.current.unread.t_a).toBe(true))
  })
})
