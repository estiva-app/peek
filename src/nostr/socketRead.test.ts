import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveClient } from '@estiva-app/platform'
import type { RelayState, SignedEvent } from '@estiva-app/protocol'

vi.mock('@/auth/estivaId', () => ({ validToken: () => null }))
vi.mock('./liveTopics', () => ({ getLiveClient: () => null }))

import { createPacer, createSocketReader, EOSE_TIMEOUT_MS, LIVE_WAIT_MS, REQS_PER_WINDOW, WINDOW_MS } from './socketRead'
import { queryRelay, setSocketReader } from './bridge'
import { relayReads, resetRelayMeter } from './relayMeter'

const ME = 'a'.repeat(64)

interface FakeSub {
  filters: Record<string, unknown>[]
  onEvent: (event: SignedEvent) => void
  onEose?: () => void
  onClosed?: (reason: string) => void
  closed: boolean
}

function fakeClient(initial: RelayState = 'live') {
  let state = initial
  const listeners = new Set<(state: RelayState) => void>()
  const subs: FakeSub[] = []
  const client = {
    state: () => state,
    onState: (listener: (state: RelayState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    relay: {
      subscribe(filters: Record<string, unknown>[], onEvent: (event: SignedEvent) => void, options?: { onEose?: () => void; onClosed?: (reason: string) => void }) {
        const sub: FakeSub = { filters, onEvent, ...options, closed: false }
        subs.push(sub)
        return { close: () => void (sub.closed = true) }
      },
    },
  } as unknown as LiveClient
  return {
    client,
    subs,
    setState(next: RelayState) {
      state = next
      for (const listener of [...listeners]) listener(next)
    },
  }
}

const event = (id: string) => ({ id, kind: 9, pubkey: ME, created_at: 1, tags: [], content: '', sig: '' }) as SignedEvent

function reader(client: LiveClient, budget = { noteRateLimited: vi.fn(() => 0), pausedForMs: vi.fn(() => 0) }, pubkey: string | null = ME) {
  return { read: createSocketReader({ getClient: () => client, currentPubkey: () => pubkey, budget }), budget }
}

afterEach(() => {
  vi.useRealTimers()
  setSocketReader(null)
  vi.unstubAllGlobals()
})

describe('socket reads', () => {
  it('sends at most ten filters per REQ, merges the answers without duplicates, and closes each at EOSE', async () => {
    const { client, subs } = fakeClient()
    const { read } = reader(client)
    const filters = Array.from({ length: 23 }, (_, i) => ({ kinds: [9], '#h': [`f${i}`] }))
    const answer = read('https://relay', filters, ME)
    await vi.waitFor(() => expect(subs).toHaveLength(3))
    expect(subs.map((s) => s.filters.length)).toEqual([10, 10, 3])
    subs[0].onEvent(event('x'))
    subs[1].onEvent(event('x'))
    subs[1].onEvent(event('y'))
    for (const sub of subs) sub.onEose?.()
    expect(await answer).toEqual({ ok: true, events: [event('x'), event('y')] })
    expect(subs.every((s) => s.closed)).toBe(true)
  })

  it('answers a Folder the reader is not in with nothing, as /query does, not with an error', async () => {
    const { client, subs } = fakeClient()
    const answer = reader(client).read('https://relay', [{ '#h': ['other'] }], ME)
    await vi.waitFor(() => expect(subs).toHaveLength(1))
    subs[0].onClosed?.('restricted: not a channel member')
    expect(await answer).toEqual({ ok: true, events: [] })
  })

  it("passes the relay's other refusals through as the answer", async () => {
    const { client, subs } = fakeClient()
    const answer = reader(client).read('https://relay', [{ kinds: [1059] }], ME)
    await vi.waitFor(() => expect(subs).toHaveLength(1))
    subs[0].onClosed?.('restricted: p-gated events require #p matching your pubkey')
    expect(await answer).toEqual({ ok: false, events: [], reason: 'restricted: p-gated events require #p matching your pubkey' })
    expect(subs[0].closed).toBe(true)
  })

  it('sends a read over HTTP when the socket refuses it for quota, and pauses the socket', async () => {
    resetRelayMeter()
    const { client, subs } = fakeClient()
    const { read, budget } = reader(client)
    const answer = read('https://relay', [{ kinds: [9] }], ME)
    await vi.waitFor(() => expect(subs).toHaveLength(1))
    subs[0].onClosed?.('rate-limited: quota exceeded; retry in 3s')
    expect(await answer).toBeNull()
    expect(budget.noteRateLimited).toHaveBeenCalledWith('rate-limited: quota exceeded; retry in 3s')
    expect(relayReads(1).rateLimited).toBe(1)
    expect(relayReads(1).byShape[0].shape).toBe('socket 9')
  })

  it('does not pause the socket for the relay being busy', async () => {
    const { client, subs } = fakeClient()
    const { read, budget } = reader(client)
    const answer = read('https://relay', [{ kinds: [9] }], ME)
    await vi.waitFor(() => expect(subs).toHaveLength(1))
    subs[0].onClosed?.('rate-limited: too many concurrent requests')
    expect(await answer).toBeNull()
    expect(budget.noteRateLimited).not.toHaveBeenCalled()
  })

  it('leaves the socket alone while its quota is paused, or for another pubkey, or with no credential', async () => {
    const { client, subs } = fakeClient()
    const paused = { noteRateLimited: vi.fn(() => 0), pausedForMs: vi.fn(() => 2_000) }
    expect(await reader(client, paused).read('https://relay', [{ kinds: [9] }], ME)).toBeNull()
    expect(await reader(client).read('https://relay', [{ kinds: [9] }], 'b'.repeat(64))).toBeNull()
    expect(await reader(client, undefined, null).read('https://relay', [{ kinds: [9] }])).toBeNull()
    expect(subs).toHaveLength(0)
  })

  it('waits for a socket that is still connecting, and gives up on one that does not arrive', async () => {
    vi.useFakeTimers()
    const arriving = fakeClient('authenticating')
    const answer = reader(arriving.client).read('https://relay', [{ kinds: [9] }], ME)
    await vi.advanceTimersByTimeAsync(500)
    arriving.setState('live')
    await vi.waitFor(() => expect(arriving.subs).toHaveLength(1))
    arriving.subs[0].onEose?.()
    expect(await answer).toEqual({ ok: true, events: [] })

    const stuck = fakeClient('connecting')
    const gaveUp = reader(stuck.client).read('https://relay', [{ kinds: [9] }], ME)
    await vi.advanceTimersByTimeAsync(LIVE_WAIT_MS)
    expect(await gaveUp).toBeNull()
    expect(stuck.subs).toHaveLength(0)
  })

  it('closes a REQ and goes over HTTP when the socket drops mid-read or never sends EOSE', async () => {
    vi.useFakeTimers()
    const dropping = fakeClient()
    const dropped = reader(dropping.client).read('https://relay', [{ kinds: [9] }], ME)
    await vi.waitFor(() => expect(dropping.subs).toHaveLength(1))
    dropping.setState('reconnecting')
    expect(await dropped).toBeNull()
    expect(dropping.subs[0].closed).toBe(true)

    const silent = fakeClient()
    const timedOut = reader(silent.client).read('https://relay', [{ kinds: [9] }], ME)
    await vi.waitFor(() => expect(silent.subs).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(EOSE_TIMEOUT_MS)
    expect(await timedOut).toBeNull()
    expect(silent.subs[0].closed).toBe(true)
  })
})

describe('createPacer', () => {
  it(`hands out ${REQS_PER_WINDOW} slots per window and makes the next one wait for the oldest to age out`, async () => {
    let now = 0
    const sleeps: number[] = []
    const pacer = createPacer(REQS_PER_WINDOW, WINDOW_MS, () => now, async (ms) => {
      sleeps.push(ms)
      now += ms
    })
    for (let i = 0; i < REQS_PER_WINDOW; i++) await pacer.slot()
    expect(sleeps).toEqual([])
    now = 1_000
    await pacer.slot()
    expect(sleeps).toEqual([WINDOW_MS - 1_000])
  })
})

describe('queryRelay', () => {
  it('takes the socket’s answer and sends nothing over HTTP', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    setSocketReader(async () => ({ ok: true, events: [event('z')] }))
    expect(await queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)).toEqual({ ok: true, events: [event('z')] })
    expect(fetch).not.toHaveBeenCalled()
  })
})
