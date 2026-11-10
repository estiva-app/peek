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
import { buildLevelChange, buildMembershipChange, fileContext, threadContext, type TeamsList } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent } from '@estiva-app/protocol'
import type { StreamMessage } from '@/nostr/channelStreams'
import { signed } from '@/test/wireRelay'
import { listedHaveUnread, listedReadsOf, placeHasUnread, topicFollowingOf, type TeamFacts } from './placeDots'

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
    const address = `30840:${ME}:x`
    const mine = topicFollowingOf({ address, folder: TEAM, me: ME, changes: [], floor: FLOOR })
    expect(mine).toMatchObject({ in: true, level: 'important' })
    const judge = { context: address, me: ME, following: mine, muted: false, merged: {}, floor: FLOOR, isMentioned: () => false }
    expect(placeHasUnread([said('new', T0 + 50)], judge)).toBe(true)
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

describe('a file the topic lists (TOPI-3)', () => {
  const ISSUE = `30851:${MIKY}:issue-12`
  const SHIP_TEAM = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const comment = (id: string, at: number, by = MIKY) =>
    signed({ kind: 1111, created_at: at, content: id, tags: [['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851'], ['h', SHIP_TEAM]] }, by)
  const reply = (to: SignedEvent, at: number, by = MIKY) =>
    signed({ kind: 1111, created_at: at, content: 'reply', tags: [['A', ISSUE], ['K', '30851'], ['e', to.id], ['k', '1111'], ['p', to.pubkey], ['h', SHIP_TEAM]] }, by)
  /** Whether the topic lights for news on the issue it lists, with ME's markers `merged`. */
  const listedLights = (events: SignedEvent[], changes: SignedEvent[], merged: Record<string, number> = {}) =>
    listedHaveUnread([{ file: ISSUE, events }], {
      me: ME,
      following: following(changes),
      muted: false,
      merged,
      floor: FLOOR,
    })
  const atAll = [added(T0 + 10), level(T0 + 15, 'all')]
  const ISSUE_CONTEXT = fileContext(ISSUE) as string

  it('lights at All for a comment said after All was chosen, and not for one said before', () => {
    expect(listedLights([comment('after', T0 + 50)], atAll)).toBe(true)
    expect(listedLights([comment('before', T0 + 12)], atAll)).toBe(false)
  })

  it('stays dark at Important for the same comment', () => {
    expect(listedLights([comment('after', T0 + 50)], atAll)).toBe(true)
    expect(listedLights([comment('after', T0 + 50)], [added(T0 + 10)])).toBe(false)
  })

  it("stays dark once the file's own marker passes it: read in Ship, on its page or in the topic", () => {
    expect(listedLights([comment('after', T0 + 50)], atAll, { [TOPIC]: T0 + 100 })).toBe(true)
    expect(listedLights([comment('after', T0 + 50)], atAll, { [ISSUE_CONTEXT]: T0 + 60 })).toBe(false)
  })

  it("a reply is judged by its thread's marker, not by the file's", () => {
    const root = comment('root', T0 + 20)
    const answer = reply(root, T0 + 50)
    // The file read past it: a reply is read only in its thread (PEE-44), so it still lights.
    expect(listedLights([root, answer], atAll, { [ISSUE_CONTEXT]: T0 + 60 })).toBe(true)
    expect(listedLights([root, answer], atAll, { [ISSUE_CONTEXT]: T0 + 30, [threadContext(root.id) as string]: T0 + 60 })).toBe(false)
  })

  describe("what a lit topic's card reads more of while open (383a4d3b)", () => {
    const OTHER = `30851:${MIKY}:issue-13`
    const judge = (merged: Record<string, number> = {}) => ({ me: ME, following: following(atAll), muted: false, merged, floor: FLOOR })

    it("reads a lit file from its own marker, and a dark file not at all", () => {
      const held = [
        { file: ISSUE, events: [comment('new', T0 + 50)] },
        { file: OTHER, events: [] },
      ]
      expect(listedReadsOf({ held, judge: { ...judge(), merged: { [ISSUE_CONTEXT]: T0 + 30 } } })).toEqual([{ file: ISSUE, since: T0 + 30 }])
    })

    it('never before the horizon, for a file never read', () => {
      expect(listedReadsOf({ held: [{ file: ISSUE, events: [comment('new', T0 + 50)] }], judge: judge() })).toEqual([{ file: ISSUE, since: FLOOR }])
    })

    it('reads nothing for a file read past its newest comment', () => {
      expect(listedReadsOf({ held: [{ file: ISSUE, events: [comment('new', T0 + 50)] }], judge: judge({ [ISSUE_CONTEXT]: T0 + 60 }) })).toEqual([])
    })
  })
})

describe('what names the viewer on a file the topic lists, or one level under it (ACT-2)', () => {
  const PROJECT = `30850:${MIKY}:project-3`
  const ISSUE = `30851:${MIKY}:issue-14`
  const SHIP_TEAM = '3c1d2e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  const NAMES_ME = `look at this nostr:${encodeNpub(ME)}`
  const comment = (file: string, id: string, at: number, opts: { by?: string; content?: string } = {}) =>
    signed(
      { kind: 1111, created_at: at, content: opts.content ?? id, tags: [['A', file], ['K', file.split(':')[0]!], ['a', file], ['k', file.split(':')[0]!], ['h', SHIP_TEAM]] },
      opts.by ?? MIKY,
    )
  const reply = (file: string, to: SignedEvent, at: number) =>
    signed({ kind: 1111, created_at: at, content: 'reply', tags: [['A', file], ['K', file.split(':')[0]!], ['e', to.id], ['k', '1111'], ['p', to.pubkey], ['h', SHIP_TEAM]] }, MIKY)
  /** Whether the topic lights for `events` on `file`, listed directly or (`under`) one level under a listed file. */
  const lightsOn = (file: string, events: SignedEvent[], changes: SignedEvent[], under = false) =>
    listedHaveUnread([{ file, events, ...(under ? { under } : {}) }], { me: ME, following: following(changes), muted: false, merged: {}, floor: FLOOR })
  const atImportant = [added(T0 + 10)]
  const atAll = [added(T0 + 10), level(T0 + 15, 'all')]

  it('at Important, a mention of the viewer on a listed file lights the topic', () => {
    expect(lightsOn(PROJECT, [comment(PROJECT, 'mention', T0 + 50, { content: NAMES_ME })], atImportant)).toBe(true)
  })

  it('at Important, a comment on a listed file naming nobody stays dark, and lights at All', () => {
    expect(lightsOn(PROJECT, [comment(PROJECT, 'plain', T0 + 50)], atImportant)).toBe(false)
    expect(lightsOn(PROJECT, [comment(PROJECT, 'plain', T0 + 50)], atAll)).toBe(true)
  })

  it("at Important, a reply to the viewer's own comment on a listed file lights the topic", () => {
    const mine = comment(PROJECT, 'mine', T0 + 20, { by: ME })
    expect(lightsOn(PROJECT, [mine, reply(PROJECT, mine, T0 + 50)], atImportant)).toBe(true)
    expect(lightsOn(PROJECT, [mine], atImportant)).toBe(false)
  })

  it('one level under a listed file, a mention of the viewer lights the topic at Important', () => {
    expect(lightsOn(ISSUE, [comment(ISSUE, 'mention', T0 + 50, { content: NAMES_ME })], atImportant, true)).toBe(true)
  })

  it('one level under a listed file, a comment naming nobody stays dark, even at All', () => {
    expect(lightsOn(ISSUE, [comment(ISSUE, 'plain', T0 + 50)], atAll, true)).toBe(false)
    expect(lightsOn(ISSUE, [comment(ISSUE, 'plain', T0 + 50)], atImportant, true)).toBe(false)
  })

  it('after the viewer left the topic, a mention on a listed file lights nothing', () => {
    expect(lightsOn(PROJECT, [comment(PROJECT, 'mention', T0 + 50, { content: NAMES_ME })], [added(T0 + 10), left(T0 + 20)])).toBe(false)
  })
})
