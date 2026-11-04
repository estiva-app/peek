// @vitest-environment jsdom
/**
 * PEE-78 — a refused read of the Screener's decisions is read again.
 *
 * It was the only read a load made: one refusal drew every row the person had
 * dismissed and not read for the rest of the load, an August one among them,
 * and a reload put them away (Katerina, 3 November). Now it is read again after
 * `READ_AGAIN_MS`, up to `READ_AGAIN_TIMES` in a row, then when the tab is
 * focused, and the answer that lands replaces `unreachable`.
 *
 * `fetchScreener` is stood in for; its own reads are `screener.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RelaySeam } from './openWork'
import type { ScreenerBlob, ScreenerRead } from './screener'

const relayAnswers: ScreenerRead[] = []
let relayReads = 0
vi.mock('./screener', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./screener')>()),
  fetchScreener: async (_seam: RelaySeam, source: 'copy' | 'relay' = 'relay'): Promise<ScreenerRead> => {
    if (source === 'copy') return { state: 'absent' }
    relayReads += 1
    return relayAnswers.shift() ?? { state: 'unreachable' }
  },
}))

const { useScreenerSync, READ_AGAIN_MS, READ_AGAIN_TIMES } = await import('./useScreenerSync')

const BLOB: ScreenerBlob = { v: 1, updatedAt: 1, snoozed: {}, dismissed: { 'dm:greg': 1_787_000_100 } }

/** Lets the hook's awaited reads settle, and moves the clock by `ms`. */
const pass = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.setItem(
    'peek.estivaId.token',
    JSON.stringify({ accessToken: 'live.token.sig', expiresAt: Date.now() + 3_600_000, pubkey: 'a'.repeat(64), refreshToken: 'r1' }),
  )
  relayAnswers.length = 0
  relayReads = 0
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('a refused read of the Screener decisions (PEE-78)', () => {
  it('is read again, and the answer replaces unreachable', async () => {
    relayAnswers.push({ state: 'unreachable' }, { state: 'present', blob: BLOB })
    const { result } = renderHook(() => useScreenerSync('wss://relay.test'))
    await pass()
    expect(result.current.state).toBe('unreachable')
    expect(relayReads).toBe(1)

    await pass(READ_AGAIN_MS)
    expect(relayReads).toBe(2)
    expect(result.current.state).toBe('present')
    expect(result.current.relayBlob).toEqual(BLOB)
  })

  it(`stops the timed re-reads after ${READ_AGAIN_TIMES}, and reads again when the tab is focused`, async () => {
    const { result } = renderHook(() => useScreenerSync('wss://relay.test'))
    await pass()
    for (let i = 0; i < READ_AGAIN_TIMES + 2; i += 1) await pass(READ_AGAIN_MS)
    // The first read and three more, then quiet: no read on a timer for ever.
    expect(relayReads).toBe(1 + READ_AGAIN_TIMES)
    expect(result.current.state).toBe('unreachable')

    relayAnswers.push({ state: 'present', blob: BLOB })
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await pass()
    expect(relayReads).toBe(2 + READ_AGAIN_TIMES)
    expect(result.current.state).toBe('present')
  })

  it('an answered load asks nothing more, on a timer or on focus', async () => {
    relayAnswers.push({ state: 'present', blob: BLOB })
    const { result } = renderHook(() => useScreenerSync('wss://relay.test'))
    await pass()
    expect(result.current.state).toBe('present')

    await pass(READ_AGAIN_MS * 2)
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await pass()
    expect(relayReads).toBe(1)
  })
})
