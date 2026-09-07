/**
 * Two edits in one sync run, and which one wins — RFC 0.4 §7.2.1.
 *
 * `created_at` is seconds, so two edits published in the same second have
 * nothing to separate them there. Unlike a change event, where last-write-wins
 * is per *field*, two disagreeing edits of one message resolve to whichever the
 * reader happens to sort first. `ts` settles it, under SPEC §6.2's rule.
 *
 * **Ship folds the same way** (`src/edits.ts`). Two apps with two orderings
 * would disagree about what a message says, which is worse than either answer.
 */
import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { editIsLater, editOrderingTime } from './nostr/sync'

const edit = (opts: { at: number; ts?: number; id?: string }): SignedEvent =>
  ({
    id: opts.id ?? '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: opts.at,
    kind: 40003,
    tags: [['e', 'e'.repeat(64)], ...(opts.ts === undefined ? [] : [['ts', String(opts.ts)]])],
    content: 'x',
    sig: '0'.repeat(128),
  }) as SignedEvent

describe('edit ordering', () => {
  it('prefers a later created_at', () => {
    expect(editIsLater(edit({ at: 2000 }), edit({ at: 1000 }))).toBe(true)
  })

  it('uses ts to separate two edits inside one second', () => {
    const later = edit({ at: 1000, ts: 1_000_900, id: '0'.repeat(64) })
    const earlier = edit({ at: 1000, ts: 1_000_100, id: 'f'.repeat(64) })
    // The ids are deliberately the wrong way round: without `ts` the higher id
    // would win, and it must not.
    expect(editIsLater(later, earlier)).toBe(true)
  })

  /*
    The relay bounds `created_at` and nothing bounds `ts`, so an unchecked one
    lets a client with a wrong clock reorder somebody else's edits.
  */
  it('ignores a ts that disagrees with created_at', () => {
    expect(editOrderingTime(edit({ at: 1000, ts: 9_999_000 }))).toBe(1_000_000)
    expect(editIsLater(edit({ at: 1000, ts: 9_999_000 }), edit({ at: 2000 }))).toBe(false)
  })

  it('falls back to one-second resolution with no ts', () => {
    expect(editOrderingTime(edit({ at: 1000 }))).toBe(1_000_000)
  })

  it('breaks a genuine tie on event id, stably', () => {
    expect(editIsLater(edit({ at: 1000, id: 'f'.repeat(64) }), edit({ at: 1000, id: '0'.repeat(64) }))).toBe(true)
    expect(editIsLater(edit({ at: 1000, id: '0'.repeat(64) }), edit({ at: 1000, id: 'f'.repeat(64) }))).toBe(false)
  })
})
