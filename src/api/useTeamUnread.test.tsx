import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StreamMessage } from '@/nostr/channelStreams'

/*
  The seams, each pinned to the quietest answer: one relay read the test
  scripts, a frontier the test moves, no socket, no refresh triggers, a viewer.
  The judging itself is `teamUnread.test.ts`'s; this is the hook's contract —
  one batched read for the listed Folders, nothing judged before the frontier
  has landed, and a dot that goes out when the frontier moves without a read.
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
vi.mock('@/api', () => ({ useForeignObjects: () => ({ channelStreams: relay.channelStreams }) }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
vi.mock('@/nostr/liveTopics', () => ({ peekLiveTopics: () => null }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
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

import { useTeamUnread } from './useTeamUnread'

const FOLDER_A = '11111111-1111-4111-8111-111111111111'
const FOLDER_B = '22222222-2222-4222-8222-222222222222'
const THEM = 'd'.repeat(64)
const FOL18 = `30851:${'b'.repeat(64)}:fol-18`
const NOW = Math.floor(Date.now() / 1000)

const folders = [
  { id: FOLDER_A, name: 'A', hasState: true },
  { id: FOLDER_B, name: 'B', hasState: true },
]

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
  relay.channelStreams.mockResolvedValue({
    // A: a sibling file nobody read, said an hour ago. B: nothing.
    [FOLDER_A]: [{ id: 'm', at: NOW - 3600, by: THEM, root: 'm', about: [FOL18] }],
    [FOLDER_B]: [],
  })
})
afterEach(() => {
  relay.channelStreams.mockReset()
})

describe('useTeamUnread', () => {
  it('reads every listed Folder in one call and judges nothing before the frontier lands', async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    expect(relay.channelStreams).toHaveBeenCalledWith([FOLDER_A, FOLDER_B])
    // Absent everywhere would read as "new everywhere": not judged, not dark.
    expect(result.current.unread).toEqual({})
  })

  it("lights the Folder with the unread file, and puts it out when that file's marker moves", async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    advance({})
    await waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: true, [FOLDER_B]: false }))
    // Reading the team's chat changes nothing about the file (§11.3).
    advance({ [FOLDER_A]: NOW })
    expect(result.current.unread[FOLDER_A]).toBe(true)
    // Reading the file does — with no second read of the relay.
    advance({ [FOL18]: NOW })
    expect(result.current.unread[FOLDER_A]).toBe(false)
    expect(relay.channelStreams).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for an empty list', async () => {
    const { result } = renderHook(() => useTeamUnread([]))
    advance({})
    expect(relay.channelStreams).not.toHaveBeenCalled()
    expect(result.current.unread).toEqual({})
  })
})
