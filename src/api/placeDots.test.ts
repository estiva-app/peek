/**
 * A topic's and a space's dot in Peek (TEA-6): Peek's part of the shared rule
 * — the topic's root stood in for by its address, the membership read's
 * changes, and the channel store's messages handed to `unreadOnPlace` with a
 * mention as a body naming the viewer. Each case is a Done-when leg as Peek
 * draws it: at Important a reply in a conversation the viewer is not in stays
 * dark and a new conversation lights; at All the reply lights; after a leave
 * nothing lights; a mention always does.
 */
import { describe, expect, it } from 'vitest'
import { buildLevelChange, buildMembershipChange, type TeamsList } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import type { StreamMessage } from '@/nostr/channelStreams'
import { signed } from '@/test/wireRelay'
import { placeHasUnread, topicFollowingOf, type TeamFacts } from './placeDots'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const RELAY = 'e'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const TOPIC = `30840:${MIKY}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const T0 = 1_800_000_000
/** The membership read's floor: the earliest it can tell about. */
const FLOOR = T0 - 1_000

const added = (at: number, value = true, by = MIKY) =>
  signed({ ...buildMembershipChange(by, at * 1000, { file: TOPIC, folder: TEAM, person: ME, member: value }), created_at: at }, by)
const left = (at: number) => added(at, false, ME)
const level = (at: number, value: 'all' | 'important' | '') =>
  signed({ ...buildLevelChange(ME, at * 1000, { place: TOPIC, folder: TEAM, level: value }), created_at: at }, ME)

const said = (id: string, at: number, by = MIKY, root = id): StreamMessage => ({ id, at, by, root, about: [TOPIC], urgent: false, body: '' })

const following = (changes: SignedEvent[], team?: TeamFacts) => topicFollowingOf({ address: TOPIC, folder: TEAM, me: ME, changes, floor: FLOOR, ...(team ? { team } : {}) })

/** Whether the topic lights for ME, having read the stream up to `readTo`. */
const lights = (messages: StreamMessage[], changes: SignedEvent[], opts: { readTo?: number; mentioned?: string[]; muted?: boolean; team?: TeamFacts } = {}) =>
  placeHasUnread(messages, {
    context: TOPIC,
    me: ME,
    following: following(changes, opts.team),
    muted: opts.muted ?? false,
    merged: opts.readTo === undefined ? {} : { [TOPIC]: opts.readTo },
    floor: FLOOR,
    isMentioned: (id) => (opts.mentioned ?? []).includes(id),
  })

/** A conversation ME has read the start of, and a reply after it. */
const thread = [said('root', T0 + 20), said('reply', T0 + 40, MIKY, 'root')]

describe('a topic at Important — added by someone', () => {
  const changes = [added(T0 + 10)]

  it('is in, at Important', () => {
    expect(following(changes)).toMatchObject({ in: true, level: 'important' })
  })

  it('lights for a new conversation', () => {
    expect(lights([said('new', T0 + 50)], changes, { readTo: T0 + 30 })).toBe(true)
  })

  it('stays dark for a reply in a conversation the viewer is not in', () => {
    expect(lights(thread, changes, { readTo: T0 + 30 })).toBe(false)
  })

  it('lights for a reply in a conversation the viewer wrote in', () => {
    expect(lights([...thread, said('mine', T0 + 25, ME, 'root')], changes, { readTo: T0 + 30 })).toBe(true)
  })
})

describe('a topic at All', () => {
  it('lights for a reply in a conversation the viewer is not in, sent after they chose All', () => {
    const changes = [added(T0 + 10), level(T0 + 15, 'all')]
    expect(following(changes)).toMatchObject({ in: true, level: 'all' })
    expect(lights(thread, changes, { readTo: T0 + 30 })).toBe(true)
  })

  it('a level chosen with no Add puts the viewer in too', () => {
    expect(lights(thread, [level(T0 + 15, 'all')], { readTo: T0 + 30 })).toBe(true)
  })

  it('back to Important, the same reply stays dark', () => {
    expect(lights(thread, [added(T0 + 10), level(T0 + 15, 'all'), level(T0 + 16, 'important')], { readTo: T0 + 30 })).toBe(false)
  })
})

describe('after a leave', () => {
  const changes = [added(T0 + 10), level(T0 + 15, 'all'), left(T0 + 18)]

  it('is not in', () => {
    expect(following(changes).in).toBe(false)
  })

  it('a new conversation does not light', () => {
    expect(lights([said('new', T0 + 50)], changes, { readTo: T0 + 30 })).toBe(false)
  })

  it('a reply does not light, even after All was chosen before the leave', () => {
    expect(lights(thread, changes, { readTo: T0 + 30 })).toBe(false)
  })

  it('an Add after the leave puts them back at Important', () => {
    const back = [...changes, added(T0 + 60)]
    expect(following(back)).toMatchObject({ in: true, level: 'important' })
    expect(lights([said('new', T0 + 70)], back, { readTo: T0 + 30 })).toBe(true)
  })
})

describe('a mention', () => {
  it('lights a reply the viewer is not in, at Important', () => {
    expect(lights(thread, [added(T0 + 10)], { readTo: T0 + 30, mentioned: ['reply'] })).toBe(true)
  })

  it('lights on a topic they left', () => {
    expect(lights(thread, [added(T0 + 10), left(T0 + 18)], { readTo: T0 + 30, mentioned: ['reply'] })).toBe(true)
  })

  it('lights on a topic they were never in', () => {
    expect(lights(thread, [], { readTo: T0 + 30, mentioned: ['reply'] })).toBe(true)
  })

  it('lights on a muted topic, where nothing else does', () => {
    expect(lights([said('new', T0 + 50)], [added(T0 + 10)], { readTo: T0 + 30, muted: true })).toBe(false)
    expect(lights([said('new', T0 + 50)], [added(T0 + 10)], { readTo: T0 + 30, muted: true, mentioned: ['new'] })).toBe(true)
  })
})

describe('the author of a topic', () => {
  it('is in it at Important with no change at all: their own topic lights a new conversation', () => {
    const mine = topicFollowingOf({ address: `30840:${ME}:x`, folder: TEAM, me: ME, changes: [], floor: FLOOR })
    expect(mine).toMatchObject({ in: true, level: 'important' })
  })
})

describe('a space, by its team’s default', () => {
  const roster = [signed({ kind: 39002, created_at: T0, tags: [['d', TEAM], ['p', ME], ['p', MIKY]] }, RELAY)]
  const listing = [signed({ kind: 30890, created_at: T0, tags: [['d', TEAM], ['a', TOPIC, '', 'space']] }, RELAY)]
  const space = (teams?: TeamsList): TeamFacts => ({ team: TEAM, roster, listing, archived: false, ...(teams ? { teams } : {}) })

  it('lights a new conversation for a member of the team who never touched it', () => {
    expect(lights([said('new', T0 + 50)], [], { readTo: T0 + 30, team: space() })).toBe(true)
  })

  it('does not once the viewer turned its default off', () => {
    const off: TeamsList = { v: 1, updatedAt: 0, teams: {}, off: [TOPIC.split(':')[2]] }
    expect(lights([said('new', T0 + 50)], [], { readTo: T0 + 30, team: space(off) })).toBe(false)
  })

  it('holds nobody in an archived team', () => {
    expect(lights([said('new', T0 + 50)], [], { readTo: T0 + 30, team: { ...space(), archived: true } })).toBe(false)
  })
})
