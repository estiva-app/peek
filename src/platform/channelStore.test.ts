import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { createChannelStore, type ChannelStoreOptions } from './channelStore'

const A = 'aaaaaaaa-0000-4000-8000-000000000000'
const B = 'bbbbbbbb-0000-4000-8000-000000000000'
const C = 'cccccccc-0000-4000-8000-000000000000'
const NOW = 1_800_000_000
const HORIZON = 90 * 24 * 60 * 60
const LOOKBACK = 1_870

let serial = 0
function message(channel: string, at: number, kind = 9): SignedEvent {
  serial += 1
  return { id: `e${serial}`, kind, pubkey: 'p', created_at: at, tags: [['h', channel]], content: '', sig: '' }
}

type Filter = { kinds: number[]; '#h': string[]; since: number; limit: number }

/** A relay that answers by filter, and remembers every POST. */
function harness(overrides: Partial<ChannelStoreOptions> = {}) {
  const relay: SignedEvent[] = []
  const posts: Filter[][] = []
  const watches: { channels: string[]; since: number; stopped: boolean; listener: (c: string, e?: SignedEvent) => void }[] = []
  let clock = NOW * 1000
  let fail: Error | null = null
  let gate: Promise<void> | null = null
  const errors: unknown[] = []
  const store = createChannelStore({
    kinds: [9, 1111],
    horizonSeconds: HORIZON,
    limitPerChannel: 200,
    lookbackSeconds: LOOKBACK,
    now: () => clock,
    onError: (error) => errors.push(error),
    query: async (filters) => {
      posts.push(filters as Filter[])
      if (gate) await gate
      if (fail) throw fail
      return (filters as Filter[]).flatMap((filter) =>
        relay
          .filter((e) => filter.kinds.includes(e.kind) && e.tags.some((t) => t[0] === 'h' && filter['#h'].includes(t[1])))
          .filter((e) => e.created_at >= filter.since)
          .slice(-filter.limit),
      )
    },
    watch: (channels, listener, { since }) => {
      const entry = { channels, since, stopped: false, listener }
      watches.push(entry)
      return { stop: () => void (entry.stopped = true) }
    },
    ...overrides,
  })
  return {
    store,
    relay,
    posts,
    watches,
    errors,
    live: () => watches.filter((w) => !w.stopped),
    tick: (seconds: number) => void (clock += seconds * 1000),
    failWith: (error: Error | null) => void (fail = error),
    hold: () => {
      let open!: () => void
      gate = new Promise((resolve) => (open = resolve))
      return () => {
        gate = null
        open()
      }
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createChannelStore', () => {
  it('reads two callers’ sets tracked together in one request, over the horizon', async () => {
    const h = harness()
    h.relay.push(message(A, NOW - 10), message(C, NOW - 5))
    h.store.track([A, B])
    h.store.track([B, C])
    await settle()

    expect(h.posts).toHaveLength(1)
    expect(h.posts[0].map((f) => f['#h'][0]).sort()).toEqual([A, B, C])
    expect(h.posts[0].every((f) => f.since === NOW - HORIZON)).toBe(true)
    expect(h.store.events(A)?.map((e) => e.created_at)).toEqual([NOW - 10])
    expect(h.store.events(B)).toEqual([])
    expect(h.store.events(C)).toHaveLength(1)
  })

  it('splits past the relay’s filters-per-request ceiling', async () => {
    const h = harness()
    h.store.track(Array.from({ length: 130 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`))
    await settle()
    expect(h.posts.map((p) => p.length)).toEqual([128, 2])
  })

  it('applies what the socket delivers without reading again', async () => {
    const h = harness()
    h.store.track([A])
    await settle()
    const before = h.store.snapshot()
    h.tick(1)

    const said = message(A, NOW + 1)
    h.live()[0].listener(A, said)
    h.live()[0].listener(A, said)

    expect(h.posts).toHaveLength(1)
    expect(h.store.events(A)?.map((e) => e.id)).toEqual([said.id])
    expect(h.store.snapshot()).toEqual({ version: before.version + 1, at: before.at + 1 })
    expect(h.store.snapshot()).toBe(h.store.snapshot())
  })

  it('does not hold a live event for a channel it has not read, which would make it look read', async () => {
    const h = harness()
    h.store.apply(message(A, NOW))
    expect(h.store.events(A)).toBeUndefined()
  })

  it('ignores kinds it does not hold', async () => {
    const h = harness()
    h.store.track([A])
    await settle()
    h.store.apply(message(A, NOW, 7))
    expect(h.store.events(A)).toEqual([])
  })

  it('treats a signal with no event as "re-read"', async () => {
    const h = harness()
    h.store.track([A])
    await settle()
    h.live()[0].listener(A)
    await settle()
    expect(h.posts).toHaveLength(2)
  })

  it('catches up from the cursor less the lookback, and keeps what it held', async () => {
    const h = harness()
    const old = message(A, NOW - 100)
    h.relay.push(old)
    h.store.track([A])
    await settle()

    h.tick(600)
    const missed = message(A, NOW + 500)
    h.relay.push(missed)
    await h.store.sync()

    expect(h.posts[1][0].since).toBe(NOW - LOOKBACK)
    expect(h.store.events(A)?.map((e) => e.id)).toEqual([old.id, missed.id])
  })

  it('lets a deleted message leave on a resync, and keeps one the socket delivered mid-read', async () => {
    const h = harness()
    const deleted = message(A, NOW - 50)
    h.relay.push(deleted)
    h.store.track([A])
    await settle()
    expect(h.store.events(A)).toHaveLength(1)

    h.relay.splice(0) // the relay no longer returns it
    h.tick(10)
    const release = h.hold()
    const resync = h.store.resync()
    await settle()
    const midRead = message(A, NOW + 10)
    h.live()[0].listener(A, midRead)
    release()
    await resync

    expect(h.store.events(A)?.map((e) => e.id)).toEqual([midRead.id])
  })

  it('drops what ages out of the horizon, and keeps the newest per channel', async () => {
    const h = harness({ limitPerChannel: 2 })
    h.relay.push(message(A, NOW - 30), message(A, NOW - 20), message(A, NOW - 10))
    h.store.track([A])
    await settle()
    expect(h.store.events(A)?.map((e) => e.created_at)).toEqual([NOW - 20, NOW - 10])

    h.live()[0].listener(A, message(A, NOW))
    expect(h.store.events(A)?.map((e) => e.created_at)).toEqual([NOW - 10, NOW])

    h.tick(HORIZON + 5)
    h.live()[0].listener(A, message(A, NOW + HORIZON + 5))
    expect(h.store.events(A)?.map((e) => e.created_at)).toEqual([NOW + HORIZON + 5])
  })

  it('watches the union once, bounded by the lookback, and re-makes it only when the set moves', async () => {
    const h = harness()
    const releaseA = h.store.track([A])
    h.store.track([A, B])
    await settle()
    expect(h.live()).toHaveLength(1)
    expect(h.live()[0].channels).toEqual([A, B])
    expect(h.live()[0].since).toBe(NOW - LOOKBACK)

    releaseA() // B's caller still holds A
    await settle()
    expect(h.watches).toHaveLength(1)
  })

  it('does not re-read a channel released and tracked again in one commit', async () => {
    const h = harness()
    const release = h.store.track([A])
    await settle()
    release()
    h.store.track([A])
    await settle()
    expect(h.posts).toHaveLength(1)
    expect(h.store.events(A)).toEqual([])
  })

  it('forgets a channel nobody tracks, and stops watching it', async () => {
    const h = harness()
    const release = h.store.track([A])
    await settle()
    release()
    await settle()
    expect(h.store.events(A)).toBeUndefined()
    expect(h.live()).toHaveLength(0)
  })

  it('turns a burst of triggers into two reads at most', async () => {
    const h = harness()
    h.store.track([A])
    await settle()
    const release = h.hold()
    const first = h.store.sync()
    for (let i = 0; i < 5; i += 1) void h.store.sync()
    release()
    await first
    await settle()
    expect(h.posts).toHaveLength(3) // the load, the first sync, one follow-up
  })

  it('keeps what it held when a read fails, and reports a read nobody awaited', async () => {
    const h = harness()
    h.relay.push(message(A, NOW - 1))
    h.store.track([A])
    await settle()

    h.failWith(new Error('rate-limited: quota exceeded; retry in 8s'))
    await expect(h.store.sync()).rejects.toThrow('rate-limited')
    expect(h.store.events(A)).toHaveLength(1)

    h.store.track([B])
    await settle()
    expect(h.errors).toHaveLength(1)
    expect(h.store.events(B)).toBeUndefined()
  })

  it('reports every read with what asked for it, and a failed one with its error', async () => {
    const reads: { reason: string; mode: string; requests: number | null; outcome: string }[] = []
    const h = harness({ onRead: ({ reason, mode, requests, outcome }) => reads.push({ reason, mode, requests, outcome }) })
    h.store.track([A])
    await settle()
    await h.store.resync('interval')
    h.failWith(new Error('relay read failed: unreachable'))
    await h.store.sync('relay-live').catch(() => {})

    expect(reads).toEqual([
      { reason: 'track', mode: 'sync', requests: 1, outcome: 'ok' },
      { reason: 'interval', mode: 'resync', requests: 1, outcome: 'ok' },
      { reason: 'relay-live', mode: 'sync', requests: null, outcome: 'failed' },
    ])
  })

  it('stops everything on close', async () => {
    const h = harness()
    h.store.track([A])
    await settle()
    h.store.close()
    expect(h.live()).toHaveLength(0)
    expect(h.store.events(A)).toBeUndefined()
    await h.store.sync()
    expect(h.posts).toHaveLength(1)
  })
})
