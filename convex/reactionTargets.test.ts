/**
 * The reaction-target budget, and the silent cap it used to hide.
 *
 * A kind:7 carries no `h`, so reactions are fetched addressed by target — and
 * a target that is not asked about is indistinguishable from one nobody
 * reacted to (CON-1). The old line was `[...messages, ...replies].slice(0, N)`,
 * which spends the whole budget on messages first: a topic at or over the cap
 * asked about no reply at all, and every reply reaction in it silently vanished
 * for every reader.
 */
import { describe, expect, it } from 'vitest'
import { shareTargetBudget } from './nostr/sync'

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('sharing the reaction-target budget', () => {
  it('asks about everything when everything fits', () => {
    expect(shareTargetBudget(ids('m', 3), ids('r', 2), 100)).toEqual([...ids('m', 3), ...ids('r', 2)])
  })

  /* The bug. 100 messages used to leave nothing for replies. */
  it('never lets messages crowd replies out entirely', () => {
    const out = shareTargetBudget(ids('m', 200), ids('r', 40), 100)
    expect(out).toHaveLength(100)
    expect(out.filter((id) => id.startsWith('r'))).toHaveLength(40)
  })

  it('splits evenly when both sides want more than half', () => {
    const out = shareTargetBudget(ids('m', 200), ids('r', 200), 100)
    expect(out.filter((id) => id.startsWith('m'))).toHaveLength(50)
    expect(out.filter((id) => id.startsWith('r'))).toHaveLength(50)
  })

  /* A share must not become a waste: a topic with no replies still gets to
     spend the whole budget on its messages. */
  it('gives the whole budget to messages when there are no replies', () => {
    expect(shareTargetBudget(ids('m', 200), [], 100)).toHaveLength(100)
  })

  it('gives the whole budget to replies when there are no messages', () => {
    expect(shareTargetBudget([], ids('r', 200), 100)).toHaveLength(100)
  })

  /* Both lists arrive newest-first, so truncating keeps the recent end — which
     is where reactions are. */
  it('keeps the newest of each side', () => {
    const out = shareTargetBudget(ids('m', 200), ids('r', 200), 100)
    expect(out[0]).toBe('m0')
    expect(out).toContain('r0')
    expect(out).not.toContain('m50')
  })
})
