import { describe, it, expect } from 'vitest'
import { MAX_PLAINTEXT_BYTES } from './appData'
import {
  MAX_BLOB_BYTES,
  MAX_CLIENT_ID_BYTES,
  MAX_CONTEXTS,
  MAX_CONTEXTS_BYTES,
  advanceContexts,
  capContextsToBytes,
  serializeReadStateBlob,
} from './readState'

/**
 * The byte cap on a read-state blob (SHR-4).
 *
 * The boundary these tests stand on is measured, not assumed. SHR-3 read Miky's
 * production slot on 2026-09-16: **24,379 bytes across 287 contexts, 37.2 % of
 * the ceiling**, at a mix of 202 `thread:`, 44 container, 41 file and 0 `msg:`
 * keys. Two things follow, and both are asserted below rather than described:
 * the blob refuses at around 771 contexts at that mix, so `MAX_CONTEXTS`
 * = 10,000 is some thirteen times past reach and cannot fire; and the four key
 * kinds differ by more than 2× in cost, so nothing here may reason from a
 * per-context average.
 */

const hex = (n: number, width = 64) => n.toString(16).padStart(width, '0')
const PUBKEY = 'e'.repeat(64)

/** A container key: the bare channel uuid, ~50 bytes serialized. */
const container = (n: number) =>
  `${hex(n, 8)}-${hex(n, 4)}-4${hex(n, 3)}-8${hex(n, 3)}-${hex(n, 12)}`
/** A thread key, ~85 bytes — 70 % of the production blob. */
const thread = (n: number) => `thread:${hex(n)}`
/** A file address, ~107 bytes and the most expensive kind (FOL-16). */
const file = (n: number) => `30851:${PUBKEY}:${container(n)}`

/**
 * The measured production mix, scaled: 70 % thread, 15 % container, 14 % file
 * and no `msg:` keys, with markers ascending so "oldest" is well defined.
 */
function productionMix(count: number): Record<string, number> {
  const contexts: Record<string, number> = {}
  for (let i = 0; i < count; i++) {
    const key = i % 100 < 70 ? thread(i) : i % 100 < 85 ? container(i) : file(i)
    contexts[key] = 1_700_000_000 + i
  }
  return contexts
}

const bytesOf = (contexts: Record<string, number>) =>
  new TextEncoder().encode(JSON.stringify(contexts)).length

describe('the ceiling this is all measured against', () => {
  /**
   * `readState.ts` restates the limit so it stays importable from a Node probe;
   * `appData.ts` owns the seam that enforces it. If they ever disagree, the blob
   * the queue thinks is safe is the one `/nip44/encrypt` refuses.
   */
  it('agrees with the constant the encrypt seam actually enforces', () => {
    expect(MAX_BLOB_BYTES).toBe(MAX_PLAINTEXT_BYTES)
  })

  it('leaves room for the envelope at the longest legal client_id', () => {
    const contexts = capContextsToBytes(productionMix(2_000)).contexts
    const blob = serializeReadStateBlob({
      v: 1,
      client_id: 'x'.repeat(MAX_CLIENT_ID_BYTES),
      contexts,
    })
    expect(new TextEncoder().encode(blob).length).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES)
  })

  it('accounts for the map exactly, not approximately', () => {
    const capped = capContextsToBytes(productionMix(2_000))
    expect(capped.bytes).toBe(bytesOf(capped.contexts))
    // Within one entry of the budget: the cap stops at the first key that would
    // not fit rather than leaving slack behind.
    expect(capped.bytes).toBeGreaterThan(MAX_CONTEXTS_BYTES - 120)
    expect(capped.bytes).toBeLessThanOrEqual(MAX_CONTEXTS_BYTES)
  })
})

describe('the boundary', () => {
  it('leaves a map that already fits completely alone', () => {
    const contexts = productionMix(287)
    const capped = capContextsToBytes(contexts)
    expect(capped.contexts).toEqual(contexts)
    expect(capped.evicted).toEqual([])
  })

  /** One byte over is the case the done-when names, and it costs one key. */
  it('evicts as soon as the map is one byte over, and only what it must', () => {
    const contexts = productionMix(287)
    const exact = bytesOf(contexts)
    const under = capContextsToBytes(contexts, exact)
    expect(under.evicted).toEqual([])
    expect(under.bytes).toBe(exact)

    const over = capContextsToBytes(contexts, exact - 1)
    expect(over.evicted).toHaveLength(1)
    expect(bytesOf(over.contexts)).toBeLessThanOrEqual(exact - 1)
  })

  it('drops the oldest marker, never a newer one', () => {
    const contexts = productionMix(287)
    const capped = capContextsToBytes(contexts, bytesOf(contexts) - 1)
    const [evicted] = capped.evicted
    expect(contexts[evicted]).toBe(Math.min(...Object.values(contexts)))
    expect(Object.keys(capped.contexts)).not.toContain(evicted)
  })

  /**
   * The headroom SHR-3 extrapolated, read off the code instead of a spreadsheet.
   * A range rather than a number because the mix here is the measured *ratio*
   * and not the measured 287 keys themselves; what the assertion pins is that it
   * is in the high hundreds, an order of magnitude below `MAX_CONTEXTS`.
   */
  it('refuses at around 771 contexts at the production mix, not at 10,000', () => {
    const fits = Object.keys(capContextsToBytes(productionMix(5_000)).contexts).length
    expect(fits).toBeGreaterThan(700)
    expect(fits).toBeLessThan(900)
    expect(MAX_CONTEXTS / fits).toBeGreaterThan(12)
  })

  /**
   * And why a count could not have stood in for it: the same budget holds very
   * different numbers of keys depending on the kind, so `relayContexts` is not a
   * proxy for `blobBytes` in either direction.
   */
  it('fits over 40 % more containers than file addresses in the same budget', () => {
    const only = (make: (n: number) => string) => {
      const contexts: Record<string, number> = {}
      for (let i = 0; i < 3_000; i++) contexts[make(i)] = 1_700_000_000 + i
      return Object.keys(capContextsToBytes(contexts).contexts).length
    }
    expect(only(container)).toBeGreaterThan(only(file) * 1.4)
  })
})

describe('idempotence, which is what keeps an eviction from thrashing', () => {
  /**
   * The trap SHR-4 names: read state merges by taking a maximum across slots
   * (SPEC §11.4), so a context one slot drops and another still holds comes back
   * on the next merge. Capping again has to reach the same answer, or the two
   * slots take turns evicting each other for ever.
   */
  it('applying the cap twice changes nothing', () => {
    const once = capContextsToBytes(productionMix(2_000))
    const twice = capContextsToBytes(once.contexts)
    expect(twice.contexts).toEqual(once.contexts)
    expect(twice.evicted).toEqual([])
  })

  it('re-merging what another slot still holds evicts it again, identically', () => {
    const full = capContextsToBytes(productionMix(2_000)).contexts
    const [dropped] = capContextsToBytes(productionMix(2_000)).evicted
    // The other installation hands it back. It goes again, and nothing else moves.
    const remerged = advanceContexts(full, { [dropped]: productionMix(2_000)[dropped] })
    expect(remerged).toEqual(full)
  })

  it('does not depend on insertion order', () => {
    const contexts = productionMix(2_000)
    const reversed = Object.fromEntries(Object.entries(contexts).reverse())
    expect(capContextsToBytes(reversed).contexts).toEqual(capContextsToBytes(contexts).contexts)
  })

  /**
   * The reason the budget is sized at the longest legal `client_id` rather than
   * at this installation's own: two slots with different `client_id` lengths
   * must evict the same contexts, or each one's eviction is the other's to undo.
   */
  it('produces one map that every installation can publish, whatever its client_id', () => {
    const capped = capContextsToBytes(productionMix(2_000)).contexts
    for (const clientId of ['p', 'peek-a1b2c3d4', 'x'.repeat(MAX_CLIENT_ID_BYTES)]) {
      const blob = serializeReadStateBlob({ v: 1, client_id: clientId, contexts: capped })
      expect(new TextEncoder().encode(blob).length).toBeLessThanOrEqual(MAX_PLAINTEXT_BYTES)
    }
  })

  it('breaks a tie on the same second by key, so the choice is not the map’s order', () => {
    const a = { [thread(1)]: 1000, [thread(2)]: 1000, [thread(3)]: 1000 }
    const b = { [thread(3)]: 1000, [thread(1)]: 1000, [thread(2)]: 1000 }
    const budget = bytesOf(a) - 1
    expect(capContextsToBytes(a, budget).evicted).toEqual(capContextsToBytes(b, budget).evicted)
  })
})

describe('advanceContexts holds the whole funnel inside the budget', () => {
  it('a marker recorded into a full map cannot push it over', () => {
    const full = capContextsToBytes(productionMix(2_000)).contexts
    const after = advanceContexts(full, { [thread(99_999)]: 1_800_000_000 })
    expect(bytesOf(after)).toBeLessThanOrEqual(MAX_CONTEXTS_BYTES)
    // The new marker is the newest, so it is the one that stays.
    expect(after[thread(99_999)]).toBe(1_800_000_000)
  })

  /**
   * And the case that would otherwise loop: the horizon cache re-offers a marker
   * the cap has already dropped (CRO-6 re-anchor). It is refused rather than
   * admitted-then-dropped, so the queue sees no change and schedules nothing.
   */
  it('a marker older than the budget has room for is simply not admitted', () => {
    const full = capContextsToBytes(productionMix(2_000)).contexts
    const after = advanceContexts(full, { [thread(99_999)]: 1 })
    expect(after).toEqual(full)
  })
})
