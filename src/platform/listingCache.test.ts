/**
 * The listing cache's four rules (SID-2), with no app: serve what is held,
 * one read per key at a time, a fresh answer is not asked again, and a
 * failure after an answer keeps the answer.
 */
import { describe, expect, it, vi } from 'vitest'
import { createListingCache, type ListingLoad } from './listingCache'

type Load = ListingLoad<string, 'unreachable'>

function deferred() {
  let answer: (load: Load) => void = () => {}
  const promise = new Promise<Load>((resolve) => (answer = resolve))
  return { promise, answer }
}

describe('listingCache', () => {
  it('holds an answer for the next reader, and tells a subscriber when it lands', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    const heard = vi.fn()
    cache.subscribe('a', heard)
    await cache.read('a', async () => ({ ok: true, value: 'rows' }))
    expect(cache.peek('a')?.value).toBe('rows')
    expect(heard).toHaveBeenCalled()
  })

  it('shares a read in flight: two readers of one key cost one load', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    const pending = deferred()
    const load = vi.fn(() => pending.promise)
    const first = cache.read('a', load)
    const second = cache.revalidate('a', load)
    const third = cache.read('a', load)
    pending.answer({ ok: true, value: 'rows' })
    await Promise.all([first, second, third])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps serving the last answer while the next read is in flight', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    await cache.read('a', async () => ({ ok: true, value: 'old' }))
    const pending = deferred()
    const next = cache.read('a', () => pending.promise)
    expect(cache.peek('a')?.value).toBe('old')
    pending.answer({ ok: true, value: 'new' })
    await next
    expect(cache.peek('a')?.value).toBe('new')
  })

  it('a revalidate of a fresh answer asks nothing; a read always asks', async () => {
    let clock = 1_000
    const cache = createListingCache<string, 'unreachable'>({ freshMs: 5_000, now: () => clock })
    const load = vi.fn(async (): Promise<Load> => ({ ok: true, value: 'rows' }))
    await cache.read('a', load)
    clock += 4_999
    await cache.revalidate('a', load)
    expect(load).toHaveBeenCalledTimes(1)
    await cache.read('a', load)
    expect(load).toHaveBeenCalledTimes(2)
    clock += 5_000
    await cache.revalidate('a', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('a failure after an answer keeps the answer; a first failure is reported (FOL-40)', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    await cache.read('a', async () => ({ ok: true, value: 'rows' }))
    await cache.read('a', async () => ({ ok: false, failure: 'unreachable' }))
    expect(cache.peek('a')).toMatchObject({ value: 'rows' })
    expect(cache.peek('a')?.failure).toBeUndefined()
    await cache.read('b', async () => ({ ok: false, failure: 'unreachable' }))
    expect(cache.peek('b')).toMatchObject({ failure: 'unreachable' })
    expect(cache.peek('b')?.value).toBeUndefined()
  })

  it('a null answer is an answer — "nothing here" — and is kept like any other', async () => {
    const cache = createListingCache<string | null, 'unreachable'>()
    await cache.read('a', async () => ({ ok: true, value: null }))
    await cache.read('a', async () => ({ ok: false, failure: 'unreachable' }))
    expect(cache.peek('a')?.value).toBeNull()
  })

  it('clear drops what is held, and a read in flight across it does not write back', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    const pending = deferred()
    const read = cache.read('a', () => pending.promise)
    cache.clear()
    pending.answer({ ok: true, value: 'rows' })
    await read
    expect(cache.peek('a')).toBeUndefined()
  })

  it('draws a seed until a read answers; a seed is never fresh, and never replaces an answer (PEE-4)', async () => {
    const cache = createListingCache<string, 'unreachable'>({ now: () => 1_000 })
    const pending = deferred()
    const read = cache.revalidate('a', () => pending.promise)
    cache.seed('a', 'from the copy')
    expect(cache.peek('a')).toMatchObject({ value: 'from the copy', seeded: true })
    pending.answer({ ok: true, value: 'from the relay' })
    await read
    expect(cache.peek('a')?.value).toBe('from the relay')
    expect(cache.peek('a')?.seeded).toBeUndefined()
    cache.seed('a', 'a late copy')
    expect(cache.peek('a')?.value).toBe('from the relay')

    // Seeded with no read: the next revalidate asks, however recent the seed.
    cache.seed('b', 'from the copy')
    const load = vi.fn(async (): Promise<Load> => ({ ok: true, value: 'from the relay' }))
    await cache.revalidate('b', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.peek('b')?.value).toBe('from the relay')
  })

  it('a read that fails after a seed keeps the seed on screen (PEE-4)', async () => {
    const cache = createListingCache<string, 'unreachable'>()
    cache.seed('a', 'from the copy')
    await cache.read('a', async () => ({ ok: false, failure: 'unreachable' }))
    expect(cache.peek('a')).toMatchObject({ value: 'from the copy', seeded: true })
    expect(cache.peek('a')?.failure).toBeUndefined()
  })
})
