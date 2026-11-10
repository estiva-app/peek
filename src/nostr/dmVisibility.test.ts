/*
  The hidden-DM set (DMS-6).

  What matters here is the reading discipline, not the plumbing: the newest
  snapshot is the whole set, older ones contribute nothing, no snapshot is an
  empty set rather than an unknown, and the only filter ever sent names the
  viewer's own `p`. The event shapes are the relay's — `publish_dm_visibility_snapshot`
  in `side_effects.rs`: `d` = viewer, `p` = viewer, one `h` per hidden channel.
*/
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId, queryRelay } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
  queryRelay: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay }))

import { dmVisibilityFilter, fetchHiddenDms, hiddenChannelsOf, publishDmHide } from './dmVisibility'

const ME = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY_KEY = 'df1493e1df1493e1df1493e1df1493e1df1493e1df1493e1df1493e1df1493e1'
const A = '6a8d299d-f86c-4b42-a2de-8954f4ed1d91'
const B = '24f5c271-3ed4-47f7-92e4-e9d6cf7f42d1'
const seam = { relayUrl: 'https://relay.test', accessToken: 't', pubkey: ME }

/** A relay-signed snapshot listing `hidden`, at `created_at`. */
const snapshot = (created_at: number, hidden: string[]) => ({
  id: `s${created_at}`,
  pubkey: RELAY_KEY,
  created_at,
  kind: 30622,
  tags: [['d', ME], ['p', ME], ...hidden.map((h) => ['h', h])],
  content: '',
  sig: 'x',
})

beforeEach(() => {
  publishSigned.mockReset()
  signViaEstivaId.mockReset()
  queryRelay.mockReset()
  signViaEstivaId.mockImplementation(async (event: unknown) => event)
})

describe('reading the hidden set', () => {
  it('asks only for the viewer\'s own snapshot, by #p, newest one', () => {
    expect(dmVisibilityFilter(ME)).toEqual({ kinds: [30622], '#p': [ME], limit: 1 })
  })

  it('takes the newest snapshot whole and nothing from an older one', () => {
    // Older: A and B hidden. Newer: only B — A was re-opened. A merge would
    // keep A hidden for ever; the newest event replaces the set.
    const hidden = hiddenChannelsOf([snapshot(100, [A, B]), snapshot(200, [B])])
    expect([...hidden]).toEqual([B])
  })

  it('reads no snapshot as nothing hidden, which is an answer and not an unknown', async () => {
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    const read = await fetchHiddenDms(seam)
    expect(read).toEqual({ state: 'present', hidden: new Set() })
  })

  it('reports a relay that did not answer as unreachable, never as empty', async () => {
    queryRelay.mockResolvedValue({ ok: false, events: [], reason: 'boom' })
    expect(await fetchHiddenDms(seam)).toEqual({ state: 'unreachable' })
  })

  it('ignores tags that are not h', () => {
    expect(hiddenChannelsOf([snapshot(1, [A])]).has(ME)).toBe(false)
  })
})

describe('hiding a DM', () => {
  it('builds, signs and sends a 41012 naming the channel, and nothing else', async () => {
    publishSigned.mockResolvedValue({ ok: true, eventId: 'e1', httpStatus: 200, message: '{}' })

    const result = await publishDmHide(A, seam)

    expect(result).toEqual({ ok: true })
    const [[event, accessToken, pubkey]] = signViaEstivaId.mock.calls as [[{ kind: number; pubkey: string; tags: string[][]; content: string }, string, string]]
    expect([accessToken, pubkey]).toEqual(['t', ME])
    expect(event).toMatchObject({ kind: 41012, pubkey: ME, tags: [['h', A]], content: '' })
  })

  it('never signs a 30622 — the only event it sends is the 41012', async () => {
    publishSigned.mockResolvedValue({ ok: true, eventId: 'e1', httpStatus: 200, message: '{}' })
    await publishDmHide(A, seam)
    const kinds = signViaEstivaId.mock.calls.map(([e]) => (e as { kind: number }).kind)
    expect(kinds).toEqual([41012])
  })

  it('carries the relay\'s refusal back by reason', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'forbidden: not a member of this DM' })
    const result = await publishDmHide(A, seam)
    expect(result).toEqual({ ok: false, reason: 'forbidden: not a member of this DM' })
  })
})
