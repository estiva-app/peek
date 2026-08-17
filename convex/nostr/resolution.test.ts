/**
 * Resolution assertions (PEEK-128).
 *
 * These are Estiva's own kind, not a Buzz-mirrored one, so unlike
 * `events.test.ts` there is no external id to regress against. What is worth
 * pinning instead is the shape the wire format promises: tag order (the event
 * id preimage depends on it), append-only folding, and the ordering rule that
 * keeps two clients from disagreeing about the same run.
 */
import { describe, expect, it } from 'vitest'
import {
  ASSERTION_SUBTYPE,
  KIND,
  buildResolution,
  computeEventId,
  foldResolution,
} from './events'

const PUB = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const TARGET = '1'.repeat(64)
const SUPPORT = '2'.repeat(64)
const CHANNEL = '0f4c3d9a-1111-4222-8333-444455556666'

describe('buildResolution', () => {
  it('carries the claim, its target and its channel, in a fixed tag order', () => {
    const e = buildResolution(PUB, 1_700_000_000_000, {
      channelUuid: CHANNEL,
      targetEventId: TARGET,
      action: 'resolved',
      rationale: 'shipped in #35',
    })
    expect(e.kind).toBe(KIND.ASSERTION)
    expect(e.created_at).toBe(1_700_000_000)
    expect(e.content).toBe('shipped in #35')
    // Order is part of the id preimage — pin it, do not just check membership.
    expect(e.tags).toEqual([
      ['h', CHANNEL],
      ['e', TARGET],
      ['t', ASSERTION_SUBTYPE.RESOLUTION],
      ['action', 'resolved'],
    ])
  })

  it('marks a supporting reply so it is distinguishable from the target', () => {
    const e = buildResolution(PUB, 1_700_000_000_000, {
      channelUuid: CHANNEL,
      targetEventId: TARGET,
      action: 'resolved',
      supportingEventId: SUPPORT,
    })
    // Both are `e` tags; only the marker tells them apart.
    expect(e.tags.filter((t) => t[0] === 'e')).toEqual([
      ['e', TARGET],
      ['e', SUPPORT, '', 'support'],
    ])
  })

  it('reopen is its own assertion, not a deletion', () => {
    const e = buildResolution(PUB, 1_700_000_100_000, {
      channelUuid: CHANNEL,
      targetEventId: TARGET,
      action: 'reopened',
    })
    expect(e.kind).toBe(KIND.ASSERTION)
    expect(e.tags).toContainEqual(['action', 'reopened'])
    expect(e.content).toBe('')
  })

  it('produces a stable id for identical input', () => {
    const args = { channelUuid: CHANNEL, targetEventId: TARGET, action: 'resolved' as const }
    expect(computeEventId(buildResolution(PUB, 1_700_000_000_000, args))).toBe(
      computeEventId(buildResolution(PUB, 1_700_000_000_000, args)),
    )
  })

  it('rejects malformed ids and unknown actions', () => {
    expect(() => buildResolution('nope', 0, { channelUuid: CHANNEL, targetEventId: TARGET, action: 'resolved' })).toThrow(/pubkey/)
    expect(() => buildResolution(PUB, 0, { channelUuid: CHANNEL, targetEventId: 'nope', action: 'resolved' })).toThrow(/targetEventId/)
    // @ts-expect-error deliberately invalid at runtime
    expect(() => buildResolution(PUB, 0, { channelUuid: CHANNEL, targetEventId: TARGET, action: 'done' })).toThrow(/unknown resolution action/)
  })
})

describe('foldResolution', () => {
  const at = (id: string, created_at: number, action: 'resolved' | 'reopened', pubkey = PUB, rationale?: string) =>
    ({ id, pubkey, created_at, action, rationale })

  it('is empty-safe — nothing asserted means unresolved', () => {
    expect(foldResolution([])).toEqual({ resolved: false })
  })

  it('takes the last assertion in the run, not the first', () => {
    const folded = foldResolution([
      at('a', 100, 'resolved', PUB, 'because'),
      at('b', 200, 'reopened', OTHER),
    ])
    expect(folded.resolved).toBe(false)
    expect(folded.byPubkey).toBe(OTHER)
  })

  it('folds resolve → reopen → resolve back to resolved, keeping the latest rationale', () => {
    const folded = foldResolution([
      at('a', 100, 'resolved', PUB, 'first'),
      at('b', 200, 'reopened', OTHER),
      at('c', 300, 'resolved', PUB, 'second'),
    ])
    expect(folded).toMatchObject({ resolved: true, byPubkey: PUB, atSeconds: 300, rationale: 'second' })
  })

  it('does not depend on input order — history may arrive from the relay out of order', () => {
    const ordered = [at('a', 100, 'resolved'), at('b', 200, 'reopened'), at('c', 300, 'resolved')]
    const shuffled = [ordered[2], ordered[0], ordered[1]]
    expect(foldResolution(shuffled)).toEqual(foldResolution(ordered))
  })

  it('breaks a same-second tie by event id, so two clients agree', () => {
    // Without the tiebreak this run folds differently depending on arrival order.
    const a = at('aaa', 500, 'resolved')
    const b = at('bbb', 500, 'reopened')
    expect(foldResolution([a, b])).toEqual(foldResolution([b, a]))
    expect(foldResolution([a, b]).resolved).toBe(false) // 'bbb' sorts last
  })

  it('treats an empty rationale as absent rather than empty string', () => {
    expect(foldResolution([at('a', 100, 'resolved', PUB, '')]).rationale).toBeUndefined()
  })
})
