import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RelayState, SignedEvent } from '@estiva-app/protocol'

/*
  FOL-32, OPT-5 — a file page is handed what the socket delivers in its Folder,
  to apply, and catches up on the transition into live. The socket is faked at
  `getLiveTopics`, because a file page opened from a link may be the first
  thing in the tab to want the connection.
*/
const live = vi.hoisted(() => ({
  state: 'connecting' as RelayState,
  stateListeners: new Set<(s: RelayState) => void>(),
  watched: [] as { ids: string[]; kinds?: readonly number[] }[],
  stops: 0,
  fire: undefined as ((channelUuid: string, event?: SignedEvent) => void) | undefined,
}))
vi.mock('./liveTopics', () => ({
  getLiveTopics: () => ({
    state: () => live.state,
    onState: (listener: (s: RelayState) => void) => {
      live.stateListeners.add(listener)
      return () => live.stateListeners.delete(listener)
    },
    watchChannels: (
      ids: readonly string[],
      listener: (id: string, event?: SignedEvent) => void,
      options?: { kinds?: readonly number[] },
    ) => {
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
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

import { LIVE_FILE_LINGER_MS, stopLiveFileWatches, useLiveFile } from './useLiveFile'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const event = (id: string) => ({ id, kind: 1111, tags: [['h', FOLDER]] }) as unknown as SignedEvent

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
afterEach(() => {
  stopLiveFileWatches()
  vi.useRealTimers()
})

describe('useLiveFile', () => {
  it('watches the Folder for what a file’s conversation is made of, the Folder’s chat included', () => {
    renderHook(() => useLiveFile(FOLDER, () => {}))
    expect(live.watched).toEqual([{ ids: [FOLDER], kinds: [1111, 9, 40003, 9101, 9005, 1851] }])
  })

  it('hands over each event as it arrives, to apply — nothing gathered, nothing re-read', () => {
    const onActivity = vi.fn()
    renderHook(() => useLiveFile(FOLDER, onActivity))
    act(() => {
      live.fire?.(FOLDER, event('a'))
      live.fire?.(FOLDER, event('b'))
    })
    expect(onActivity.mock.calls).toEqual([[event('a')], [event('b')]])
  })

  it('calls the latest listener, so an inline function that closes over fresh state is fine', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn }) => useLiveFile(FOLDER, fn), { initialProps: { fn: first } })
    rerender({ fn: second })
    act(() => live.fire?.(FOLDER, event('a')))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('reports the socket state, and asks for a catch-up — no event — on the transition into live', () => {
    const onActivity = vi.fn()
    const { result } = renderHook(() => useLiveFile(FOLDER, onActivity))
    expect(result.current.relayState).toBe('connecting')
    connect('live')
    expect(result.current.relayState).toBe('live')
    expect(onActivity.mock.calls).toEqual([[]])
    connect('reconnecting')
    connect('live')
    expect(onActivity).toHaveBeenCalledTimes(2)
  })

  it('two views of one Folder share one watch, and both are handed each event', () => {
    const one = vi.fn()
    const two = vi.fn()
    renderHook(() => useLiveFile(FOLDER, one))
    renderHook(() => useLiveFile(FOLDER, two))
    expect(live.watched).toHaveLength(1)
    act(() => live.fire?.(FOLDER, event('a')))
    expect(one).toHaveBeenCalledWith(event('a'))
    expect(two).toHaveBeenCalledWith(event('a'))
  })

  it('going from one topic to another in the Folder keeps the watch; it closes a while after the last view leaves', () => {
    vi.useFakeTimers()
    const first = renderHook(() => useLiveFile(FOLDER, () => {}))
    first.unmount()
    renderHook(() => useLiveFile(FOLDER, () => {})).unmount()
    expect(live.watched).toHaveLength(1)
    expect(live.stops).toBe(0)
    act(() => vi.advanceTimersByTime(LIVE_FILE_LINGER_MS))
    expect(live.stops).toBe(1)
    // Negative control: another Folder is its own watch.
    renderHook(() => useLiveFile(OTHER, () => {}))
    expect(live.watched.map((w) => w.ids)).toEqual([[FOLDER], [OTHER]])
  })

  it('watches nothing without a Folder', () => {
    const { rerender } = renderHook(({ folder }) => useLiveFile(folder, () => {}), {
      initialProps: { folder: null as string | null },
    })
    expect(live.watched).toEqual([])
    rerender({ folder: FOLDER })
    expect(live.watched).toHaveLength(1)
  })
})
