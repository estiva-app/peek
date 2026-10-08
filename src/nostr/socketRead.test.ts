import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveClient } from '@estiva-app/platform'
import type { RelayState, SignedEvent } from '@estiva-app/protocol'

vi.mock('@/auth/estivaId', () => ({ validToken: () => null }))
vi.mock('./liveTopics', () => ({ getLiveClient: () => null }))

import { createPacer, createSocketReader, EOSE_TIMEOUT_MS, LIVE_WAIT_MS, MAX_REQS_IN_FLIGHT, REQS_PER_WINDOW, WINDOW_MS } from './socketRead'
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
  const fakeClock = () => {
    vi.useFakeTimers()
    return createPacer(REQS_PER_WINDOW, WINDOW_MS, Date.now, (fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  it(`hands out ${REQS_PER_WINDOW} slots per window and makes the next read wait for the oldest to age out`, async () => {
    const pacer = fakeClock()
    expect(await pacer.take(REQS_PER_WINDOW)).toBe('socket')
    let granted = false
    void pacer.take(1).then(() => (granted = true))
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1)
    expect(granted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).toBe(true)
  })

  it('serves the newest read first, so what is on screen does not queue behind what was left', async () => {
    const pacer = fakeClock()
    await pacer.take(REQS_PER_WINDOW)
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1_000)
    const order: string[] = []
    void pacer.take(REQS_PER_WINDOW).then(() => order.push('left'))
    void pacer.take(REQS_PER_WINDOW).then(() => order.push('on screen'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(order).toEqual(['on screen'])
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(order).toEqual(['on screen', 'left'])
  })

  it('serves a read that has waited too long before newer ones, so none waits for ever', async () => {
    const pacer = fakeClock()
    await pacer.take(REQS_PER_WINDOW)
    const order: string[] = []
    void pacer.take(REQS_PER_WINDOW).then(() => order.push('side tree'))
    // Someone keeps clicking: a newer full-window read arrives every window.
    for (let i = 0; i < 3; i++) {
      void pacer.take(REQS_PER_WINDOW).then(() => order.push(`click ${i}`))
      await vi.advanceTimersByTimeAsync(WINDOW_MS)
    }
    expect(order[0]).toBe('side tree')
  })

  it('sends a read that waited past the spill time over HTTP when HTTP may take it, and keeps one waiting when not', async () => {
    const pacer = fakeClock()
    await pacer.take(REQS_PER_WINDOW)
    const spilled = pacer.take(1, { afterMs: 1_000, allowed: () => true })
    let room = false
    const later = pacer.take(1, { afterMs: 1_000, allowed: () => room })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await spilled).toBe('http')
    room = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await later).toBe('http')
  })

  it('counts the frames the live watches sent against the same window', async () => {
    vi.useFakeTimers()
    const watches: number[] = []
    const others = (floor: number) => watches.filter((at) => at > floor)
    const pacer = createPacer(REQS_PER_WINDOW, WINDOW_MS, Date.now, (fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as ReturnType<typeof setTimeout>), others)
    for (let i = 0; i < 5; i++) watches.push(Date.now())
    let granted = false
    void pacer.take(REQS_PER_WINDOW - 4).then(() => (granted = true))
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1)
    expect(granted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).toBe(true)
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
