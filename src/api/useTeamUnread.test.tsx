import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StreamMessage } from '@/nostr/channelStreams'
import type { ChannelStoreRead } from '@/platform/channelStore'

/*
  The seams, each pinned to the quietest answer: the tab's channel store (what
  it holds is scripted here — how it reads is `useChannelStreams.test.tsx`'s
  and `channelStore.test.ts`'s), a frontier the test moves, a viewer. The
  judging itself is `teamUnread.test.ts`'s; this is the hook's contract — one
  store call for the listed Folders, nothing judged before the frontier has
  landed, a dot that goes out when the frontier moves, and a console probe that
  still says what the reads were and why.
*/
const store = vi.hoisted(() => ({
  asked: [] as string[][],
  streams: {} as Record<string, StreamMessage[]>,
  at: 0,
  version: 0,
  listeners: new Set<() => void>(),
  reads: new Set<(read: ChannelStoreRead) => void>(),
  deliveries: new Set<(channel: string) => void>(),
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
    onChannelStoreRead: (listener: (read: ChannelStoreRead) => void) => {
      store.reads.add(listener)
      return () => store.reads.delete(listener)
    },
    onChannelStoreDelivery: (listener: (channel: string) => void) => {
      store.deliveries.add(listener)
      return () => store.deliveries.delete(listener)
    },
  }
})
const frontier = vi.hoisted(() => ({
  ready: false,
  markers: {} as Record<string, number>,
  version: 0,
  listeners: new Set<() => void>(),
}))
/* Membership (§11.8): a member of everything, and known, unless a test says otherwise.
   Read through the same store as the frontier so a change re-renders the hook. */
const follows = vi.hoisted(() => ({
  state: 'known' as 'unknown' | 'known',
  keys: null as Set<string> | null,
}))
vi.mock('@/api', async () => {
  const { useSyncExternalStore, useMemo } = await import('react')
  return {
    useMembership: () => {
      const version = useSyncExternalStore(
        (listener) => {
          frontier.listeners.add(listener)
          return () => frontier.listeners.delete(listener)
        },
        () => frontier.version,
      )
      return useMemo(
        () => {
          const isMember = (key: string) => (follows.keys ? follows.keys.has(key) : true)
          return {
            state: follows.state,
            isMember,
            termsOf: (key: string) => ({ member: isMember(key), muted: false }),
            isMentioned: () => false,
          }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version],
      )
    },
  }
})
/* Each file's parent (FOL-50): none known, unless a test says; what was asked is kept. */
const parents = vi.hoisted(() => ({ known: {} as Record<string, string | null>, asked: [] as string[][] }))
vi.mock('./useFileParents', () => ({
  useFileParents: (addresses: readonly string[]) => {
    parents.asked.push([...addresses])
    return parents.known
  },
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
vi.mock('@/nostr/useLiveClient', () => {
  const client = {}
  return { useLiveClient: () => ({ live: client, relayState: 'live' }) }
})
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
          merged: frontier.markers,
          ready: frontier.ready,
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version],
      )
    },
  }
})

import { RelayReadError } from '@/nostr/relayRead'
import { type TeamUnreadSnapshot, installTeamUnreadDiagnostic } from './teamUnreadDiagnostic'
import { TEAM_UNREAD_SETTLE_MS, useTeamUnread } from './useTeamUnread'

/* The api barrel is mocked here, so the installer the app calls at module load
   is called by hand — the probe module itself is the real one. */
installTeamUnreadDiagnostic()
const teamUnread = (folder?: string): TeamUnreadSnapshot[] =>
  (window as unknown as Record<string, (folder?: string) => TeamUnreadSnapshot[]>).__teamUnread(
    folder,
  )

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

/** The store answering, as it does once its first read lands. */
function hold(streams: Record<string, StreamMessage[]>) {
  act(() => {
    store.streams = streams
    store.at = NOW
    store.version++
    for (const listener of store.listeners) listener()
  })
}

function read(partial: Partial<ChannelStoreRead>) {
  const full: ChannelStoreRead = { reason: 'track', mode: 'sync', channels: 2, requests: 1, outcome: 'ok', ms: 5, ...partial }
  act(() => {
    for (const listener of store.reads) listener(full)
  })
}

const HELD = {
  // A: a sibling file nobody read, said an hour ago. B: nothing.
  [FOLDER_A]: [{ id: 'm', at: NOW - 3600, by: THEM, root: 'm', about: [FOL18], urgent: false, body: '' }],
  [FOLDER_B]: [],
}

beforeEach(() => {
  frontier.ready = false
  frontier.markers = {}
  follows.state = 'known'
  follows.keys = null
  store.asked = []
  store.streams = {}
  store.at = 0
  parents.known = {}
  parents.asked = []
})
afterEach(() => {
  store.listeners.clear()
})

describe('useTeamUnread', () => {
  it('asks the store for every listed Folder at once, and judges nothing before the frontier lands', async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    hold(HELD)
    expect(store.asked).toEqual([[FOLDER_A, FOLDER_B]])
    // Absent everywhere would read as "new everywhere": not judged, not dark.
    expect(result.current.unread).toEqual({})
  })

  it('judges nothing for a Folder the store has not answered', async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    hold({ [FOLDER_B]: [] })
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_B]: false })
  })

  it("lights the Folder with the unread file, and puts it out when that file's marker moves", async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    hold(HELD)
    advance({})
    await waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: true, [FOLDER_B]: false }))
    // Reading the team's chat changes nothing about the file (§11.3).
    advance({ [FOLDER_A]: NOW })
    expect(result.current.unread[FOLDER_A]).toBe(true)
    // Reading the file does.
    advance({ [FOL18]: NOW })
    expect(result.current.unread[FOLDER_A]).toBe(false)
  })

  it("lights the Folder an issue's project moved to, and not the one it is talked in (FOL-50)", async () => {
    const PROJECT = `30850:${'b'.repeat(64)}:project`
    parents.known = { [FOL18]: PROJECT }
    const moved = [
      { id: FOLDER_A, name: 'A', hasState: true, addresses: [] },
      { id: FOLDER_B, name: 'B', hasState: true, addresses: [PROJECT] },
    ]
    const { result } = renderHook(() => useTeamUnread(moved))
    hold(HELD)
    advance({})
    await waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: true }))
    // Asked about the one file no state lists — the issue, not the project.
    expect(parents.asked.at(-1)).toEqual([FOL18])
  })

  it('a message the socket delivers lights the team without the hook asking anything', async () => {
    const { result } = renderHook(() => useTeamUnread(folders))
    hold({ [FOLDER_A]: [], [FOLDER_B]: [] })
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false })
    hold(HELD)
    expect(result.current.unread[FOLDER_A]).toBe(true)
    expect(store.asked).toHaveLength(1)
  })

  it("a topic placed in a team lights the team for a file talked about in it, never for its own chat (FOL-22, §11.8)", async () => {
    const TOPIC = '33333333-3333-4333-8333-333333333333'
    const { result } = renderHook(() =>
      useTeamUnread([...folders, { id: TOPIC, name: 'A topic', hasState: false, listedIn: [FOLDER_B] }]),
    )
    hold({
      [FOLDER_A]: [],
      [FOLDER_B]: [],
      [TOPIC]: [
        // The topic's own chat: no `about`, and no screen in Peek to read it on — never counted.
        { id: 't', at: NOW - 3600, by: THEM, root: 't', about: [], urgent: false, body: '' },
        // A file talked about in the topic's channel: counted, and folded into the team.
        { id: 'f', at: NOW - 3600, by: THEM, root: 'f', about: [FOL18], urgent: false, body: '' },
      ],
    })
    // One store call for the lot — the topic's channel is asked for with the teams'.
    expect(store.asked).toEqual([[FOLDER_A, FOLDER_B, TOPIC]])
    advance({})
    await waitFor(() => expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: true, [TOPIC]: true }))
    // Reading the team's or the topic's channel is not reading the file.
    advance({ [FOLDER_B]: NOW, [TOPIC]: NOW })
    expect(result.current.unread[FOLDER_B]).toBe(true)
    // The file's own marker is what puts both out.
    advance({ [FOLDER_B]: NOW, [TOPIC]: NOW, [FOL18]: NOW })
    expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false, [TOPIC]: false })
  })

  it('asks nothing for an empty list', async () => {
    const { result } = renderHook(() => useTeamUnread([]))
    advance({})
    expect(store.asked).toEqual([[]])
    expect(result.current.unread).toEqual({})
  })

  it('judges nothing while membership is unknown, and only member files once it is known (§11.8)', async () => {
    follows.state = 'unknown'
    const { result } = renderHook(() => useTeamUnread(folders))
    hold(HELD)
    advance({})
    // An unknown set is not an empty one: no dot goes out, none comes on.
    expect(result.current.unread).toEqual({})
    // Known, and the person is in the file: the team lights.
    follows.state = 'known'
    follows.keys = new Set([FOL18])
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_A]: true, [FOLDER_B]: false })
    // Left: the same messages, the same markers, and the team goes out at once.
    follows.keys = new Set()
    advance({})
    expect(result.current.unread).toEqual({ [FOLDER_A]: false, [FOLDER_B]: false })
  })
})

describe('activity — the socket handed on to the rows (FOL-44)', () => {
  it('counts a burst of deliveries once per window, folded into the team that lists the channel', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const TOPIC = '33333333-3333-4333-8333-333333333333'
      const { result } = renderHook(() =>
        useTeamUnread([...folders, { id: TOPIC, name: 'A topic', hasState: false, listedIn: [FOLDER_B] }]),
      )
      act(() => {
        for (let i = 0; i < 5; i += 1) for (const heard of store.deliveries) heard(TOPIC)
        for (const heard of store.deliveries) heard('99999999-9999-4999-8999-999999999999')
      })
      expect(result.current.activity).toEqual({})
      await act(() => vi.advanceTimersByTimeAsync(TEAM_UNREAD_SETTLE_MS))
      expect(result.current.activity).toEqual({ [TOPIC]: 1, [FOLDER_B]: 1 })

      // A reconnect's catch-up: anything may have been missed, anywhere.
      read({ reason: 'relay-live' })
      expect(result.current.activity).toEqual({ [FOLDER_A]: 1, [FOLDER_B]: 3, [TOPIC]: 2 })
      // A failed one says nothing was learned.
      read({ reason: 'relay-live', outcome: 'failed', requests: null, error: new Error('down') })
      expect(result.current.activity[FOLDER_A]).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the console probe (FOL-40), fed by the store (PER-8)', () => {
  /*
    FOL-40's instrument. Production proved a delivery reached the socket while
    the dot stayed dark, and every step between the two lives for one render.
    The reads are the store's now, so the probe hears them from the store — and
    must still say what asked for each one and how it ended.
  */
  it('hands the console the delivery, the read and why, and the gates it was judged behind', async () => {
    const { unmount } = renderHook(() => useTeamUnread(folders))
    read({ reason: 'track' })
    hold(HELD)
    await vi.waitFor(() =>
      expect(teamUnread()[0]?.lastLoad).toMatchObject({ trigger: 'folders', outcome: 'ok', answered: 2 }),
    )
    expect(teamUnread()[0]).toMatchObject({ folders: 2, live: true, deliveries: 0, frontierReady: false, lit: [] })

    act(() => {
      for (const heard of store.deliveries) heard(FOLDER_A)
      // Another reader's channel: not this sidebar's delivery.
      for (const heard of store.deliveries) heard('99999999-9999-4999-8999-999999999999')
    })
    expect(teamUnread()[0]).toMatchObject({ deliveries: 1, lastDelivery: { folder: FOLDER_A, listed: true } })

    read({ reason: 'relay-live' })
    expect(teamUnread()[0].lastLoad).toMatchObject({ trigger: 'relay-live', outcome: 'ok' })
    read({ reason: 'interval', outcome: 'failed', requests: null, error: new RelayReadError('rate-limited: quota exceeded; retry in 8s') })
    expect(teamUnread()[0].lastLoad).toMatchObject({ trigger: 'refresh', outcome: 'failed', failure: 'rate_limited' })

    advance({})
    await vi.waitFor(() => expect(teamUnread()[0].frontierReady).toBe(true))
    expect(teamUnread()[0].folder).toMatchObject({ id: FOLDER_A, listed: true, read: true, unread: true })

    unmount()
    // A stopped hook leaves nothing to read, in a tab as in a test.
    expect(teamUnread()).toEqual([])
  })
})
