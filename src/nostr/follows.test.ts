/**
 * The followed set on the relay (FOL-30): the coordinate, the event, and a
 * parser that never costs the read that asked for it. `stars.test.ts`'s
 * shape, one list over.
 */
import { describe, expect, it } from 'vitest'
import { KIND } from '@estiva-app/protocol'
import {
  FOLLOWS_BLOB_TAG,
  FOLLOWS_D_TAG,
  buildFollowsEvent,
  followsFilter,
  followsToPublish,
  parseFollowsBlob,
  serializeFollowsBlob,
} from './follows'

const PUB = 'a'.repeat(64)
const ISSUE = `30851:${'b'.repeat(64)}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const TOPIC = `30840:${'b'.repeat(64)}:0a2e4f9b-2f1c-4a52-9c0f-5f0e9b0e1a11`
const FOLDER = '11111111-1111-4111-8111-111111111111'

describe('the coordinate', () => {
  it("is the suite's, not Peek's: any app that marks a file read reads the same follow set", () => {
    expect(FOLLOWS_D_TAG).toBe('estiva:followed:v1')
    expect(FOLLOWS_D_TAG.startsWith('estiva-peek:')).toBe(false)
    expect(FOLLOWS_BLOB_TAG).toBe('estiva-appdata')
  })

  it('is not the read-state prefix, which the relay hard-deletes at', () => {
    expect(FOLLOWS_D_TAG.startsWith('read-state:')).toBe(false)
  })
})

describe('the event', () => {
  it('is a kind:30078 with exactly a d tag and a t tag, and no h tag', () => {
    const event = buildFollowsEvent(PUB, 1_787_142_018_561, 'ciphertext')
    expect(event.kind).toBe(KIND.APP_DATA)
    expect(event.tags).toEqual([
      ['d', 'estiva:followed:v1'],
      ['t', 'estiva-appdata'],
    ])
    expect(event.tags.some((t) => t[0] === 'h')).toBe(false)
    expect(event.created_at).toBe(1_787_142_018)
    expect(event.content).toBe('ciphertext')
  })

  it('filters by author and coordinate, so it fetches one blob and not every 30078', () => {
    expect(followsFilter(PUB)).toEqual({ kinds: [30078], authors: [PUB], '#d': ['estiva:followed:v1'] })
  })
})

describe('parsing, which must never cost the read that asked for it', () => {
  it('round-trips a set of file addresses and Folder ids, sorted and de-duplicated', () => {
    const blob = { v: 1 as const, updatedAt: 1_787_142_018_561, keys: [TOPIC, ISSUE, FOLDER, ISSUE], muted: [ISSUE] }
    expect(parseFollowsBlob(serializeFollowsBlob(blob))).toEqual({ ...blob, keys: [FOLDER, TOPIC, ISSUE].sort() })
  })

  it('returns an empty set for anything unreadable rather than throwing', () => {
    for (const bad of [undefined, '', 'not json', 'null', '[]', '"a string"', '42']) {
      expect(parseFollowsBlob(bad)).toEqual({ v: 1, updatedAt: 0, keys: [], muted: [] })
    }
  })

  it('reads a blob written before `muted` existed as muting nothing', () => {
    expect(parseFollowsBlob(JSON.stringify({ v: 1, updatedAt: 1, keys: [ISSUE] }))).toEqual({
      v: 1,
      updatedAt: 1,
      keys: [ISSUE],
      muted: [],
    })
  })

  it('ignores an unknown version instead of guessing at it', () => {
    expect(parseFollowsBlob(JSON.stringify({ v: 2, updatedAt: 1, keys: [ISSUE] })).keys).toEqual([])
  })

  it('drops a malformed entry and keeps the rest', () => {
    const parsed = parseFollowsBlob(JSON.stringify({ v: 1, updatedAt: 1, keys: [ISSUE, 42, '', null, FOLDER], muted: [7, TOPIC] }))
    expect(parsed.keys).toEqual([ISSUE, FOLDER])
    expect(parsed.muted).toEqual([TOPIC])
  })
})

describe('what gets published', () => {
  const current = { v: 1 as const, updatedAt: 1_000, keys: [ISSUE, FOLDER], muted: [TOPIC] }
  const lists = (keys: string[], muted: string[] = [TOPIC]) => ({ keys, muted })

  it('is nothing when the set is unchanged, whatever the order', () => {
    expect(followsToPublish(lists([FOLDER, ISSUE]), current, 2_000)).toBeUndefined()
    expect(followsToPublish({ keys: new Set([ISSUE, FOLDER, ISSUE]), muted: new Set([TOPIC]) }, current, 2_000)).toBeUndefined()
  })

  it('is the new set with a fresh clock when either list changed', () => {
    expect(followsToPublish(lists([ISSUE]), current, 2_000)).toEqual({ v: 1, updatedAt: 2_000, keys: [ISSUE], muted: [TOPIC] })
    expect(followsToPublish(lists([ISSUE, FOLDER], []), current, 2_000)).toEqual({ v: 1, updatedAt: 2_000, keys: [ISSUE, FOLDER], muted: [] })
    expect(followsToPublish(lists([], []), current, 2_000)).toEqual({ v: 1, updatedAt: 2_000, keys: [], muted: [] })
  })

  it('is the whole set on a first write', () => {
    expect(followsToPublish(lists([TOPIC], []), undefined, 2_000)).toEqual({ v: 1, updatedAt: 2_000, keys: [TOPIC], muted: [] })
  })

  it('never stamps the zero the parser uses as its floor', () => {
    // `fetchFollows` reads `updatedAt: 0` as "decrypted and said nothing usable".
    expect(followsToPublish(lists([TOPIC], []), undefined, 2_000)!.updatedAt).not.toBe(0)
  })
})
