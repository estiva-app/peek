/**
 * §2.12's rules, folded (SHR-10).
 *
 * These used to be pinned indirectly, through `convex/screenerOpenWork.test.ts`
 * observing rows that `screenMessage` had written. The rules are on the device
 * now, so they are pinned here — and more closely, because a fold can be asked
 * about a state rather than driven into one.
 *
 * The case worth naming: **a rule going quiet is invisible.** A Screener with a
 * broken rule 2 and a Screener on a workspace where nobody has been added to
 * anything render identically. So every rule gets a pair — the case that must
 * screen and the neighbouring case that must not.
 */
import { describe, expect, it } from 'vitest'
import {
  foldScreenerRows,
  screeningEvent,
  screenerRowId,
  topicIdFromScreenerRowId,
  type ScreenerCandidateContainer,
  type ScreenerCandidateEvent,
} from './screenerFold'

const T = 1_700_000_000_000

const event = (over: Partial<ScreenerCandidateEvent> = {}): ScreenerCandidateEvent => ({
  id: 'm1',
  preview: 'the newest thing said',
  createdAt: T,
  isReply: false,
  mentionsMe: false,
  iWroteInThread: false,
  ...over,
})

const container = (over: Partial<ScreenerCandidateContainer> = {}): ScreenerCandidateContainer => ({
  kind: 'topic',
  targetId: 'topic-1',
  isMember: true,
  everOpened: false,
  events: [event()],
  ...over,
})

const NO_DECISIONS = { snoozed: {}, dismissed: {} }
const titles = (map: Record<string, string>) => (id: string) => map[id]
const ONE = titles({ 'topic-1': 'The one topic' })

describe('rule 2 — added to a topic, never opened, it got a message', () => {
  it('screens for a member who has never opened it', () => {
    expect(screeningEvent(container(), 0)).toBeDefined()
  })

  it('does not screen once it has been opened', () => {
    expect(screeningEvent(container({ everOpened: true }), 0)).toBeUndefined()
  })

  it('does not screen for a non-member', () => {
    expect(screeningEvent(container({ isMember: false }), 0)).toBeUndefined()
  })
})

describe('rule 3 — you were @mentioned', () => {
  it('screens even for a non-member of an opened topic', () => {
    // Both of the other rules are off: being named is the whole reason this
    // reaches you, which is why it is not gated on membership.
    const c = container({ isMember: false, everOpened: true, events: [event({ mentionsMe: true })] })
    expect(screeningEvent(c, 0)).toBeDefined()
  })

  it('an ordinary message in an opened topic you are in does not screen', () => {
    expect(screeningEvent(container({ everOpened: true }), 0)).toBeUndefined()
  })
})

describe('the refresh rule — a reply in a thread you were in', () => {
  it('screens a reply in a thread the viewer wrote in earlier', () => {
    const c = container({
      everOpened: true,
      events: [event({ isReply: true, iWroteInThread: true })],
    })
    expect(screeningEvent(c, 0)).toBeDefined()
  })

  it('does not screen a reply in a thread the viewer never touched', () => {
    const c = container({ everOpened: true, events: [event({ isReply: true, iWroteInThread: false })] })
    expect(screeningEvent(c, 0)).toBeUndefined()
  })

  it('does not screen a top-level message just because the viewer replied in it', () => {
    // The one collapse that would make the Screener loud in exactly the busy
    // topics §2.12 keeps out of it: participation refreshes a *reply*, and a new
    // message in a topic you have opened is ordinary traffic whatever you have
    // written there before.
    const c = container({ everOpened: true, events: [event({ isReply: false, iWroteInThread: true })] })
    expect(screeningEvent(c, 0)).toBeUndefined()
  })
})

describe('the newest screening event carries the row', () => {
  it('picks the newest that screens, not the newest overall', () => {
    const c = container({
      isMember: false,
      everOpened: true,
      events: [
        event({ id: 'm3', preview: 'ordinary chatter', createdAt: T + 200 }),
        event({ id: 'm2', preview: 'and you were named', createdAt: T + 100, mentionsMe: true }),
        event({ id: 'm1', preview: 'older still', createdAt: T }),
      ],
    })
    expect(screeningEvent(c, 0)?.preview).toBe('and you were named')
  })
})

describe('dismissal is a watermark, not a deletion', () => {
  const c = container({ events: [event({ createdAt: T })] })

  it('hides the event it dismissed', () => {
    expect(screeningEvent(c, T)).toBeUndefined()
  })

  it('and everything before it', () => {
    expect(screeningEvent(c, T + 1)).toBeUndefined()
  })

  it('but later traffic screens again — which is what the row deletion did', () => {
    const later = container({ events: [event({ createdAt: T + 1 }), event({ createdAt: T })] })
    expect(screeningEvent(later, T)?.createdAt).toBe(T + 1)
  })
})

describe('foldScreenerRows', () => {
  it('drops a container held in open work (PEE-6)', () => {
    const rows = foldScreenerRows([container()], NO_DECISIONS, new Set(['topic-1']), ONE, T)
    expect(rows).toEqual([])
  })

  it('keeps one the open-work list does not hold', () => {
    const rows = foldScreenerRows([container()], NO_DECISIONS, new Set(['topic-2']), ONE, T)
    expect(rows.map((r) => r.item.topicId)).toEqual(['topic-1'])
  })

  it('hides a live snooze and returns the row once it has passed', () => {
    const snoozed = { snoozed: { 'topic:topic-1': Math.floor(T / 1000) + 60 }, dismissed: {} }
    expect(foldScreenerRows([container()], snoozed, new Set(), ONE, T)).toEqual([])
    expect(foldScreenerRows([container()], snoozed, new Set(), ONE, T + 61_000)).toHaveLength(1)
  })

  it('drops a row whose topic the workspace index cannot resolve', () => {
    // Deleted, or the index is a beat behind. Either way there is nothing to
    // draw — the read-time healing that makes a cross-user sweep unnecessary.
    const rows = foldScreenerRows([container()], NO_DECISIONS, new Set(), titles({}), T)
    expect(rows).toEqual([])
  })

  it('orders rows by their screening event, newest first', () => {
    const rows = foldScreenerRows(
      [
        container({ targetId: 'a', events: [event({ createdAt: T })] }),
        container({ targetId: 'b', events: [event({ createdAt: T + 500 })] }),
      ],
      NO_DECISIONS,
      new Set(),
      titles({ a: 'A', b: 'B' }),
      T + 1_000,
    )
    expect(rows.map((r) => r.item.topicId)).toEqual(['b', 'a'])
  })

  it('round-trips a row id back to its topic, and leaves a DM row id alone', () => {
    expect(topicIdFromScreenerRowId(screenerRowId('topic-1'))).toBe('topic-1')
    // A Convex `screenerItems` id — the DM half's row id, which must not be
    // mistaken for a folded one or its dismissal would go to the wrong record.
    expect(topicIdFromScreenerRowId('k17abcdefghijklmnopqrstuvwxyz0123')).toBeNull()
  })
})
