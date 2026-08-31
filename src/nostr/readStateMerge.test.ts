import { describe, it, expect } from 'vitest'
import {
  classifyOwnSlots,
  effectiveReadAt,
  isReadAt,
  mergeSlots,
  type SlotBlob,
} from './readStateMerge'
import { DEFAULT_HORIZON_DAYS, allSlotsFilter, type ReadStateBlob } from './readState'

const CONTAINER = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const OTHER_CONTAINER = 'c8d2f1b5-3a4e-4b97-8d26-9e1f7a3b5c02'
const ROOT = 'a'.repeat(64)
const THREAD = `thread:${ROOT}`

let seq = 0
function slot(
  clientId: string,
  contexts: Record<string, number>,
  opts: { dTag?: string; createdAt?: number } = {},
): SlotBlob {
  seq += 1
  const blob: ReadStateBlob = { v: 1, client_id: clientId, contexts }
  return {
    dTag: opts.dTag ?? `read-state:${String(seq).padStart(32, '0')}`,
    eventId: String(seq).padStart(64, '0'),
    createdAt: opts.createdAt ?? 1_700_000_000 + seq,
    blob,
  }
}

describe('mergeSlots — the max register (SPEC §11)', () => {
  /** The whole point of the project: Peek's slot and Ship's slot, one frontier. */
  it('takes the maximum per context across every slot', () => {
    const merged = mergeSlots([
      slot('peek-1', { [CONTAINER]: 1000, [THREAD]: 5000 }),
      slot('ship-1', { [CONTAINER]: 9000 }),
    ])
    expect(merged).toEqual({ [CONTAINER]: 9000, [THREAD]: 5000 })
  })

  it('is commutative, associative and idempotent', () => {
    const a = slot('peek-1', { [CONTAINER]: 1000 })
    const b = slot('ship-1', { [CONTAINER]: 9000, [THREAD]: 2000 })
    const c = slot('mobile-1', { [THREAD]: 7000 })
    const expected = { [CONTAINER]: 9000, [THREAD]: 7000 }

    expect(mergeSlots([a, b, c])).toEqual(expected)
    expect(mergeSlots([c, a, b])).toEqual(expected)
    // Idempotent: the same slot twice is the same answer.
    expect(mergeSlots([a, b, c, b, a])).toEqual(expected)
  })

  /**
   * The done-when's second half. A slot republished from a stale copy arrives
   * with old numbers, and the merge must not take them.
   */
  it('a stale blob arriving late does not lower an advanced context', () => {
    const advanced = slot('peek-1', { [CONTAINER]: 9000 })
    const stale = slot('peek-old', { [CONTAINER]: 10 })
    expect(mergeSlots([advanced, stale])[CONTAINER]).toBe(9000)
    expect(mergeSlots([stale, advanced])[CONTAINER]).toBe(9000)
  })

  it('has no side effects on the slots it merges', () => {
    const one = slot('peek-1', { [CONTAINER]: 1000 })
    const snapshot = JSON.parse(JSON.stringify(one))
    mergeSlots([one])
    mergeSlots([one])
    expect(one).toEqual(snapshot)
  })

  it('drops entries it cannot trust without discarding the blob', () => {
    const merged = mergeSlots([
      slot('peek-1', {
        [CONTAINER]: 1000,
        'not-a-context': 2000,
        [`h:${OTHER_CONTAINER}`]: 3000,
        'thread:short': 4000,
      } as Record<string, number>),
    ])
    expect(merged).toEqual({ [CONTAINER]: 1000 })
  })

  it('is empty for no slots, which is not the same as unreachable', () => {
    expect(mergeSlots([])).toEqual({})
  })
})

describe('classifyOwnSlots', () => {
  const OWN_D = 'read-state:0123456789abcdef0123456789abcdef'

  it('finds this installation by client_id', () => {
    const mine = slot('peek-abc', { [CONTAINER]: 1000 }, { dTag: OWN_D })
    const theirs = slot('ship-xyz', { [CONTAINER]: 2000 })
    const verdict = classifyOwnSlots([theirs, mine], 'peek-abc', OWN_D)
    expect(verdict.mine?.dTag).toBe(OWN_D)
    expect(verdict.staleDuplicates).toEqual([])
    expect(verdict.coordinateConflicted).toBe(false)
  })

  /** A rotation orphans a blob; a restore duplicates a client_id. Both real. */
  it('takes the highest created_at when several blobs claim our client_id', () => {
    const older = slot('peek-abc', { [CONTAINER]: 1000 }, { createdAt: 100 })
    const newer = slot('peek-abc', { [CONTAINER]: 2000 }, { createdAt: 900 })
    const verdict = classifyOwnSlots([older, newer], 'peek-abc', newer.dTag)
    expect(verdict.mine).toBe(newer)
    expect(verdict.staleDuplicates).toEqual([older])
  })

  it('still merges the stale duplicates — they hold real read state', () => {
    const older = slot('peek-abc', { [THREAD]: 1000 }, { createdAt: 100 })
    const newer = slot('peek-abc', { [CONTAINER]: 2000 }, { createdAt: 900 })
    const verdict = classifyOwnSlots([older, newer], 'peek-abc', newer.dTag)
    expect(mergeSlots([verdict.mine!, ...verdict.staleDuplicates])).toEqual({
      [CONTAINER]: 2000,
      [THREAD]: 1000,
    })
  })

  /**
   * Our coordinate holding somebody else's client_id. Publishing to it would
   * overwrite an installation that is not this one, every time, in both
   * directions — so the caller mints a new slot id instead.
   */
  it('flags our own coordinate as conflicted when it holds another client_id', () => {
    const squatter = slot('ship-xyz', { [CONTAINER]: 1000 }, { dTag: OWN_D })
    const verdict = classifyOwnSlots([squatter], 'peek-abc', OWN_D)
    expect(verdict.coordinateConflicted).toBe(true)
    expect(verdict.mine).toBeUndefined()
  })

  it('does not call a missing coordinate conflicted — that is just first run', () => {
    const verdict = classifyOwnSlots([], 'peek-abc', OWN_D)
    expect(verdict.coordinateConflicted).toBe(false)
    expect(verdict.mine).toBeUndefined()
  })
})

describe('effectiveReadAt — hierarchy at read time (SPEC §11.3)', () => {
  it("takes the later of the thread's own marker and its container's", () => {
    const merged = { [CONTAINER]: 9000, [THREAD]: 1000 }
    expect(effectiveReadAt(merged, THREAD, CONTAINER)).toBe(9000)
  })

  it("keeps the thread's own marker when it is the later one", () => {
    const merged = { [CONTAINER]: 1000, [THREAD]: 9000 }
    expect(effectiveReadAt(merged, THREAD, CONTAINER)).toBe(9000)
  })

  it('inherits the container frontier for a thread with no marker of its own', () => {
    expect(effectiveReadAt({ [CONTAINER]: 9000 }, THREAD, CONTAINER)).toBe(9000)
  })

  /** §11.3: an event that cannot be resolved to its container degrades to its
   *  own merged value rather than guessing at a frontier. */
  it('degrades to the context alone when the container is unknown', () => {
    expect(effectiveReadAt({ [THREAD]: 1000, [CONTAINER]: 9000 }, THREAD)).toBe(1000)
  })

  it('is undefined when nothing is known, because absence means unread', () => {
    expect(effectiveReadAt({}, THREAD, CONTAINER)).toBeUndefined()
  })

  /**
   * The propagation is applied at read time and never written down. Writing the
   * container's value onto the child would give the same answer today and be
   * permanent — the blob is grow-only.
   */
  it('does not write the inherited value into the merged map', () => {
    const merged = { [CONTAINER]: 9000 }
    effectiveReadAt(merged, THREAD, CONTAINER)
    expect(merged).toEqual({ [CONTAINER]: 9000 })
  })
})

describe('isReadAt', () => {
  it('answers false for a context nobody has marked', () => {
    expect(isReadAt({}, THREAD, 1000)).toBe(false)
  })

  it('answers true at the boundary, not just past it', () => {
    expect(isReadAt({ [THREAD]: 1000 }, THREAD, 1000)).toBe(true)
    expect(isReadAt({ [THREAD]: 999 }, THREAD, 1000)).toBe(false)
  })

  it('a reply newer than the container frontier stays unread', () => {
    // §11.3: marking a container read clears threads that predate the frontier;
    // replies newer than it stay unread until their own marker advances.
    const merged = { [CONTAINER]: 5000 }
    expect(isReadAt(merged, THREAD, 4000, CONTAINER)).toBe(true)
    expect(isReadAt(merged, THREAD, 6000, CONTAINER)).toBe(false)
  })
})

describe('allSlotsFilter', () => {
  const NOW = 1_800_000_000_000 // ms

  it('asks only for this person’s own slots', () => {
    const filter = allSlotsFilter('mypubkey', NOW)
    expect(filter.authors).toEqual(['mypubkey'])
    expect(filter.kinds).toEqual([30078])
    expect(filter['#t']).toEqual(['read-state'])
  })

  it('bounds the query by the horizon, in seconds', () => {
    const filter = allSlotsFilter('mypubkey', NOW)
    expect(filter.since).toBe(1_800_000_000 - DEFAULT_HORIZON_DAYS * 86_400)
  })

  it('takes an explicit horizon, for the cache work that follows', () => {
    expect(allSlotsFilter('mypubkey', NOW, 30).since).toBe(1_800_000_000 - 30 * 86_400)
  })

  it('never asks for a negative since', () => {
    expect(allSlotsFilter('mypubkey', 0, 7).since).toBe(0)
  })
})
