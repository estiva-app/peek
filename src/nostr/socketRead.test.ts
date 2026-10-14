import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveClient } from '@estiva-app/platform'
import type { RelayState, SignedEvent } from '@estiva-app/protocol'

vi.mock('@/auth/estivaId', () => ({ validToken: () => null }))
vi.mock('./liveTopics', () => ({ getLiveClient: () => null }))

import { createSocketReader, EOSE_TIMEOUT_MS, LIVE_WAIT_MS, MAX_REQS_IN_FLIGHT, REQS_PER_WINDOW, WINDOW_MS } from './socketRead'
import { createFrameShaper, FRAMES_PER_SECOND, FRAMES_PER_WINDOW, otherFramesSince, SHAPED_WINDOW_MS, resetSocketFrames, sendingAsRead } from './socketFrames'
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
  return {
    read: createSocketReader({ getClient: () => client, currentPubkey: () => pubkey, budget, httpBudget: { pausedForMs: () => 0 } }),
    budget,
  }
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

  it(`keeps at most ${MAX_REQS_IN_FLIGHT} REQs waiting on the relay at once`, async () => {
    const { client, subs } = fakeClient()
    const { read } = reader(client)
    const filters = Array.from({ length: (MAX_REQS_IN_FLIGHT + 2) * 10 }, (_, i) => ({ kinds: [9], '#h': [`f${i}`] }))
    const answer = read('https://relay', filters, ME)
    await vi.waitFor(() => expect(subs).toHaveLength(MAX_REQS_IN_FLIGHT))
    subs[0].onEose?.()
    subs[1].onEose?.()
    await vi.waitFor(() => expect(subs).toHaveLength(MAX_REQS_IN_FLIGHT + 2))
    expect(subs.filter((s) => !s.closed)).toHaveLength(MAX_REQS_IN_FLIGHT)
    for (const sub of subs) sub.onEose?.()
    expect(await answer).toEqual({ ok: true, events: [] })
  })

  it('sends a read for a relay the tab is not connected to over HTTP', async () => {
    const read = createSocketReader({ getClient: () => null, currentPubkey: () => ME, budget: { noteRateLimited: vi.fn(() => 0), pausedForMs: () => 0 }, httpBudget: { pausedForMs: () => 0 } })
    expect(await read('https://elsewhere', [{ kinds: [9] }], ME)).toBeNull()
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

// The pacer itself — newest click first, the starved rule, spilling, the live
// watches' frames, and the `ahead` lane — is `@estiva-app/platform`'s
// `createPacer` now, and tested there (PEE-5).
describe('reads loaded ahead (PEE-5)', () => {
  it('never go over HTTP: what would send one there fails it instead', async () => {
    const paused = { noteRateLimited: vi.fn(() => 0), pausedForMs: vi.fn(() => 1_000) }
    const { client } = fakeClient()
    const { read } = reader(client, paused)
    expect(await read('https://relay', [{ kinds: [9] }], ME, { lane: 'ahead' })).toEqual({
      ok: false,
      events: [],
      reason: 'ahead: socket paused',
    })
    const elsewhere = createSocketReader({ getClient: () => null, currentPubkey: () => ME, budget: paused, httpBudget: { pausedForMs: () => 0 } })
    expect(await elsewhere('https://elsewhere', [{ kinds: [9] }], ME, { lane: 'ahead' })).toMatchObject({ ok: false })
  })

  it('share a REQ, and each is handed what its own filters match, at most their limit', async () => {
    const { client, subs } = fakeClient()
    const { read } = reader(client)
    const old = { ...event('old'), kind: 0, created_at: 1 }
    const profile = { ...event('p'), kind: 0, created_at: 5 }
    const manifest = { ...event('m'), kind: 31990, created_at: 2 }
    const a = read('https://relay', [{ kinds: [0], authors: [ME], limit: 1 }], ME, { lane: 'ahead' })
    const b = read('https://relay', [{ kinds: [31990], limit: 20 }], ME, { lane: 'ahead' })
    const c = read('https://relay', [{ kinds: [31990], limit: 20 }], ME, { lane: 'ahead' })
    // Asked in the same moment: one REQ, the filter two of them share sent once.
    await vi.waitFor(() => expect(subs).toHaveLength(1))
    expect(subs[0].filters).toEqual([{ kinds: [0], authors: [ME], limit: 1 }, { kinds: [31990], limit: 20 }])
    for (const e of [old, profile, manifest]) subs[0].onEvent(e as SignedEvent)
    subs[0].onEose?.()
    expect(await a).toEqual({ ok: true, events: [profile] })
    expect(await b).toEqual({ ok: true, events: [manifest] })
    expect(await c).toEqual({ ok: true, events: [manifest] })
  })

  it('asked together, share one REQ; a refusal of the REQ asks each again alone', async () => {
    const { client, subs } = fakeClient()
    const { read } = reader(client)
    // A read of eleven filters is two REQs of its own, and holds both ahead slots on the wire.
    const held = read('https://relay', Array.from({ length: 11 }, (_, i) => ({ kinds: [9], '#h': [`held${i}`] })), ME, { lane: 'ahead' })
    await vi.waitFor(() => expect(subs).toHaveLength(2))
    const one = read('https://relay', [{ kinds: [9], '#h': ['one'] }], ME, { lane: 'ahead' })
    const two = read('https://relay', [{ kinds: [9], '#h': ['two'] }], ME, { lane: 'ahead' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    subs[0].onEose?.()
    subs[1].onEose?.()
    await held
    await vi.waitFor(() => expect(subs).toHaveLength(3))
    expect(subs[2].filters).toEqual([{ kinds: [9], '#h': ['one'] }, { kinds: [9], '#h': ['two'] }])
    subs[2].onClosed?.('blocked: one of these')
    await vi.waitFor(() => expect(subs).toHaveLength(5))
    expect(subs.slice(3).map((s) => s.filters)).toEqual([[{ kinds: [9], '#h': ['one'] }], [{ kinds: [9], '#h': ['two'] }]])
    subs[3].onClosed?.('blocked: one of these')
    subs[4].onEose?.()
    expect(await one).toMatchObject({ ok: false, reason: 'blocked: one of these' })
    expect(await two).toEqual({ ok: true, events: [] })
  })

  it(`take only what a window leaves over: a click still finds room at once`, async () => {
    vi.useFakeTimers()
    const { client, subs } = fakeClient()
    const { read } = reader(client)
    const wide = (n: number, tag: string) => Array.from({ length: n * 10 }, (_, i) => ({ kinds: [9], '#h': [`${tag}${i}`] }))
    // Ends every REQ sent, as they come (four at a time), until `read` has its answer.
    const answerAll = async (answer: Promise<unknown>) => {
      let done = false
      void answer.then(() => (done = true))
      while (!done) {
        for (const sub of subs) if (!sub.closed) sub.onEose?.()
        await vi.advanceTimersByTimeAsync(10)
      }
      return answer
    }
    // Boot asked most of the window.
    await answerAll(read('https://relay', wide(REQS_PER_WINDOW - 20, 'boot'), ME))
    const before = subs.length
    // Twenty left: an ahead read of ten would reach into the reserve, so it waits.
    const ahead = read('https://relay', wide(10, 'ahead'), ME, { lane: 'ahead' })
    await vi.advanceTimersByTimeAsync(100)
    expect(subs.length).toBe(before)
    // A click of ten is sent at once.
    const click = read('https://relay', wide(10, 'click'), ME)
    await vi.advanceTimersByTimeAsync(0)
    expect(subs.length).toBeGreaterThan(before)
    expect(subs.slice(before).every((sub) => String(sub.filters[0]['#h']).startsWith('click'))).toBe(true)
    expect(await answerAll(click)).toMatchObject({ ok: true })
    expect(await answerAll(ahead)).toMatchObject({ ok: true })
  })
})

describe('socket frames', () => {
  const shaper = () => {
    vi.useFakeTimers()
    resetSocketFrames()
    const out: string[] = []
    return { out, shaper: createFrameShaper((data) => out.push(data)) }
  }

  it('records the metered frames the socket sends, except the reader’s own', () => {
    const { out, shaper: s } = shaper()
    const at = Date.now()
    s.send('["REQ","peek-1",{"kinds":[9]}]')
    s.send('["EVENT",{"id":"x"}]')
    s.send('["CLOSE","peek-1"]')
    s.send('["AUTH",{"id":"y"}]')
    sendingAsRead(() => s.send('["REQ","peek-2",{"kinds":[9]}]'))
    expect(out).toHaveLength(5)
    expect(otherFramesSince(at - 1)).toHaveLength(2)
    expect(otherFramesSince(at)).toHaveLength(0)
  })

  it(`sends at most ${FRAMES_PER_SECOND} metered frames a second and ${FRAMES_PER_WINDOW} a window, the rest in order`, async () => {
    const { out, shaper: s } = shaper()
    const n = FRAMES_PER_WINDOW + 2
    for (let i = 0; i < n; i++) s.send(`["REQ","peek-${i}",{}]`)
    s.send(`["CLOSE","peek-${FRAMES_PER_WINDOW}"]`)
    expect(out).toHaveLength(FRAMES_PER_SECOND)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(out).toHaveLength(2 * FRAMES_PER_SECOND)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(out).toHaveLength(FRAMES_PER_WINDOW)
    expect(s.waiting()).toBe(3)
    await vi.advanceTimersByTimeAsync(SHAPED_WINDOW_MS)
    expect(out.slice(FRAMES_PER_WINDOW)).toEqual([
      `["REQ","peek-${FRAMES_PER_WINDOW}",{}]`,
      `["REQ","peek-${FRAMES_PER_WINDOW + 1}",{}]`,
      `["CLOSE","peek-${FRAMES_PER_WINDOW}"]`,
    ])
  })

  it('sends AUTH at once, ahead of the frames waiting for room', () => {
    const { out, shaper: s } = shaper()
    for (let i = 0; i < FRAMES_PER_SECOND + 1; i++) s.send(`["REQ","peek-${i}",{}]`)
    s.send('["AUTH",{"id":"y"}]')
    expect(out.at(-1)).toBe('["AUTH",{"id":"y"}]')
    expect(s.waiting()).toBe(1)
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

  it('answers a read loaded ahead that the socket would not take with a failure, not over HTTP (PEE-5)', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    setSocketReader(async () => null)
    expect(await queryRelay('https://relay', [{ kinds: [9] }], 'token', ME, 'ahead')).toMatchObject({ ok: false })
    expect(fetch).not.toHaveBeenCalled()
  })
})
