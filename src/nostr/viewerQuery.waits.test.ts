/**
 * A read somebody asked for waits out the relay's per-minute limit (PEEK-9).
 *
 * A file opened several times in a minute spent the person's 300 requests, and
 * the page's first read then threw at once: "This conversation could not be
 * read." for a page the relay answered seconds later. What a caller of
 * `viewerQuery` gets back is tested here: the rows, late, rather than the
 * refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewerQuery } from './foreign'
import { relayBudget } from './relayBudget'
import { RelayReadError, WAIT_OUT_MS } from './relayRead'

const TOKEN = { accessToken: 't', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 60_000 } as never
const ROW = { id: 'e1', kind: 30840, pubkey: 'f'.repeat(64), created_at: 2, content: '', sig: '', tags: [['d', 'topic']] }
const FILTERS = [{ kinds: [30840], '#d': ['topic'] }]
const wait = (seconds: number) => ({ ok: false, events: [], reason: `rate-limited: quota exceeded; retry in ${seconds}s` })

const queryRelay = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ queryRelay, queryRelayTimes: vi.fn(), publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  queryRelay.mockReset()
  // The tab's pause is shared by every read: one test's refusal is not the next one's wait.
  relayBudget.reset()
})
afterEach(() => {
  vi.useRealTimers()
})

/** The read's end, without an unhandled rejection while the clock is moved. */
function settled<T>(read: Promise<T>) {
  const end: { rows?: T; error?: unknown } = {}
  void read.then(
    (rows) => (end.rows = rows),
    (error: unknown) => (end.error = error),
  )
  return end
}

describe('a read the relay asks to wait for', () => {
  it('answers with the rows once the relay’s seconds have passed, instead of failing', async () => {
    queryRelay.mockResolvedValueOnce(wait(8)).mockResolvedValue({ ok: true, events: [ROW] })
    const end = settled(viewerQuery('https://relay', TOKEN)(FILTERS))

    await vi.advanceTimersByTimeAsync(7_900)
    // Still waiting: nothing thrown, and the relay not asked again before the second it named.
    expect(end).toEqual({})
    expect(queryRelay).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_200)
    expect(end.rows).toEqual([ROW])
    expect(queryRelay).toHaveBeenCalledTimes(2)
  })

  it('waits through a second refused minute too', async () => {
    queryRelay.mockResolvedValueOnce(wait(50)).mockResolvedValueOnce(wait(59)).mockResolvedValue({ ok: true, events: [ROW] })
    const end = settled(viewerQuery('https://relay', TOKEN)(FILTERS))

    await vi.advanceTimersByTimeAsync(112_000)
    expect(end.rows).toEqual([ROW])
  })

  it('fails as before when the relay still says wait after three minutes', async () => {
    queryRelay.mockResolvedValue(wait(59))
    const end = settled(viewerQuery('https://relay', TOKEN)(FILTERS))

    await vi.advanceTimersByTimeAsync(WAIT_OUT_MS + 5_000)
    expect(end.error).toBeInstanceOf(RelayReadError)
    expect((end.error as RelayReadError).kind).toBe('rate_limited')
  })

  it('does not hold a read loaded ahead of any click', async () => {
    queryRelay.mockResolvedValue(wait(8))
    const end = settled(viewerQuery('https://relay', TOKEN, 'ahead')(FILTERS))

    await vi.advanceTimersByTimeAsync(0)
    expect((end.error as RelayReadError).kind).toBe('rate_limited')
    expect(queryRelay).toHaveBeenCalledTimes(1)
  })

  it('holds a read loaded ahead once the person has joined it', async () => {
    let lane: 'ahead' | 'click' = 'ahead'
    queryRelay.mockResolvedValueOnce(wait(8)).mockResolvedValue({ ok: true, events: [ROW] })
    const read = viewerQuery('https://relay', TOKEN, () => lane)
    lane = 'click'
    const end = settled(read(FILTERS))

    await vi.advanceTimersByTimeAsync(9_100)
    expect(end.rows).toEqual([ROW])
  })
})

describe('a read the relay refuses', () => {
  it('is not asked again: no access will not change its mind', async () => {
    for (const reason of ['relay_membership_required', 'restricted: not allowed', 'fetch failed']) {
      queryRelay.mockReset()
      queryRelay.mockResolvedValue({ ok: false, events: [], reason })
      const end = settled(viewerQuery('https://relay', TOKEN)(FILTERS))

      await vi.advanceTimersByTimeAsync(0)
      expect(end.error, reason).toBeInstanceOf(RelayReadError)
      expect(queryRelay, reason).toHaveBeenCalledTimes(1)
    }
  })
})
