/**
 * PEE-10 — classifying a failed relay read.
 *
 * The classification exists because three places need the same one, and because
 * one of the categories is not a failure at all. Getting `not_a_member` wrong
 * would tell somebody the app is broken because they opened a Folder they are
 * not in, and would light the connection indicator for a relay that answered
 * correctly and promptly.
 */
import { describe, expect, it } from 'vitest'
import {
  RelayReadError,
  classifyRelayFailure,
  describeRelayFailure,
  isOutage,
} from './relayRead'

describe('not a member is an answer, not an outage', () => {
  it('recognises the relay saying so', () => {
    // `src/nostr/sync.ts` already says this in a comment: it means the viewer is
    // not a member of that channel, which is a real answer.
    for (const reason of [
      'relay_membership_required',
      'RELAY_MEMBERSHIP_REQUIRED',
      'restricted: relay_membership_required',
    ]) {
      expect(classifyRelayFailure(reason), reason).toBe('not_a_member')
    }
  })

  it('says nothing about the relay being reachable', () => {
    expect(isOutage('not_a_member')).toBe(false)
    expect(isOutage('unreachable')).toBe(true)
    expect(isOutage('refused')).toBe(true)
  })

  it('reads as a fact about membership, not a fault', () => {
    const copy = describeRelayFailure('not_a_member')
    expect(copy).toMatch(/not a member/i)
    expect(copy).not.toMatch(/error|failed|could not reach/i)
  })
})

describe('the other two', () => {
  it('calls an explicit refusal refused', () => {
    for (const reason of ['restricted: banned', 'auth-required: not authenticated', 'forbidden']) {
      expect(classifyRelayFailure(reason), reason).toBe('refused')
    }
  })

  it('defaults to unreachable, which is the recoverable reading', () => {
    // The text is not a stable contract — `queryRelay` surfaces `parsed.error`
    // when there is one and a slice of the raw body otherwise — so the default
    // has to be the one that keeps retrying and does not tell anybody something
    // is permanently wrong.
    for (const reason of ['Failed to fetch', '', 'unparseable response: <html>']) {
      expect(classifyRelayFailure(reason), JSON.stringify(reason)).toBe('unreachable')
    }
  })

  it('never says a read failed when describing an outage', () => {
    // Plain, and never alarming: the app is still working off saved rows.
    for (const kind of ['unreachable', 'refused'] as const) {
      expect(describeRelayFailure(kind)).toMatch(/showing what was already saved/i)
    }
  })
})

describe('RelayReadError', () => {
  it('carries the reason and its classification', () => {
    const error = new RelayReadError('relay_membership_required')
    expect(error.reason).toBe('relay_membership_required')
    expect(error.kind).toBe('not_a_member')
    expect(error).toBeInstanceOf(Error)
  })
})
