import { describe, it, expect } from 'vitest'
import {
  MAX_CONTEXTS,
  MAX_TIMESTAMP,
  READ_STATE_TAG,
  advanceContexts,
  buildReadStateEvent,
  containerContext,
  isPublishableContextId,
  loadSlotIdentity,
  messageContext,
  parseReadStateBlob,
  readStateDTag,
  readStateSlotFilter,
  serializeReadStateBlob,
  threadContext,
  toContextSeconds,
} from './readState'

const UUID = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const EVENT = 'a'.repeat(64)
const OTHER_EVENT = 'b'.repeat(64)
const SLOT = '0123456789abcdef0123456789abcdef'

describe('context identifiers (SPEC §11.1)', () => {
  /**
   * The one that matters most. CRO-4's description says `h:<folder-uuid>`; the
   * spec says bare, and says MUST NOT prefix. Blobs are grow-only, so a prefixed
   * key published once is permanent — this test is the guard on that.
   */
  it('makes the container context the BARE channel uuid, with no prefix', () => {
    expect(containerContext(UUID)).toBe(UUID)
    expect(containerContext(UUID)).not.toContain('h:')
  })

  it('refuses a container id that is not a uuid, rather than coercing it', () => {
    // A Peek topic id — a Convex seedKey. Publishing one would put an
    // identifier no other app can interpret into a grow-only blob.
    expect(containerContext('3')).toBeUndefined()
    expect(containerContext('kj29xh3k1p8s0dm4nv7q')).toBeUndefined()
    expect(containerContext('')).toBeUndefined()
    expect(containerContext(null)).toBeUndefined()
  })

  it('normalises an upper-cased uuid to the relay spelling', () => {
    expect(containerContext(UUID.toUpperCase())).toBe(UUID)
  })

  it('builds thread and message contexts from event ids', () => {
    expect(threadContext(EVENT)).toBe(`thread:${EVENT}`)
    expect(messageContext(EVENT)).toBe(`msg:${EVENT}`)
  })

  /** §11.1: a `thread:`/`msg:` key whose remainder is not 64 hex is not a
   *  well-known context and MUST NOT be treated as one. */
  it('refuses a thread or message context that is not a 64-hex event id', () => {
    expect(threadContext('m5')).toBeUndefined()
    expect(threadContext('a'.repeat(63))).toBeUndefined()
    expect(messageContext('not-an-event-id')).toBeUndefined()
  })
})

describe('toContextSeconds', () => {
  it('converts epoch ms to unix seconds', () => {
    // Peek stores milliseconds internally; NIP-RS stores seconds.
    expect(toContextSeconds(1_800_000_000_000)).toBe(1_800_000_000)
  })

  it('clamps to NIP-RS’s integer range', () => {
    expect(toContextSeconds(-1)).toBe(0)
    expect(toContextSeconds(Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMESTAMP)
  })
})

describe('slot identity', () => {
  function memoryStorage(seed?: string): Storage {
    const map = new Map<string, string>()
    if (seed) map.set('estiva-peek:read-state-slot', seed)
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage
  }

  it('mints a 32-hex slot id and persists it', () => {
    const storage = memoryStorage()
    const first = loadSlotIdentity(storage)
    expect(first.slotId).toMatch(/^[0-9a-f]{32}$/)
    expect(first.clientId.length).toBeGreaterThanOrEqual(1)
    expect(first.clientId.length).toBeLessThanOrEqual(64)
    // Same installation, same slot — the property that stops slots accumulating
    // past the reference client's limit of 8.
    expect(loadSlotIdentity(storage)).toEqual(first)
  })

  it('re-mints rather than trusting a corrupted stored slot', () => {
    expect(loadSlotIdentity(memoryStorage('not json')).slotId).toMatch(/^[0-9a-f]{32}$/)
    expect(
      loadSlotIdentity(memoryStorage(JSON.stringify({ slotId: 'short', clientId: 'x' }))).slotId,
    ).toMatch(/^[0-9a-f]{32}$/)
  })

  it('degrades to an ephemeral slot when storage is unavailable', () => {
    // Safari private mode and browsers set to block site data throw on access.
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(loadSlotIdentity(throwing).slotId).toMatch(/^[0-9a-f]{32}$/)
    expect(loadSlotIdentity(undefined).slotId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('builds the d tag the relay’s NIP-RS predicate matches', () => {
    expect(readStateDTag(SLOT)).toBe(`read-state:${SLOT}`)
    expect(() => readStateDTag('nope')).toThrow(/32 lowercase hex/)
  })
})

describe('advanceContexts — the write discipline (SPEC §11.2, §11.4)', () => {
  /**
   * §11.2, and the reason it is load-bearing rather than tidy: a container
   * holding five topics would mark four of them read.
   */
  it('advancing a thread leaves the container context untouched', () => {
    const before = { [UUID]: 1000 }
    const after = advanceContexts(before, { [`thread:${EVENT}`]: 2000 })
    expect(after[UUID]).toBe(1000)
    expect(after[`thread:${EVENT}`]).toBe(2000)
  })

  it('advancing a message leaves both the thread and the container untouched', () => {
    const before = { [UUID]: 1000, [`thread:${EVENT}`]: 1500 }
    const after = advanceContexts(before, { [`msg:${OTHER_EVENT}`]: 2000 })
    expect(after[UUID]).toBe(1000)
    expect(after[`thread:${EVENT}`]).toBe(1500)
    expect(after[`msg:${OTHER_EVENT}`]).toBe(2000)
  })

  /** §11.4: a client MUST NOT lower a timestamp; the merge rule is a maximum. */
  it('never lowers a timestamp, because there is no mark-as-unread', () => {
    expect(advanceContexts({ [UUID]: 5000 }, { [UUID]: 1000 })[UUID]).toBe(5000)
    expect(advanceContexts({ [UUID]: 5000 }, { [UUID]: 9000 })[UUID]).toBe(9000)
  })

  it('drops entries it would not publish rather than passing them through', () => {
    const after = advanceContexts(
      {},
      {
        [`h:${UUID}`]: 1000, // the prefixed spelling the ticket asked for
        '3': 1000, // a Peek topic id
        'thread:short': 1000,
        [UUID]: 1000,
      } as Record<string, number>,
    )
    expect(Object.keys(after)).toEqual([UUID])
  })

  it('drops non-integer, negative and out-of-range timestamps', () => {
    const after = advanceContexts({}, {
      [UUID]: 1.5,
      [`thread:${EVENT}`]: -1,
      [`msg:${OTHER_EVENT}`]: MAX_TIMESTAMP + 1,
    })
    expect(after).toEqual({})
  })

  it('caps at 10,000 contexts by dropping the oldest markers', () => {
    const current: Record<string, number> = {}
    for (let i = 0; i < MAX_CONTEXTS; i++) {
      current[`msg:${i.toString(16).padStart(64, '0')}`] = i + 1
    }
    const after = advanceContexts(current, { [UUID]: MAX_TIMESTAMP })
    expect(Object.keys(after)).toHaveLength(MAX_CONTEXTS)
    // The newest marker is kept and the oldest is the one that went.
    expect(after[UUID]).toBe(MAX_TIMESTAMP)
    expect(after[`msg:${(0).toString(16).padStart(64, '0')}`]).toBeUndefined()
  })
})

describe('isPublishableContextId', () => {
  it('accepts the three well-known grains and nothing else', () => {
    expect(isPublishableContextId(UUID)).toBe(true)
    expect(isPublishableContextId(`thread:${EVENT}`)).toBe(true)
    expect(isPublishableContextId(`msg:${EVENT}`)).toBe(true)
    expect(isPublishableContextId(`h:${UUID}`)).toBe(false)
    expect(isPublishableContextId('folder:30850:abc:def')).toBe(false)
    expect(isPublishableContextId('')).toBe(false)
  })

  it('refuses a context id over 256 bytes', () => {
    expect(isPublishableContextId('x'.repeat(257))).toBe(false)
  })
})

describe('the blob', () => {
  it('round-trips through serialize and parse', () => {
    const blob = { v: 1 as const, client_id: 'peek-abc', contexts: { [UUID]: 1000 } }
    expect(parseReadStateBlob(serializeReadStateBlob(blob))).toEqual(blob)
  })

  it('sorts keys, so an unchanged set is an unchanged string', () => {
    const a = serializeReadStateBlob({ v: 1, client_id: 'x', contexts: { [UUID]: 1, [`msg:${EVENT}`]: 2 } })
    const b = serializeReadStateBlob({ v: 1, client_id: 'x', contexts: { [`msg:${EVENT}`]: 2, [UUID]: 1 } })
    expect(a).toBe(b)
  })

  it('keeps the good entries and drops only the bad ones', () => {
    const parsed = parseReadStateBlob(
      JSON.stringify({
        v: 1,
        client_id: 'peek-abc',
        contexts: { [UUID]: 1000, 'not-a-context': 2000, [`thread:${EVENT}`]: 'soon' },
      }),
    )
    expect(parsed?.contexts).toEqual({ [UUID]: 1000 })
  })

  it('returns undefined for a blob it cannot trust, so it is not republished over', () => {
    expect(parseReadStateBlob(undefined)).toBeUndefined()
    expect(parseReadStateBlob('not json')).toBeUndefined()
    // An unknown version is not read with v1 rules — the blob is grow-only.
    expect(parseReadStateBlob(JSON.stringify({ v: 2, contexts: {} }))).toBeUndefined()
  })
})

describe('the event (SPEC §11.6)', () => {
  const event = buildReadStateEvent('pub', 1_800_000_000_000, SLOT, 'cipher')

  /** The relay's NIP-RS handling is a narrow predicate on exactly this shape,
   *  and an event that misses it is stored as an ordinary addressable event —
   *  which reads as a successful publish and is merged by nobody. */
  it('carries exactly one d tag and exactly one read-state t tag', () => {
    expect(event.tags.filter((t) => t[0] === 'd')).toEqual([['d', `read-state:${SLOT}`]])
    expect(event.tags.filter((t) => t[0] === 't')).toEqual([['t', READ_STATE_TAG]])
  })

  it('carries no h tag, so a global event is not scoped into a channel', () => {
    expect(event.tags.some((t) => t[0] === 'h')).toBe(false)
  })

  it('stamps created_at in seconds', () => {
    expect(event.created_at).toBe(1_800_000_000)
  })

  it('filters this installation’s own slot and nothing else', () => {
    expect(readStateSlotFilter('pub', SLOT)).toEqual({
      kinds: [30078],
      authors: ['pub'],
      '#d': [`read-state:${SLOT}`],
    })
  })
})
