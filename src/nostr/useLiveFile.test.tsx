import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RelayState } from '@estiva-app/protocol'

/*
  FOL-32 — a file page re-reads when the socket says something was said about
  the file, and its interval idles while the socket is live. The socket is the
  seam `useTopicUnread.test.tsx` fakes, one level down: `getLiveTopics` rather
  than `peekLiveTopics`, because a file page opened from a link may be the first
  thing in the tab to want the connection.
*/
const live = vi.hoisted(() => ({
  state: 'connecting' as RelayState,
  stateListeners: new Set<(s: RelayState) => void>(),
  watched: [] as { ids: string[]; kinds?: readonly number[] }[],
  stops: 0,
  fire: undefined as ((channelUuid: string) => void) | undefined,
}))
vi.mock('./liveTopics', () => ({
  getLiveTopics: () => ({
    state: () => live.state,
    onState: (listener: (s: RelayState) => void) => {
      live.stateListeners.add(listener)
      return () => live.stateListeners.delete(listener)
    },
    watchChannels: (ids: readonly string[], listener: (id: string) => void, options?: { kinds?: readonly number[] }) => {
      live.watched.push({ ids: [...ids], kinds: options?.kinds })
      live.fire = listener
      return {
        stop: () => {
          live.stops++
          live.fire = undefined
        },
      }
    },
  }),
}))
vi.mock('@/api/store', () => ({ hasConvex: true }))
vi.mock('convex/react', () => ({
  useConvex: () => ({ action: vi.fn() }),
  useQuery: () => ({ relayUrl: 'https://relay.test' }),
}))

import { LIVE_FILE_SETTLE_MS, useLiveFile } from './useLiveFile'

const FOLDER = '11111111-1111-4111-8111-111111111111'

function connect(next: RelayState) {
  act(() => {
    live.state = next
    for (const listener of live.stateListeners) listener(next)
  })
}

beforeEach(() => {
  live.state = 'connecting'
  live.stateListeners.clear()
  live.watched = []
  live.stops = 0
  live.fire = undefined
})
afterEach(() => vi.useRealTimers())

describe('useLiveFile', () => {
  it('watches the Folder for comments only — a Folder’s own chat is not the file’s', () => {
    renderHook(() => useLiveFile(FOLDER, () => {}))
    expect(live.watched).toEqual([{ ids: [FOLDER], kinds: [1111] }])
  })

  it('a fake 1111 on the watched Folder re-reads, once per burst', async () => {
    vi.useFakeTimers()
    const onActivity = vi.fn()
    renderHook(() => useLiveFile(FOLDER, onActivity))
    act(() => {
      live.fire?.(FOLDER)
      live.fire?.(FOLDER)
    })
    // Nothing yet: the settle window is still open.
    expect(onActivity).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_FILE_SETTLE_MS)
    })
    expect(onActivity).toHaveBeenCalledTimes(1)
  })

  it('calls the latest listener, so an inline function that closes over fresh state is fine', async () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn }) => useLiveFile(FOLDER, fn), { initialProps: { fn: first } })
    rerender({ fn: second })
    act(() => live.fire?.(FOLDER))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_FILE_SETTLE_MS)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('reports the socket state, and re-reads on the transition into live', () => {
    const onActivity = vi.fn()
    const { result } = renderHook(() => useLiveFile(FOLDER, onActivity))
    expect(result.current.relayState).toBe('connecting')
    connect('live')
    expect(result.current.relayState).toBe('live')
    // What was missed while the socket was out is read once, now.
    expect(onActivity).toHaveBeenCalledTimes(1)
    connect('reconnecting')
    connect('live')
    expect(onActivity).toHaveBeenCalledTimes(2)
  })

  it('watches nothing without a Folder, and stops when the file changes', () => {
    const { rerender, unmount } = renderHook(({ folder }) => useLiveFile(folder, () => {}), {
      initialProps: { folder: null as string | null },
    })
    expect(live.watched).toEqual([])
    rerender({ folder: FOLDER })
    expect(live.watched).toHaveLength(1)
    unmount()
    expect(live.stops).toBe(1)
    expect(live.fire).toBeUndefined()
  })
})
