/**
 * PEE-9's surface: what it says, and when it says nothing.
 *
 * The done-when is that somebody who has not read the ticket can look at the
 * screen and say why the data might not be current — so the copy is the
 * feature, and it is asserted here rather than left to review.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeAge,
  describeFreshness,
  recordBackfillStart,
  recordRelayState,
  resetFreshnessForTests,
} from '@/nostr/freshness'
import { FreshnessIndicator } from './FreshnessIndicator'

const NOW = 1_756_000_000_000

beforeEach(() => resetFreshnessForTests())

describe('what it says', () => {
  it('never tells somebody their session expired for a configuration fault', () => {
    // The rule `auth/shell/contract.ts` exists to hold, on a second surface:
    // "signing in again will not fix it" must survive the trip through here.
    //
    // Asserted as the *claim* rather than the word: the shell's copy contains
    // "expired" inside the phrase "rather than an expired session", which is
    // the negation doing its job. A test that banned the word would have to be
    // satisfied by worse copy.
    const copy = describeFreshness({ kind: 'session_ended', reason: 'token_rejected' }, NOW)
    expect(copy).toMatch(/configuration problem/i)
    expect(copy).toMatch(/will not fix it/i)
    expect(copy).not.toMatch(/your .*session ended/i)
  })

  it('says the session ended when it really did', () => {
    expect(describeFreshness({ kind: 'session_ended', reason: 'session_expired' }, NOW)).toMatch(
      /session ended/i,
    )
  })

  it('describes polling as working, not broken', () => {
    // `polling` is how Peek worked for its whole life before M3. Wording it as
    // a fault trains people to ignore the indicator.
    const copy = describeFreshness(
      { kind: 'polling', lastSyncAt: NOW - 30_000, stale: false },
      NOW,
    )
    expect(copy).toMatch(/showing saved data/i)
    expect(copy).not.toMatch(/error|failed|broken/i)
  })

  it('puts the age in the polling copy, which is the actionable part', () => {
    expect(describeFreshness({ kind: 'polling', lastSyncAt: NOW - 40 * 60_000, stale: true }, NOW))
      .toMatch(/40 minutes ago/)
  })
})

describe('describing an age', () => {
  it('reads naturally across the ranges that matter', () => {
    expect(describeAge(NOW - 5_000, NOW)).toBe('synced a few seconds ago')
    expect(describeAge(NOW - 60_000, NOW)).toBe('synced 1 minute ago')
    expect(describeAge(NOW - 40 * 60_000, NOW)).toBe('synced 40 minutes ago')
    expect(describeAge(NOW - 3 * 3_600_000, NOW)).toBe('synced over 3 hours ago')
  })

  it('says so plainly when nothing has synced yet', () => {
    expect(describeAge(null, NOW)).toBe('not yet synced')
  })
})

describe('when it appears', () => {
  it('renders nothing on a fresh load, before any topic is opened', () => {
    // The production report this fixes: an amber dot on the Desk, every load.
    const { container } = render(<FreshnessIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while everything is live', () => {
    // The quietest correct state is no state — an always-visible "live" badge is
    // decoration that costs attention.
    recordRelayState('live')
    const { container } = render(<FreshnessIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  it('appears, with a readable label, once the socket is not live', () => {
    recordRelayState('reconnecting')
    render(<FreshnessIndicator />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('data-freshness', 'polling')
    expect(status.getAttribute('aria-label')).toMatch(/showing saved data/i)
  })

  it('says it is catching up while history loads', () => {
    recordRelayState('live')
    recordBackfillStart()
    render(<FreshnessIndicator />)
    expect(screen.getByRole('status')).toHaveAttribute('data-freshness', 'catching_up')
  })
})
