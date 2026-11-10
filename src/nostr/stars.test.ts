/**
 * The stars blob (CRO-11) — SPEC §12's first real case.
 *
 * The failures worth testing here are all silent ones. A blob that will not
 * parse costs the person their stars with no error; a `d` tag with the wrong
 * prefix hands the blob to the relay's hard-delete path; an `h` tag makes a
 * global event answer channel queries. None of those show up as a red screen.
 */
import { describe, expect, it } from 'vitest'
import { KIND } from '@estiva-app/protocol'
import {
  STARS_D_TAG,
  buildStarsEvent,
  parseStarsBlob,
  serializeStarsBlob,
  starsFilter,
  starsToPublish,
  type StarsBlob,
} from './stars'
import { BLOB_TAG, MAX_PLAINTEXT_BYTES, assertNotReadState, blobAddress } from './appData'

const PUB = 'b3'.repeat(32)
const blob = (over: Partial<StarsBlob> = {}): StarsBlob => ({
  v: 1,
  updatedAt: 1_787_142_018_561,
  topics: [],
  people: [],
  ...over,
})

describe('the address and tag conventions', () => {
  it('uses the registered client_id as the prefix, not a friendly name', () => {
    // SPEC §12.2 makes the prefix the Estiva ID client_id so two apps cannot
    // collide by construction. Peek's registered id is `estiva-peek`, and the
    // guarantee only holds if the prefix is the registered one.
    expect(STARS_D_TAG).toBe('estiva-peek:stars:v1')
    expect(BLOB_TAG).toBe('estiva-peek-appdata')
  })

  it('versions the name, so a schema change needs no migration', () => {
    expect(blobAddress('screener', 2)).toBe('estiva-peek:screener:v2')
  })

  it('refuses a name that would make the d tag ambiguous', () => {
    expect(() => blobAddress('Stars')).toThrow(/lowercase kebab/)
    expect(() => blobAddress('read state')).toThrow(/lowercase kebab/)
  })

  it('refuses the one prefix that would silently destroy history', () => {
    // A `d` beginning `read-state:` triggers the relay's NIP-RS handling, which
    // hard-deletes superseded blobs at the coordinate. App data must never
    // acquire that.
    expect(() => assertNotReadState('read-state:' + 'a'.repeat(32))).toThrow(/hard-delete/)
    expect(() => assertNotReadState(STARS_D_TAG)).not.toThrow()
  })
})

describe('the event', () => {
  it('is a kind:30078 with exactly a d tag and a t tag, and no h tag', () => {
    const event = buildStarsEvent(PUB, 1_787_142_018_561, 'ciphertext')
    expect(event.kind).toBe(KIND.APP_DATA)
    expect(event.kind).toBe(30078)
    expect(event.tags).toEqual([
      ['d', 'estiva-peek:stars:v1'],
      ['t', 'estiva-peek-appdata'],
    ])
    // SPEC §12.2 is a MUST NOT: the relay classifies the kind global-only on
    // write, but its read path treats an explicit `h` as authoritative — so a
    // stray one would not scope the event and *would* make it answer #h queries.
    expect(event.tags.some((t) => t[0] === 'h')).toBe(false)
    expect(event.created_at).toBe(1_787_142_018)
    expect(event.content).toBe('ciphertext')
  })

  it('filters by author and coordinate, so it fetches one blob and not every 30078', () => {
    expect(starsFilter(PUB)).toEqual({
      kinds: [30078],
      authors: [PUB],
      '#d': ['estiva-peek:stars:v1'],
    })
  })
})

describe('parsing, which must never cost the read that asked for it', () => {
  it('round-trips a real set', () => {
    const original = blob({
      topics: [{ id: 't1' }, { id: 't2', channelUuid: '24f5c271-3ed4-47f7-92e4-e9d6cf7f42d1' }],
      people: [{ key: 'alice' }, { key: 'bob', pubkey: PUB }],
    })
    expect(parseStarsBlob(serializeStarsBlob(original))).toEqual(original)
  })

  it('returns an empty set for anything unreadable rather than throwing', () => {
    for (const bad of [undefined, '', 'not json', 'null', '[]', '"a string"', '42']) {
      expect(parseStarsBlob(bad)).toEqual({ v: 1, updatedAt: 0, topics: [], people: [] })
    }
  })

  it('ignores an unknown version instead of guessing at it', () => {
    // Reading a v2 blob with v1 rules would silently drop whatever v2 added,
    // and last-write-wins would then make the loss permanent on the next write.
    const parsed = parseStarsBlob(JSON.stringify({ v: 2, updatedAt: 1, topics: [{ id: 't1' }], people: [] }))
    expect(parsed.topics).toEqual([])
  })

  it('drops one malformed entry and keeps the rest', () => {
    // NIP-RS makes the same choice for a context entry with a bad timestamp:
    // the entry goes, the blob survives.
    const parsed = parseStarsBlob(
      JSON.stringify({
        v: 1,
        updatedAt: 5,
        topics: [{ id: 'good' }, { id: '' }, { nope: true }, null, { id: 'also-good' }],
        people: [{ key: 'ok' }, {}],
      }),
    )
    expect(parsed.topics.map((t) => t.id)).toEqual(['good', 'also-good'])
    expect(parsed.people.map((p) => p.key)).toEqual(['ok'])
  })

  it('drops a non-finite updatedAt rather than carrying NaN into a comparison', () => {
    expect(parseStarsBlob(JSON.stringify({ v: 1, updatedAt: 'soon', topics: [], people: [] })).updatedAt).toBe(0)
  })
})

describe('serialization is stable, which is what makes "unchanged" cheap', () => {
  it('sorts, so the same set in a different order is the same string', () => {
    const a = blob({ topics: [{ id: 'b' }, { id: 'a' }], people: [{ key: 'z' }, { key: 'y' }] })
    const b = blob({ topics: [{ id: 'a' }, { id: 'b' }], people: [{ key: 'y' }, { key: 'z' }] })
    expect(serializeStarsBlob(a)).toBe(serializeStarsBlob(b))
  })

  it('stays far below the limit that actually binds', () => {
    // SPEC §12.5 calls the relay's 256 KiB ingest cap operative. For an app that
    // holds no keys — every Estiva app — /nip44/encrypt refuses a plaintext over
    // 65535 bytes first, and ciphertext is larger than plaintext.
    const many = blob({
      topics: Array.from({ length: 500 }, (_, i) => ({ id: `topic-${i}` })),
      people: Array.from({ length: 500 }, (_, i) => ({ key: `person-${i}` })),
    })
    const bytes = new TextEncoder().encode(serializeStarsBlob(many)).length
    expect(bytes).toBeLessThan(MAX_PLAINTEXT_BYTES)
  })
})

describe('deciding whether to publish', () => {
  it('publishes nothing when the set has not changed', () => {
    const current = blob({ topics: [{ id: 't1' }], people: [{ key: 'alice' }] })
    // Same set, different order, and a later clock — still nothing to say.
    const decision = starsToPublish(
      { topics: [{ id: 't1' }], people: [{ key: 'alice' }] },
      current,
      current.updatedAt + 60_000,
    )
    expect(decision).toBeUndefined()
  })

  it('publishes when an entry is added or removed', () => {
    const current = blob({ topics: [{ id: 't1' }], people: [] })
    expect(starsToPublish({ topics: [{ id: 't1' }, { id: 't2' }], people: [] }, current, 1)).toBeDefined()
    expect(starsToPublish({ topics: [], people: [] }, current, 1)).toBeDefined()
  })

  it('publishes when the relay holds nothing yet, including an empty set', () => {
    // "The relay has no blob" and "the person has no stars" are different, and
    // the first publish is what makes the coordinate exist at all.
    expect(starsToPublish({ topics: [], people: [] }, undefined, 1)).toBeDefined()
  })

  it('stamps the clock it was given', () => {
    const decision = starsToPublish({ topics: [{ id: 't' }], people: [] }, undefined, 1_787_142_018_561)
    expect(decision?.updatedAt).toBe(1_787_142_018_561)
    expect(decision?.v).toBe(1)
  })
})
