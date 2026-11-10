/**
 * How often the relay is asked about a link whose read was refused (PEEKM-7's
 * review): every link's answer redraws every message and a box asks on each
 * keystroke, so a refused link must rest before the relay hears it again,
 * however many times something asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = { accessToken: 't', pubkey: 'v'.repeat(64), expiresAt: Date.now() + 3_600_000 }
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => TOKEN, storedToken: () => TOKEN }))
vi.mock('@/auth/heldSession', () => ({ heldToken: () => TOKEN }))
const queryRelay = vi.hoisted(() => vi.fn())
vi.mock('@/nostr/bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { forgetUrlShapes } from '@/nostr/foreign'
import { askLinks, knownCardValue, onLinksChanged } from './foreign'

const AUTHOR = 'f'.repeat(64)
const REFUSED = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const FINE = 'c5fb7a7b-e5b3-4944-9a3b-7bb2f3a4d5e6'
const manifest = {
  id: 'm1',
  kind: 31990,
  pubkey: AUTHOR,
  created_at: 1,
  content: '{}',
  sig: '',
  tags: [
    ['d', 'estiva-ship'],
    ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>', '30851'],
  ],
}
const issue = (d: string) => ({ id: d, kind: 30851, pubkey: AUTHOR, created_at: 2, content: '', sig: '', tags: [['d', d]] })
const refusedUrl = `https://ship.estiva.app/issue/plan-${REFUSED}`
const fineUrl = `https://ship.estiva.app/issue/notes-${FINE}`

let refuse = true
/** The `#d` reads the relay heard for a `d`. */
const readsOf = (d: string) =>
  queryRelay.mock.calls.filter((call) => ((call[1] as Record<string, unknown>[])[0]?.['#d'] as string[] | undefined)?.[0] === d).length

beforeEach(() => {
  vi.useFakeTimers()
  forgetUrlShapes()
  refuse = true
  queryRelay.mockReset()
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
    if ((filters[0]?.kinds as number[] | undefined)?.includes(31990)) return { ok: true, events: [manifest] }
    const d = (filters[0]?.['#d'] as string[] | undefined)?.[0]
    if (d === REFUSED) return refuse ? { ok: false, reason: 'rate-limited' } : { ok: true, events: [issue(REFUSED)] }
    return { ok: true, events: d === FINE ? [issue(FINE)] : [] }
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a link whose read the relay refused', () => {
  it('is not asked again while it rests, however often the messages and the box ask', async () => {
    await expect(askLinks([refusedUrl, fineUrl])).rejects.toThrow()
    expect(knownCardValue(fineUrl)).toBe(`30851:${AUTHOR}:${FINE}`)
    // Every message drawing it asks again on each answer, the box on each keystroke.
    for (let i = 0; i < 20; i += 1) await askLinks([refusedUrl, fineUrl]).catch(() => {})
    expect(readsOf(REFUSED)).toBe(1)
    expect(readsOf(FINE)).toBe(1)
  })

  it('is told as a change once it has rested, and the next ask names it', async () => {
    const told = vi.fn()
    const stop = onLinksChanged(told)
    try {
      await expect(askLinks([refusedUrl])).rejects.toThrow()
      refuse = false
      await vi.advanceTimersByTimeAsync(4_999)
      expect(told).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(told).toHaveBeenCalledTimes(1)
      await expect(askLinks([refusedUrl])).resolves.toBeUndefined()
      expect(knownCardValue(refusedUrl)).toBe(`30851:${AUTHOR}:${REFUSED}`)
    } finally {
      stop()
    }
  })
})
