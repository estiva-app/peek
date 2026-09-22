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
  RATE_LIMIT_ATTEMPTS,
  RATE_LIMIT_DEFAULT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
  RelayReadError,
  classifyRelayFailure,
  describeRelayFailure,
  isOutage,
  relayFailureKind,
  retryAfterMs,
  withRateLimitRetry,
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
    for (const kind of ['unreachable', 'refused', 'rate_limited'] as const) {
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

  it('carries the wait the relay stated', () => {
    expect(new RelayReadError('rate-limited: quota exceeded; retry in 8s').retryAfterMs).toBe(8_000)
    expect(new RelayReadError('restricted: banned').retryAfterMs).toBeNull()
  })
})

/**
 * FOL-40 — a quota refusal is the relay working, and it says when to come back.
 *
 * Flattened into `unreachable` it was dropped by every `.catch` in the app, and
 * the team's unread dot lost its live re-read to it: the socket fired, the
 * re-read was refused, nothing retried, and the dot moved only on the next
 * refresh tick. The bytes are Buzz's own — `api/bridge.rs` for the 429 and
 * `connection.rs` for the socket, both emitting the same sentence.
 */
describe('a quota refusal', () => {
  it('is its own kind, over HTTP and over the socket', () => {
    for (const reason of [
      'rate-limited: quota exceeded; retry in 8s',
      'rate-limited: shared admission unavailable',
      'RATE-LIMITED: QUOTA EXCEEDED; RETRY IN 4S',
    ]) {
      expect(classifyRelayFailure(reason), reason).toBe('rate_limited')
    }
  })

  it('is not mistaken for a membership refusal, which is checked first', () => {
    // A `restricted:` prefix must still read as membership; nothing the relay
    // says about a quota carries one, but the ordering is what guarantees it.
    expect(classifyRelayFailure('restricted: relay_membership_required')).toBe('not_a_member')
  })

  it('states its own recovery time, which is read rather than guessed', () => {
    expect(retryAfterMs('rate-limited: quota exceeded; retry in 8s')).toBe(8_000)
    expect(retryAfterMs('rate-limited: quota exceeded; retry in 45 s')).toBe(45_000)
  })

  it('falls back only where the relay named no time', () => {
    // The 503 branch of the shared limiter carries no number at all.
    expect(retryAfterMs('rate-limited: shared admission unavailable')).toBe(RATE_LIMIT_DEFAULT_MS)
    // Nor is `0s` a reason to hammer it in the same tick.
    expect(retryAfterMs('rate-limited: quota exceeded; retry in 0s')).toBe(RATE_LIMIT_DEFAULT_MS)
  })

  it('is the only failure with a wait', () => {
    for (const reason of ['Failed to fetch', 'restricted: banned', 'relay_membership_required']) {
      expect(retryAfterMs(reason), reason).toBeNull()
    }
  })
})

describe('waiting out a quota window', () => {
  const limited = (seconds: number) =>
    new RelayReadError(`rate-limited: quota exceeded; retry in ${seconds}s`)

  /** A read that fails `failures` times, then answers. Records what it waited. */
  function reader(failures: number, error: () => unknown = () => limited(8)) {
    const waits: number[] = []
    let calls = 0
    const read = () => {
      calls += 1
      return calls <= failures ? Promise.reject(error()) : Promise.resolve('answered')
    }
    return {
      waits,
      calls: () => calls,
      run: (options: Parameters<typeof withRateLimitRetry>[1] = {}) =>
        withRateLimitRetry(read, {
          ...options,
          sleep: (ms) => {
            waits.push(ms)
            return Promise.resolve()
          },
        }),
    }
  }

  it('asks again at the second the relay named', async () => {
    const r = reader(1)
    await expect(r.run()).resolves.toBe('answered')
    expect(r.waits).toEqual([8_000])
    expect(r.calls()).toBe(2)
  })

  it('does not retry anything else, not even once', async () => {
    // `refused` and `not_a_member` will not change their minds, and
    // `unreachable` is already covered by the refresh triggers underneath.
    for (const reason of ['restricted: banned', 'relay_membership_required', 'Failed to fetch']) {
      const r = reader(1, () => new RelayReadError(reason))
      await expect(r.run()).rejects.toThrow()
      expect(r.calls(), reason).toBe(1)
      expect(r.waits, reason).toEqual([])
    }
  })

  it('gives up rather than waiting out windows for ever', async () => {
    const r = reader(Number.POSITIVE_INFINITY)
    await expect(r.run()).rejects.toThrow(/rate-limited/)
    expect(r.calls()).toBe(RATE_LIMIT_ATTEMPTS + 1)
  })

  it('declines a wait longer than a promise is worth holding open', async () => {
    // Past the cap the 30 s refresh triggers have re-read several times over,
    // so the answer arrives by another route first. Not shortened — a read
    // sent before the relay's window rolls over just spends the next one.
    const r = reader(1, () => limited(RATE_LIMIT_MAX_WAIT_MS / 1_000 + 1))
    await expect(r.run()).rejects.toThrow()
    expect(r.calls()).toBe(1)
    expect(r.waits).toEqual([])
  })

  it('reads the wait off a plain Error too', async () => {
    // Not everything that fails a read went through `viewerQuery`.
    const r = reader(1, () => new Error('rate-limited: quota exceeded; retry in 2s'))
    await expect(r.run()).resolves.toBe('answered')
    expect(r.waits).toEqual([2_000])
  })

  it('costs nothing when the read succeeds', async () => {
    const r = reader(0)
    await expect(r.run()).resolves.toBe('answered')
    expect(r.calls()).toBe(1)
  })
})

describe('relayFailureKind', () => {
  it('reads a classified error and an unclassified one the same way', () => {
    expect(relayFailureKind(new RelayReadError('relay_membership_required'))).toBe('not_a_member')
    expect(relayFailureKind(new Error('rate-limited: quota exceeded; retry in 8s'))).toBe(
      'rate_limited',
    )
    expect(relayFailureKind('restricted: banned')).toBe('refused')
    // Anything else is the recoverable reading, as it has always been.
    expect(relayFailureKind(undefined)).toBe('unreachable')
  })
})
