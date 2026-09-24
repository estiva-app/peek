/**
 * The tab's live client is acquired, not borrowed — FOL-40.
 *
 * The bug this pins shipped and was invisible to every unit test in the repo:
 * the unread dots read `peekLiveTopics()`, which answers null until something
 * else has built the socket, and they read it **once**. On a page where
 * nothing else had connected there was no subscription at all, and the dot
 * moved only on the refresh triggers — exactly what it did before it had a
 * socket at all.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A build-time value since REM-2, so there is no "not yet known" to wait out.
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'wss://estiva.estiva.app', hasRelay: true }))

const built = vi.hoisted(() => ({
  calls: [] as string[],
  state: 'connecting' as string,
  listeners: new Set<(state: string) => void>(),
  client: undefined as unknown,
}))
vi.mock('./liveTopics', () => ({
  getLiveTopics: (relayUrl: string) => {
    built.calls.push(relayUrl)
    built.client ??= {
      state: () => built.state,
      onState: (listener: (state: string) => void) => {
        // Wrapped, so two mounts passing the same function are two listeners —
        // a `Set` keyed on the function itself would have the first mount's
        // cleanup unsubscribe the second mount.
        const entry = (state: string) => listener(state)
        built.listeners.add(entry)
        return () => built.listeners.delete(entry)
      },
      watchChannels: () => ({ stop: () => {} }),
    }
    return built.client
  },
}))

import { useLiveClient } from './useLiveClient'

beforeEach(() => {
  built.calls = []
  built.state = 'connecting'
  built.listeners.clear()
  built.client = undefined
})
afterEach(() => {
  built.listeners.clear()
})

describe('useLiveClient', () => {
  it('builds the client on mount, once', async () => {
    const { result, rerender } = renderHook(() => useLiveClient())
    // The point of the fix: the client appears without anything else in the
    // tab having connected, and the caller learns about it.
    await waitFor(() => expect(result.current.live).not.toBeNull())
    expect(built.calls).toEqual(['wss://estiva.estiva.app'])

    rerender()
    expect(built.calls).toHaveLength(1)
  })

  it('reports the socket it found and every change after it, and unsubscribes on unmount', async () => {
    built.state = 'live'
    const { result, unmount } = renderHook(() => useLiveClient())
    // The snapshot, not only the changes: the tab-wide socket may already be
    // live when a sidebar mounts, and `onState` fires on change alone.
    await waitFor(() => expect(result.current.relayState).toBe('live'))

    act(() => {
      for (const listener of built.listeners) listener('offline')
    })
    await waitFor(() => expect(result.current.relayState).toBe('offline'))

    unmount()
    expect(built.listeners.size).toBe(0)
  })
})
