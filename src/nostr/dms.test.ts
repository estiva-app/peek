/*
  A person's DM channels (DMS-3, REM-3).

  Two halves: which DMs exist, read off the relay's `39000`s, and opening one.
  The interesting part of the second is not the happy path: it is that the
  relay can accept a `41010` and tell you nothing. Every relay answer asserted
  here is one that was read off production (2026-09-17, 2026-09-24), not one
  invented to make a branch reachable — including the empty one.
*/
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId, queryRelay } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
  queryRelay: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay }))

import { dmChannelFilters, dmChannelsOf, fetchDmChannels, publishDmChannel } from './dms'

const ME = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const PARTNER = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const OTHER = 'a8a7d73900000000000000000000000000000000000000000000000000000000'
const RELAY_KEY = '8b75a34d00000000000000000000000000000000000000000000000000000000'
const CHANNEL = '6a8d299d-f86c-4b42-a2de-8954f4ed1d91'
const SECOND = '24f5c271-3ed4-47f7-92e4-e9d6cf7f42d1'
const seam = { relayUrl: 'https://relay.test', accessToken: 't', pubkey: ME }

/**
 * A DM's `39000` as the relay emits it — `emit_group_discovery_events`: `d`,
 * `private`, `hidden`, one `p` per member, `closed`, `t=dm`. Read off
 * production for `CHANNEL` on 2026-09-24.
 */
const dmMetadata = (d: string, members: string[], extra: string[][] = [], created_at = 1789660000) => ({
  id: `m-${d}-${created_at}`,
  pubkey: RELAY_KEY,
  created_at,
  kind: 39000,
  tags: [['d', d], ['private'], ['hidden'], ...members.map((p) => ['p', p]), ['closed'], ['t', 'dm'], ...extra],
  content: '',
  sig: 'x',
})

/** The relay's answer to a `41010` it acted on. */
const opened = (created: boolean) => ({
  ok: true,
  eventId: 'e1',
  httpStatus: 200,
  message: `response:{"channel_id":"${CHANNEL}","created":${created}}`,
})

/** The relay's answer to a byte-identical replay: accepted, and no channel. */
const replayed = {
  ok: true,
  eventId: 'e1',
  httpStatus: 200,
  duplicate: true,
  message: 'duplicate: already processed',
}

const sent = () =>
  signViaEstivaId.mock.calls.map(([event]) => event as { kind: number; tags: string[][]; created_at: number })

beforeEach(() => {
  publishSigned.mockReset()
  signViaEstivaId.mockReset()
  queryRelay.mockReset()
  signViaEstivaId.mockImplementation(async (event: unknown) => event)
})

describe('which DMs exist', () => {
  it('asks by the viewer\'s own #p, one value per filter, and by t=dm', () => {
    expect(dmChannelFilters(ME)).toEqual([
      { kinds: [39000], '#p': [ME], limit: 500 },
      { kinds: [39000], '#t': ['dm'], limit: 500 },
    ])
  })

  it('keys each DM by the one other participant', () => {
    const byPartner = dmChannelsOf([dmMetadata(CHANNEL, [ME, PARTNER]), dmMetadata(SECOND, [OTHER, ME])], ME)
    expect(byPartner).toEqual(
      new Map([
        [PARTNER, CHANNEL],
        [OTHER, SECOND],
      ]),
    )
  })

  it('leaves out what is not a one-to-one DM: a stream, a group DM, an archived one', () => {
    const stream = { ...dmMetadata(SECOND, [ME, OTHER]), tags: [['d', SECOND], ['p', ME], ['p', OTHER]] }
    const group = dmMetadata('group', [ME, PARTNER, OTHER])
    const archived = dmMetadata('gone', [ME, OTHER], [['archived']])
    expect(dmChannelsOf([stream, group, archived], ME).size).toBe(0)
  })

  it('counts the same DM once when both filters return it', () => {
    const e = dmMetadata(CHANNEL, [ME, PARTNER])
    expect(dmChannelsOf([e, e], ME)).toEqual(new Map([[PARTNER, CHANNEL]]))
  })

  it('takes the partner from the 39002 when the 39000 names nobody', async () => {
    const untagged = dmMetadata(CHANNEL, [])
    const members = { ...untagged, kind: 39002, tags: [['d', CHANNEL], ['p', ME, '', 'member'], ['p', PARTNER, '', 'member']] }
    queryRelay.mockResolvedValueOnce({ ok: true, events: [untagged] }).mockResolvedValueOnce({ ok: true, events: [members] })

    const read = await fetchDmChannels(seam)

    expect(queryRelay.mock.calls[1][1]).toEqual([{ kinds: [39002], '#d': [CHANNEL] }])
    expect(read).toEqual({ state: 'present', byPartner: new Map([[PARTNER, CHANNEL]]) })
  })

  it('asks nothing more when every DM names its members', async () => {
    queryRelay.mockResolvedValue({ ok: true, events: [dmMetadata(CHANNEL, [ME, PARTNER])] })
    await fetchDmChannels(seam)
    expect(queryRelay).toHaveBeenCalledTimes(1)
  })

  it('reports a relay that did not answer as unreachable, never as no DMs', async () => {
    queryRelay.mockResolvedValue({ ok: false, events: [], reason: 'boom' })
    expect(await fetchDmChannels(seam)).toEqual({ state: 'unreachable' })
  })
})

describe('opening a DM channel', () => {
  it('builds the 41010 for the partner and hands back the uuid the relay answered with', async () => {
    publishSigned.mockResolvedValue(opened(true))

    const result = await publishDmChannel(PARTNER, seam)

    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    const [event] = sent()
    expect(event.kind).toBe(41010)
    expect(event.tags).toEqual([['p', PARTNER]])
  })

  it('publishes no 9007 — the 41010 creates the channel itself', async () => {
    publishSigned.mockResolvedValue(opened(true))
    await publishDmChannel(PARTNER, seam)
    expect(sent().map((e) => e.kind)).toEqual([41010])
  })

  it('refuses to open a DM with yourself, and publishes nothing', async () => {
    const result = await publishDmChannel(ME, seam)
    expect(result.ok).toBe(false)
    expect(publishSigned).not.toHaveBeenCalled()
  })

  /*
    The race: two tabs open the same DM in the same wall-clock second, sign
    identical bytes, and the second is answered "duplicate: already processed"
    with no uuid — `persist_command_event` keys on the event id, so the handler
    never re-ran. The escape is a distinct event, which does re-run it.
  */
  it('retries with a distinct event when a replay is accepted but names no channel', async () => {
    publishSigned.mockResolvedValueOnce(replayed).mockResolvedValueOnce(opened(false))

    const result = await publishDmChannel(PARTNER, seam)

    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    const [first, retry] = sent()
    expect(retry.created_at).toBe(first.created_at + 1)
    expect(retry.tags).toEqual(first.tags)
  })

  it('retries once, not in a loop', async () => {
    publishSigned.mockResolvedValue(replayed)

    const result = await publishDmChannel(PARTNER, seam)

    expect(publishSigned).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(false)
  })

  it('carries the relay\'s refusal back by reason', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'restricted: not a member', httpStatus: 200 })

    const result = await publishDmChannel(PARTNER, seam)

    expect(result).toEqual({ ok: false, reason: 'restricted: not a member' })
  })

  it('does not treat an accepted answer with no channel as a success', async () => {
    // Accepted, not a duplicate, and silent — so there is nothing to retry.
    publishSigned.mockResolvedValue({ ok: true, eventId: 'e1', httpStatus: 200 })

    const result = await publishDmChannel(PARTNER, seam)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/named no channel/)
  })

  it('re-opening an existing DM is the same event, answered with the same uuid — the unhide (DMS-6)', async () => {
    publishSigned.mockResolvedValue(opened(false))

    const result = await publishDmChannel(PARTNER, seam)

    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    expect(sent()[0].kind).toBe(41010)
  })
})
