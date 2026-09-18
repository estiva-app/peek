/*
  Opening a DM's channel (DMS-3).

  The interesting half is not the happy path: it is that the relay can accept a
  `41010` and tell you nothing. Every relay answer asserted here is one that was
  read off production on 2026-09-17, not one invented to make a branch
  reachable — including the empty one.
*/
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay: vi.fn() }))

import { publishDmChannel } from './dms'

const ME = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const PARTNER = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const CHANNEL = '6a8d299d-f86c-4b42-a2de-8954f4ed1d91'
const token = { accessToken: 't', pubkey: ME } as never
const RELAY = 'https://relay.test'

const UNSIGNED = {
  pubkey: ME,
  created_at: 1789660131,
  kind: 41010,
  tags: [['p', PARTNER]],
  content: '',
}

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

const recordDmChannel = vi.fn()
const api = (plan: unknown) => ({
  unsignedDmOpen: vi.fn().mockResolvedValue(plan) as never,
  recordDmChannel: recordDmChannel as never,
})
const okPlan = { ok: true, unsigned: UNSIGNED, dmId: 'dm1' }

const sent = () => signViaEstivaId.mock.calls.map(([event]) => event as typeof UNSIGNED)

beforeEach(() => {
  publishSigned.mockReset()
  signViaEstivaId.mockReset()
  recordDmChannel.mockReset()
  signViaEstivaId.mockImplementation(async (event: unknown) => event)
})

describe('opening a DM channel', () => {
  it('publishes the 41010 it was given and records the uuid the relay answered with', async () => {
    publishSigned.mockResolvedValue(opened(true))

    const result = await publishDmChannel('alice', RELAY, token, api(okPlan))

    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    const [event] = sent()
    expect(event.kind).toBe(41010)
    expect(event.tags).toEqual([['p', PARTNER]])
    expect(recordDmChannel).toHaveBeenCalledWith({ dmId: 'dm1', channelUuid: CHANNEL })
  })

  it('publishes no 9007 — the 41010 creates the channel itself', async () => {
    publishSigned.mockResolvedValue(opened(true))
    await publishDmChannel('alice', RELAY, token, api(okPlan))
    expect(sent().map((e) => e.kind)).toEqual([41010])
  })

  /*
    The race: two tabs open the same DM in the same wall-clock second, sign
    identical bytes, and the second is answered "duplicate: already processed"
    with no uuid — `persist_command_event` keys on the event id, so the handler
    never re-ran. The escape is a distinct event, which does re-run it.
  */
  it('retries with a distinct event when a replay is accepted but names no channel', async () => {
    publishSigned.mockResolvedValueOnce(replayed).mockResolvedValueOnce(opened(false))

    const result = await publishDmChannel('alice', RELAY, token, api(okPlan))

    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    const [first, retry] = sent()
    expect(retry.created_at).toBe(first.created_at + 1)
    expect(retry.tags).toEqual(first.tags)
    expect(recordDmChannel).toHaveBeenCalledWith({ dmId: 'dm1', channelUuid: CHANNEL })
  })

  it('retries once, not in a loop', async () => {
    publishSigned.mockResolvedValue(replayed)

    const result = await publishDmChannel('alice', RELAY, token, api(okPlan))

    expect(publishSigned).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(false)
    expect(recordDmChannel).not.toHaveBeenCalled()
  })

  it('records nothing when the relay refuses', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'restricted: not a member', httpStatus: 200 })

    const result = await publishDmChannel('alice', RELAY, token, api(okPlan))

    expect(result).toEqual({ ok: false, reason: 'restricted: not a member' })
    expect(recordDmChannel).not.toHaveBeenCalled()
  })

  it('does not treat an accepted answer with no channel as a success', async () => {
    // Accepted, not a duplicate, and silent — so there is nothing to retry and
    // nothing to write. Recording `undefined` here is the failure worth naming.
    publishSigned.mockResolvedValue({ ok: true, eventId: 'e1', httpStatus: 200 })

    const result = await publishDmChannel('alice', RELAY, token, api(okPlan))

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/named no channel/)
    expect(recordDmChannel).not.toHaveBeenCalled()
  })

  it('publishes nothing when Convex says there is nothing to open, and says it was expected', async () => {
    const result = await publishDmChannel(
      'alice',
      RELAY,
      token,
      api({ ok: false, reason: 'already has a channel', expected: true }),
    )

    expect(result).toEqual({ ok: false, reason: 'already has a channel', expected: true })
    expect(publishSigned).not.toHaveBeenCalled()
  })

  it('asks for the event even when the channel exists when told to reopen — the unhide (DMS-6)', async () => {
    // A re-open of an existing DM: the relay answers the same uuid, `created:false`.
    publishSigned.mockResolvedValue(opened(false))
    const plan = api(okPlan)

    const result = await publishDmChannel('alice', RELAY, token, plan, { reopen: true })

    expect(plan.unsignedDmOpen).toHaveBeenCalledWith({ dmKey: 'alice', reopen: true })
    expect(result).toEqual({ ok: true, channelUuid: CHANNEL })
    expect(sent()[0].kind).toBe(41010)
  })

  it('does not pass reopen unless asked, so the plain call keeps its refusal', async () => {
    publishSigned.mockResolvedValue(opened(true))
    const plan = api(okPlan)

    await publishDmChannel('alice', RELAY, token, plan)

    expect(plan.unsignedDmOpen).toHaveBeenCalledWith({ dmKey: 'alice' })
  })
})
