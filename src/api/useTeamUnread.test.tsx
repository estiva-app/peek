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
/* The followed set (FOL-30): everything, and known, unless a test says otherwise.
   Read through the same store as the frontier so a change re-renders the hook. */
const follows = vi.hoisted(() => ({
  state: 'present' as 'unknown' | 'absent' | 'present',
  keys: null as Set<string> | null,
}))
vi.mock('@/api', async () => {
  const { useSyncExternalStore, useMemo } = await import('react')
  return {
    useForeignObjects: () => ({ channelStreams: relay.channelStreams }),
    useFollows: () => {
      const version = useSyncExternalStore(
        (listener) => {
          frontier.listeners.add(listener)
          return () => frontier.listeners.delete(listener)
        },
        () => frontier.version,
      )
      return useMemo(
        () => ({
          state: follows.state,
          isFollowed: (key: string) => (follows.keys ? follows.keys.has(key) : true),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version],
      )
    },
  }
})
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
/*
  The socket, present or absent — both are real states for this hook. What it
  must hold is the wide filter (`watchChannels`, FOL-40), never
  `onForeignActivity`: that one is fed by the projection and never fires for a
  message kind, which is exactly what a comment is. So the fake offers only
  the wide filter, and a hook reaching for the other would throw.
*/
const live = vi.hoisted(() => ({
  present: true,
  watched: [] as { ids: string[]; kinds?: readonly number[] }[],
  stops: 0,
  fire: undefined as ((channelUuid: string) => void) | undefined,
}))
vi.mock('@/nostr/useLiveTopics', () => {
  // One client object, built once: a fresh one per render would re-run the
  // subscription effect for ever ([[mock-use-relay-viewer-stably]]).
  const client = {
    watchChannels: (
      ids: readonly string[],
      listener: (id: string) => void,
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
  }
  return {
    useLiveTopics: () => ({
      live: live.present ? client : null,
      relayState: live.present ? 'live' : 'connecting',
    }),
  }
})
/** Captured so a test can fire the fallback re-read by hand. */
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

import { RelayReadError } from '@/nostr/relayRead'
import { TEAM_UNREAD_SETTLE_MS, useTeamUnread } from './useTeamUnread'

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
  follows.state = 'present'
  follows.keys = null
  live.present = true
  live.watched = []
  live.stops = 0
  live.fire = undefined
  refresh.fire = undefined
  relay.channelStreams.mockResolvedValue({
    // A: a sibling file nobody read, said an hour ago. B: nothing.
    [FOLDER_A]: [{ id: 'm', at: NOW - 3600, by: THEM, root: 'm', about: [FOL18], urgent: false }],
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

  it("a topic placed in a team lights the team, and reading the topic's channel puts it out (FOL-22)", async () => {
    const TOPIC = '33333333-3333-4333-8333-333333333333'
    relay.channelStreams.mockResolvedValue({
      [FOLDER_A]: [],
      [FOLDER_B]: [],
      // The topic's own channel: a plain message, no `about`, said an hour ago.
      [TOPIC]: [{ id: 't', at: NOW - 3600, by: THEM, root: 't', about: [], urgent: false }],
    })
    const { result } = renderHook(() =>
      useTeamUnread([...folders, { id: TOPIC, name: 'A topic', hasState: false, listedIn: [FOLDER_B] }]),
    )
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    // One read for the lot — the topic's channel is asked for with the teams'.
    expect(relay.channelStreams).toHaveBeenCalledWith([FOLDER_A, FOLDER_B, TOPIC])
    advance({})
    await waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: true, [TOPIC]: true }))
    // Reading the team's own chat is not reading the topic.
    advance({ [FOLDER_B]: NOW })
    expect(result.current.unread[FOLDER_B]).toBe(true)
    // The topic page advances the topic's container, and that is what the team's dot follows.
    advance({ [TOPIC]: NOW })
    expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false, [TOPIC]: false })
  })

  it('asks nothing for an empty list', async () => {
    const { result } = renderHook(() => useTeamUnread([]))
    advance({})
    expect(relay.channelStreams).not.toHaveBeenCalled()
    expect(result.current.unread).toEqual({})
  })

  it('judges nothing while the followed set is unknown, and only followed files once it is known (FOL-30)', async () => {
    follows.state = 'unknown'
    const { result } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    advance({})
    // An unknown set is not an empty one: no dot goes out, none comes on.
    expect(result.current.unread).toEqual({})
    // Known, and the file is followed: the team lights.
    follows.state = 'present'
    follows.keys = new Set([FOL18])
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_A]: true, [FOLDER_B]: false })
    // Unfollowed: the same messages, the same markers, and the team goes out at once.
    follows.keys = new Set()
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false })
    expect(relay.channelStreams).toHaveBeenCalledTimes(1)
  })
})

describe('the socket path (FOL-40)', () => {
  it('watches every listed Folder through the wide filter, for both message kinds, and stops on unmount', async () => {
    const { unmount } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(live.watched).toHaveLength(1))
    expect(live.watched[0]).toEqual({ ids: [FOLDER_A, FOLDER_B], kinds: [9, 1111] })
    unmount()
    expect(live.stops).toBe(1)
  })

  it('a comment on a followed file lights the team after the settle, and a burst is one re-read', async () => {
    vi.useFakeTimers()
    try {
      relay.channelStreams.mockResolvedValue({ [FOLDER_A]: [], [FOLDER_B]: [] })
      const { result } = renderHook(() => useTeamUnread(folders))
      await vi.waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
      advance({})
      await vi.waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false }))

      // Somebody comments three times on the followed file in A; the relay now holds them.
      relay.channelStreams.mockResolvedValue({
        [FOLDER_A]: [
          { id: 'n', at: NOW - 1, by: THEM, root: 'n', about: [FOL18], urgent: false },
          { id: 'o', at: NOW, by: THEM, root: 'n', about: [FOL18], urgent: false },
          { id: 'p', at: NOW, by: THEM, root: 'n', about: [FOL18], urgent: false },
        ],
        [FOLDER_B]: [],
      })
      act(() => {
        live.fire?.(FOLDER_A)
        live.fire?.(FOLDER_A)
        live.fire?.(FOLDER_A)
      })
      // Nothing yet: the settle window is still open, and no refresh trigger was needed.
      expect(relay.channelStreams).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEAM_UNREAD_SETTLE_MS)
      })
      expect(relay.channelStreams).toHaveBeenCalledTimes(2)
      await vi.waitFor(() => expect(result.current.unread[FOLDER_A]).toBe(true))
      expect(result.current.unread[FOLDER_B]).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits out a quota refusal at the second the relay named, rather than dropping it', async () => {
    /*
      The shipped defect, and the last one in the chain. The wide filter was
      registered and did fire — the console said so — but the re-read it
      triggered came back `rate-limited: quota exceeded; retry in 8s`, which
      classified as `unreachable` and fell into a `.catch(() => {})`. Nothing
      retried, so the dot moved only when a later refresh tick happened to win,
      which is the "long wait, then the sidebar reloads" Miky saw.
    */
    vi.useFakeTimers()
    try {
      relay.channelStreams.mockResolvedValue({ [FOLDER_A]: [], [FOLDER_B]: [] })
      const { result } = renderHook(() => useTeamUnread(folders))
      await vi.waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
      advance({})
      await vi.waitFor(() => expect(result.current.unread[FOLDER_A]).toBe(false))

      relay.channelStreams
        .mockRejectedValueOnce(new RelayReadError('rate-limited: quota exceeded; retry in 8s'))
        .mockResolvedValue({
          [FOLDER_A]: [{ id: 'n', at: NOW, by: THEM, root: 'n', about: [FOL18], urgent: false }],
          [FOLDER_B]: [],
        })
      act(() => live.fire?.(FOLDER_A))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEAM_UNREAD_SETTLE_MS)
      })
      // Refused, and the dot has not moved — but the read is still alive.
      expect(relay.channelStreams).toHaveBeenCalledTimes(2)
      expect(result.current.unread[FOLDER_A]).toBe(false)

      // Not a moment sooner: the window the relay named has not rolled over.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000)
      })
      expect(relay.channelStreams).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(relay.channelStreams).toHaveBeenCalledTimes(3)
      await vi.waitFor(() => expect(result.current.unread[FOLDER_A]).toBe(true))
    } finally {
      vi.useRealTimers()
    }
  })

  it('subscribes to a socket that arrives after it mounted, and re-reads when it goes live', async () => {
    // The shipped bug: the client was read once, at mount, and on a page where
    // nothing else had connected it was null — so no subscription was ever
    // made and the dot moved on the refresh triggers alone.
    live.present = false
    const { rerender } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    expect(live.watched).toEqual([])

    live.present = true
    rerender()
    await waitFor(() => expect(live.watched).toHaveLength(1))
    // Connecting is not watching: what was said while the socket was down is
    // covered by one read on the transition into live.
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(2))
  })

  it('the refresh fallback stays armed, because a wide filter may silently not fan out', async () => {
    renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(live.watched).toHaveLength(1))
    expect(refresh.fire).toBeDefined()
  })

  it('works with no socket at all — the refresh triggers still drive it', async () => {
    live.present = false
    const { result } = renderHook(() => useTeamUnread(folders))
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(1))
    expect(live.watched).toEqual([])
    advance({})
    await waitFor(() => expect(result.current.unread[FOLDER_A]).toBe(true))
    act(() => refresh.fire?.())
    await waitFor(() => expect(relay.channelStreams).toHaveBeenCalledTimes(2))
  })
})
