import { describe, expect, it } from 'vitest'
import type { StreamMessage } from '@/nostr/channelStreams'
import { containerContext, threadContext } from '@/nostr/readState'
import { topicChannelFlags } from './topicUnread'

const CHANNEL = '0d1c9f5a-6f7e-4a2b-9c3d-8e5f4a1b2c3d'
const ME = 'a'.repeat(64)
const THEM = 'b'.repeat(64)
/** A real event id: `threadContext` yields nothing for anything else (§11.1). */
const ROOT = 'c'.repeat(64)
const NOW = 1_800_000_000
const DAY = 24 * 60 * 60
const HORIZON = 90 * DAY

const said = (id: string, at: number, urgent = false, by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: id,
  about: [],
  urgent,
})
const replied = (id: string, at: number, inThread: string, urgent = false, by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: inThread,
  about: [],
  urgent,
})

const judge = (
  messages: StreamMessage[],
  markers: Record<string, number> = {},
  cachedMarker?: number,
) =>
  topicChannelFlags(CHANNEL, messages, {
    marker: (context) => (context ? markers[context] : undefined),
    me: ME,
    nowSeconds: NOW,
    horizonSeconds: HORIZON,
    cachedMarker,
  })

const CONTAINER = containerContext(CHANNEL) as string

describe('the two signals', () => {
  it('a new ordinary message raises the dot and not the indicator', () => {
    expect(judge([said('m', NOW - 3600)])).toEqual({ unread: true, urgent: false })
  })

  it('a new urgent message raises the indicator INSTEAD of the dot (issue #11)', () => {
    expect(judge([said('m', NOW - 3600, true)])).toEqual({ unread: false, urgent: true })
  })

  it('raises both when one of each is new — the row shows the indicator, the dot is still true', () => {
    expect(judge([said('a', NOW - 3600), said('b', NOW - 60, true)])).toEqual({
      unread: true,
      urgent: true,
    })
  })

  it('a non-urgent reply on an urgent thread raises the dot, not the indicator (ruling 2026-07-16)', () => {
    const flags = judge([said(ROOT, NOW - 7200, true), replied('r', NOW - 60, ROOT)], {
      [CONTAINER]: NOW - 3600,
    })
    expect(flags).toEqual({ unread: true, urgent: false })
  })

  it('your own message is never new to you, urgent or not', () => {
    const mine = [said('a', NOW - 60, false, ME), said('b', NOW - 60, true, ME)]
    expect(judge(mine)).toEqual({ unread: false, urgent: false })
  })

  it('an empty channel is neither', () => {
    expect(judge([])).toEqual({ unread: false, urgent: false })
  })
})

describe('which marker a message answers to', () => {
  it('the channel marker clears a root said before it', () => {
    expect(judge([said('m', NOW - 7200)], { [CONTAINER]: NOW - 3600 }).unread).toBe(false)
  })

  it("reading the topic reads its replies too — the channel's frontier propagates (§11.3)", () => {
    // The change from Convex, which judged a reply against its thread
    // watermark alone and so kept the dot lit on a thread never opened.
    const flags = judge([said(ROOT, NOW - 7200), replied('r', NOW - 7100, ROOT)], {
      [CONTAINER]: NOW - 3600,
    })
    expect(flags.unread).toBe(false)
  })

  it('a thread marker clears a reply the channel marker does not reach', () => {
    const messages = [said(ROOT, NOW - 7200), replied('r', NOW - 60, ROOT)]
    expect(judge(messages, { [CONTAINER]: NOW - 3600 }).unread).toBe(true)
    expect(
      judge(messages, { [CONTAINER]: NOW - 3600, [threadContext(ROOT) as string]: NOW - 30 }).unread,
    ).toBe(false)
  })

  it('an `a` tag does not open a stream of its own — a topic is one conversation', () => {
    // Unlike a team Folder (FOL-18). Nothing in Peek advances a file marker
    // for a topic message, so honouring the `a` would leave a dot that the
    // person cannot clear by opening the topic.
    const tagged: StreamMessage = { ...said('m', NOW - 7200), about: [`30023:${THEM}:a-file`] }
    expect(judge([tagged], { [CONTAINER]: NOW - 3600 }).unread).toBe(false)
  })
})

describe('absence, and the cached marker that stands in for it', () => {
  it('no marker anywhere lights a message inside the horizon (§11.6)', () => {
    expect(judge([said('m', NOW - 40 * DAY)]).unread).toBe(true)
  })

  it('no marker leaves a message older than the horizon quiet', () => {
    expect(judge([said('m', NOW - 120 * DAY)]).unread).toBe(false)
  })

  it("the cached marker keeps a long-quiet topic read once the relay has forgotten it", () => {
    // The done-when `convex/readState.test.ts` proves the other half of: read
    // 39 days ago, last message 40 days ago, and the relay's slots no longer
    // carry the context. Without the cache this lights.
    expect(judge([said('m', NOW - 40 * DAY)], {}, NOW - 39 * DAY).unread).toBe(false)
  })

  it('the cached marker only ever raises the relay marker, never lowers it', () => {
    // Relay says read an hour ago, the cache is a day stale: the newer wins,
    // so a message from two hours ago stays read.
    expect(
      judge([said('m', NOW - 7200)], { [CONTAINER]: NOW - 3600 }, NOW - DAY).unread,
    ).toBe(false)
    // And the other way round: the cache is ahead, so it clears a message the
    // relay marker would have lit.
    expect(judge([said('m', NOW - 1800)], { [CONTAINER]: NOW - 3600 }, NOW - 60).unread).toBe(false)
  })

  it('a deployment that has never seen the person changes nothing', () => {
    expect(judge([said('m', NOW - 3600)], {}, undefined).unread).toBe(true)
  })
})
