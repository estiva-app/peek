import { beforeEach, describe, expect, it } from 'vitest'
import { recordRelayRequest, refusalOf, relayReads, resetRelayMeter, shapeOf } from './relayMeter'

const T0 = 1_800_000_000_000

describe('shapeOf', () => {
  it('reads a batched dot read as one shape, counted', () => {
    const filters = ['a', 'b', 'c'].map((h) => ({ kinds: [1111, 9], '#h': [h], since: 1, limit: 200 }))
    expect(shapeOf('/query', filters)).toBe('9,1111 #h×3')
  })

  it('lists different shapes in one request in the order sent', () => {
    expect(shapeOf('/query', [{ kinds: [30000], authors: ['x'] }, { kinds: [1111], '#a': ['y'] }, { kinds: [1111], '#a': ['z'] }])).toBe(
      '30000 authors + 1111 #a×2',
    )
  })

  it('names a publish by its kind', () => {
    expect(shapeOf('/events', { kind: 9, tags: [] })).toBe('events 9')
  })
})

describe('refusalOf', () => {
  // The two sentences `enforce_http_admission` answers with, verbatim.
  it('tells a spent quota from a relay that could not reach its counter', () => {
    expect(refusalOf(429, '{"error":"rate-limited: quota exceeded; retry in 8s"}')).toBe('quota')
    expect(refusalOf(503, '{"error":"rate-limited: shared admission unavailable"}')).toBe('unavailable')
    expect(refusalOf(200, '[]')).toBeNull()
    expect(refusalOf(403, '{"error":"restricted: not a member"}')).toBeNull()
  })
})

describe('relayReads', () => {
  beforeEach(() => resetRelayMeter(T0))

  it('counts the window asked about, busiest shape first, and the refusals', () => {
    const dots = [{ kinds: [9, 1111], '#h': ['a'] }]
    const follows = [{ kinds: [30000], authors: ['me'] }]
    recordRelayRequest('/query', follows, null, T0 + 10_000)
    recordRelayRequest('/query', dots, null, T0 + 70_000)
    recordRelayRequest('/query', dots, 'quota', T0 + 100_000)
    recordRelayRequest('/query', follows, 'unavailable', T0 + 110_000)
    recordRelayRequest('/query', dots, null, T0 + 115_000)

    const lastMinute = relayReads(1, T0 + 120_000)
    expect(lastMinute).toMatchObject({ minutes: 1, covered: true, total: 4, perMinute: 4, rateLimited: 1, unavailable: 1 })
    expect(lastMinute.refused).toEqual([
      { at: new Date(T0 + 100_000).toLocaleTimeString(), refusal: 'quota', shape: '9,1111 #h' },
      { at: new Date(T0 + 110_000).toLocaleTimeString(), refusal: 'unavailable', shape: '30000 authors' },
    ])
    expect(lastMinute.byShape).toEqual([
      { shape: '9,1111 #h', count: 3, perMinute: 3 },
      { shape: '30000 authors', count: 1, perMinute: 1 },
    ])

    expect(relayReads(2, T0 + 120_000)).toMatchObject({ covered: true, total: 5, perMinute: 2.5 })
  })

  it('says when the tab is younger than the window, so a short log is not read as a quiet one', () => {
    recordRelayRequest('/query', [], null, T0 + 1_000)
    expect(relayReads(5, T0 + 60_000).covered).toBe(false)
  })

  it('forgets what is older than it keeps', () => {
    recordRelayRequest('/query', [], null, T0)
    recordRelayRequest('/query', [], null, T0 + 16 * 60_000)
    expect(relayReads(30, T0 + 16 * 60_000).total).toBe(1)
  })
})
