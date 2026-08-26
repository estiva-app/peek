/**
 * PEE-3 — the foreign-profile cache expires.
 *
 * It never did, and it cached misses forever. That was defensible while nothing
 * else refreshed either; once PEE-1 and PEE-2 re-read on a timer it became the
 * remaining reason a newly named person still rendered as `nostr:<8 chars>`
 * until a full reload — which would have read as "the refresh does not work".
 *
 * The miss TTL is the sharp end: a miss is somebody who has not finished
 * setting up their Estiva ID, which is exactly the person whose name is about
 * to arrive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROFILE_HIT_TTL_MS,
  PROFILE_MISS_TTL_MS,
  clearProfileCacheForTests,
  peopleCacheForTests,
} from './foreign'

const ADA = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

beforeEach(() => clearProfileCacheForTests())

describe('the cache still batches', () => {
  it('asks the relay once for a whole set', async () => {
    // A topic with ten reference widgets asks about the same handful of people.
    // Splitting this would turn one query into N.
    const fromRelay = vi.fn(async () => ({ [ADA]: { displayName: 'Ada' }, [BOB]: {} }))
    const people = peopleCacheForTests(fromRelay)

    await people([ADA, BOB])
    expect(fromRelay).toHaveBeenCalledTimes(1)
    expect(fromRelay).toHaveBeenCalledWith([ADA, BOB])
  })

  it('does not re-ask for something already known', async () => {
    const fromRelay = vi.fn(async () => ({ [ADA]: { displayName: 'Ada' } }))
    const people = peopleCacheForTests(fromRelay)

    await people([ADA])
    await people([ADA])
    expect(fromRelay).toHaveBeenCalledTimes(1)
  })

  it('asks only about the ones it does not hold', async () => {
    const fromRelay = vi.fn(async (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, { displayName: k.slice(0, 3) }])),
    )
    const people = peopleCacheForTests(fromRelay)

    await people([ADA])
    fromRelay.mockClear()
    await people([ADA, BOB])
    expect(fromRelay).toHaveBeenCalledWith([BOB])
  })
})

describe('expiry', () => {
  it('re-asks about a miss much sooner than a hit', async () => {
    // The whole point: a name changes rarely, a missing profile is about to
    // stop being missing.
    expect(PROFILE_MISS_TTL_MS).toBeLessThan(PROFILE_HIT_TTL_MS)
  })

  it('picks up a profile published after a miss was cached', async () => {
    let published = false
    const fromRelay = vi.fn(async () => ({ [ADA]: published ? { displayName: 'Ada' } : {} }))
    let now = 1_000_000
    const people = peopleCacheForTests(fromRelay, () => now)

    expect((await people([ADA]))[ADA]).toEqual({})

    published = true
    now += PROFILE_MISS_TTL_MS
    expect((await people([ADA]))[ADA]).toEqual({ displayName: 'Ada' })
  })

  it('holds a miss until its TTL, rather than asking every render', async () => {
    const fromRelay = vi.fn(async () => ({ [ADA]: {} }))
    let now = 1_000_000
    const people = peopleCacheForTests(fromRelay, () => now)

    await people([ADA])
    now += PROFILE_MISS_TTL_MS - 1
    await people([ADA])
    expect(fromRelay).toHaveBeenCalledTimes(1)
  })

  it('keeps a name for the longer TTL', async () => {
    const fromRelay = vi.fn(async () => ({ [ADA]: { displayName: 'Ada' } }))
    let now = 1_000_000
    const people = peopleCacheForTests(fromRelay, () => now)

    await people([ADA])
    now += PROFILE_MISS_TTL_MS * 2
    await people([ADA])
    expect(fromRelay).toHaveBeenCalledTimes(1)

    now += PROFILE_HIT_TTL_MS
    await people([ADA])
    expect(fromRelay).toHaveBeenCalledTimes(2)
  })
})
