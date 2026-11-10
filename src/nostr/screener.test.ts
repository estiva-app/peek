/**
 * The Screener decisions blob (SHR-10).
 *
 * Two things here are worth a test rather than a reading: the parser's floor,
 * which every layer-2 store in this app shares and which decides whether a bad
 * blob costs the state or the read; and the eviction order, which is a product
 * ruling — an evicted dismissal is recoverable and an evicted snooze is a broken
 * promise — expressed as a budget split that nothing else would catch.
 */
import { describe, expect, it } from 'vitest'
import {
  SCREENER_D_TAG,
  buildScreenerEvent,
  capScreenerBlob,
  parseScreenerBlob,
  screenerKey,
  screenerToPublish,
  serializeScreenerBlob,
  type ScreenerBlob,
} from './screener'
import { MAX_PLAINTEXT_BYTES } from './appData'

const T = 1_700_000_000_000
const SEC = Math.floor(T / 1000)

const blob = (over: Partial<ScreenerBlob> = {}): ScreenerBlob => ({
  v: 1,
  updatedAt: T,
  snoozed: {},
  dismissed: {},
  ...over,
})

describe('the coordinate', () => {
  it('is its own, and is not the read-state one', () => {
    expect(SCREENER_D_TAG).toBe('estiva-peek:screener:v1')
  })

  it('carries no `h` tag — SPEC §12.2 makes that a MUST NOT', () => {
    const event = buildScreenerEvent('a'.repeat(64), T, 'cipher')
    expect(event.tags.some((t) => t[0] === 'h')).toBe(false)
    expect(event.tags.find((t) => t[0] === 'd')?.[1]).toBe(SCREENER_D_TAG)
  })
})

describe('parseScreenerBlob', () => {
  it('round-trips what it serialized', () => {
    const b = blob({ snoozed: { 'topic:a': SEC + 60 }, dismissed: { 'topic:b': SEC } })
    expect(parseScreenerBlob(serializeScreenerBlob(b))).toEqual(b)
  })

  it('floors to empty on junk, an unknown version, and nothing at all', () => {
    for (const input of [undefined, '', 'not json', '[]', JSON.stringify({ v: 2, snoozed: { a: 1 } })]) {
      expect(parseScreenerBlob(input)).toEqual({ v: 1, updatedAt: 0, snoozed: {}, dismissed: {} })
    }
  })

  it('drops a malformed entry without discarding its neighbours', () => {
    const parsed = parseScreenerBlob(
      JSON.stringify({ v: 1, updatedAt: T, snoozed: { good: SEC, bad: 'soon', worse: null }, dismissed: {} }),
    )
    expect(parsed.snoozed).toEqual({ good: SEC })
  })

  it('drops a zero or negative instant, which would dismiss a conversation for ever', () => {
    const parsed = parseScreenerBlob(
      JSON.stringify({ v: 1, updatedAt: T, snoozed: {}, dismissed: { a: 0, b: -1, c: SEC } }),
    )
    expect(parsed.dismissed).toEqual({ c: SEC })
  })

  it('reports `updatedAt: 0` for a blob that said nothing usable — the `absent` floor', () => {
    // `fetchScreener` turns this into `absent` rather than `present` with an
    // empty pair, and the two license opposite things. Pinned here because it is
    // an invariant between two functions rather than a property of either.
    expect(parseScreenerBlob('{"v":1}').updatedAt).toBe(0)
  })
})

describe('capScreenerBlob', () => {
  it('drops a snooze whose instant has passed, and keeps a live one', () => {
    const capped = capScreenerBlob(blob({ snoozed: { past: SEC - 1, future: SEC + 1 } }), T)
    expect(capped.blob.snoozed).toEqual({ future: SEC + 1 })
    // Expiry is not eviction: nothing was lost and nothing is reported.
    expect(capped.evictedSnoozed).toEqual([])
  })

  it('fits inside the plaintext ceiling the relay refuses above', () => {
    const snoozed: Record<string, number> = {}
    const dismissed: Record<string, number> = {}
    for (let i = 0; i < 3_000; i++) {
      snoozed[`topic:${String(i).padStart(36, '0')}`] = SEC + 10_000 + i
      dismissed[`topic:${String(i).padStart(36, '1')}`] = SEC + i
    }
    const capped = capScreenerBlob(blob({ snoozed, dismissed }), T)
    const bytes = new TextEncoder().encode(serializeScreenerBlob(capped.blob)).length
    expect(bytes).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES)
    // And it actually filled it rather than giving up early.
    expect(bytes).toBeGreaterThan(MAX_PLAINTEXT_BYTES - 200)
  })

  it('gives `dismissed` up before `snoozed` — the ruling, as a budget', () => {
    const snoozed: Record<string, number> = {}
    const dismissed: Record<string, number> = {}
    for (let i = 0; i < 400; i++) {
      snoozed[`topic:s${String(i).padStart(36, '0')}`] = SEC + 10_000 + i
      dismissed[`topic:d${String(i).padStart(36, '0')}`] = SEC + i
    }
    // A budget that holds every snooze and only some of the dismissals — the
    // case the ruling is about. (Each entry is ~57 bytes at these key widths,
    // so 400 snoozes are ~23 KB and the remainder is what `dismissed` gets.)
    const capped = capScreenerBlob(blob({ snoozed, dismissed }), T, 30_000)
    expect(capped.evictedSnoozed).toEqual([])
    expect(capped.evictedDismissed.length).toBeGreaterThan(0)
    expect(Object.keys(capped.blob.snoozed)).toHaveLength(400)
  })

  it('evicts snoozes only once they alone overflow, and then keeps no dismissals', () => {
    // The far end of the same rule. `snoozed` is budgeted first, so a budget it
    // cannot fit by itself leaves nothing for `dismissed` — every dismissal
    // goes before the first snooze does, which is the order stated as a
    // recoverable loss before an unrecoverable one.
    const snoozed: Record<string, number> = {}
    const dismissed: Record<string, number> = {}
    for (let i = 0; i < 400; i++) {
      snoozed[`topic:s${String(i).padStart(36, '0')}`] = SEC + 10_000 + i
      dismissed[`topic:d${String(i).padStart(36, '0')}`] = SEC + i
    }
    const capped = capScreenerBlob(blob({ snoozed, dismissed }), T, 8_000)
    expect(capped.evictedSnoozed.length).toBeGreaterThan(0)
    expect(capped.blob.dismissed).toEqual({})
    expect(capped.evictedDismissed).toHaveLength(400)
  })

  it('evicts the oldest instant first within a map', () => {
    const dismissed: Record<string, number> = {}
    for (let i = 0; i < 400; i++) dismissed[`topic:${String(i).padStart(36, '0')}`] = SEC + i
    const capped = capScreenerBlob(blob({ dismissed }), T, 4_000)
    const kept = Object.values(capped.blob.dismissed)
    const dropped = capped.evictedDismissed.map((k) => dismissed[k])
    expect(Math.min(...kept)).toBeGreaterThan(Math.max(...dropped))
  })
})

describe('screenerToPublish', () => {
  it('returns nothing for an unchanged pair, so a re-render costs no write', () => {
    const current = blob({ dismissed: { 'topic:a': SEC } })
    expect(screenerToPublish({ snoozed: {}, dismissed: { 'topic:a': SEC } }, current, T + 5)).toBeUndefined()
  })

  it('compares after capping, so an expiring snooze publishes exactly once', () => {
    const current = blob({ snoozed: { 'topic:a': SEC + 10 } })
    // Still live: nothing to say.
    expect(screenerToPublish({ snoozed: { 'topic:a': SEC + 10 }, dismissed: {} }, current, T)).toBeUndefined()
    // Passed: one write that removes it…
    const first = screenerToPublish({ snoozed: { 'topic:a': SEC + 10 }, dismissed: {} }, current, T + 20_000)
    expect(first?.blob.snoozed).toEqual({})
    // …and nothing more once the relay holds the shorter blob.
    expect(screenerToPublish({ snoozed: {}, dismissed: {} }, first!.blob, T + 30_000)).toBeUndefined()
  })

  it('stamps a clock, which is what keeps `updatedAt: 0` meaning "unusable"', () => {
    expect(screenerToPublish({ snoozed: { a: SEC + 1 }, dismissed: {} }, undefined, T)?.blob.updatedAt).toBe(T)
  })
})

describe('screenerKey', () => {
  it('spells a topic and a DM apart, and cannot shadow', () => {
    expect(screenerKey('topic', 'x')).toBe('topic:x')
    expect(screenerKey('dm', 'x')).toBe('dm:x')
  })
})
