/**
 * What a team is, for the person looking (TEA-5): who is in it, whether they
 * follow it, which of its topics are spaces, and whether its chat is theirs —
 * and what in the chat is new to them, by the shared rule (§11.8).
 */
import { describe, expect, it } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { buildMembershipChange, serializeTeamsBlob, parseTeamsBlob } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'
import { topicFollowingOf } from './placeDots'
import { chatHasUnread, chatNews, leavesTopicIn, mayChangeTopicIn, mayMove, teamOf, type Team } from './useTeams'
import type { TeamsRead } from '@/nostr/teams'

const RELAY = 'b'.repeat(64)
const MIKY = '1'.repeat(64)
const KATERINA = '2'.repeat(64)
const AGENT = '3'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const SPACE = `30840:${MIKY}:roadmap`
const TOPIC = `30840:${MIKY}:brief`

const folder: FolderSummary = { id: TEAM, name: 'Steer', hasState: true, channel: `39000:${RELAY}:${TEAM}`, admins: [MIKY] }
const roster = (...people: string[]) => [
  signed({ kind: 39002, created_at: 1_700_000_500, tags: [['d', TEAM], ...people.map((p) => ['p', p])] }, RELAY),
  ...people.map((p, i) => signed({ kind: 9021, created_at: 1_700_000_100 + i, tags: [['h', TEAM]] }, p)),
]
const listing = signed({ kind: 30890, created_at: 1_700_000_200, tags: [['d', TEAM], ['a', SPACE, '', 'space'], ['a', TOPIC]] }, RELAY)
const read = (people: string[], follows?: Record<string, number>): TeamsRead => ({
  rosters: { [TEAM]: roster(...people) },
  listings: { [TEAM]: [listing] },
  teamsList: follows ? { state: 'present', list: parseTeamsBlob(serializeTeamsBlob({ teams: follows, off: [] }, 1))! } : { state: 'absent' },
})

describe('teamOf', () => {
  it('lists its members in the order they joined, and says whether the viewer is one', () => {
    const team = teamOf(folder, read([MIKY, AGENT]), MIKY)
    expect(team.members.map((m) => m.pubkey)).toEqual([MIKY, AGENT])
    expect(team.isMember).toBe(true)
    expect(teamOf(folder, read([MIKY, AGENT]), KATERINA).isMember).toBe(false)
  })

  it('says which of what it lists are its spaces', () => {
    expect(teamOf(folder, read([MIKY]), MIKY).listed).toEqual([
      { address: SPACE, space: true },
      { address: TOPIC, space: false },
    ])
  })

  it('a space its list names by id alone is still its space: not moved by a non-member', () => {
    const byId = signed({ kind: 30890, created_at: 1_700_000_200, tags: [['d', TEAM], ['o', 'roadmap', '', 'space']] }, RELAY)
    const team = (who: string) => teamOf(folder, { ...read([MIKY]), listings: { [TEAM]: [byId] } }, who)
    expect(team(MIKY).listed).toEqual([{ id: 'roadmap', space: true }])
    expect(mayMove([team(KATERINA)], SPACE)).toBe(false)
  })

  it('a follower who is not in it follows it; a member who also listed it is a member, not a follower', () => {
    expect(teamOf(folder, read([MIKY], { [TEAM]: 1 }), KATERINA).isFollowing).toBe(true)
    expect(teamOf(folder, read([MIKY], { [TEAM]: 1 }), MIKY).isFollowing).toBe(false)
    expect(teamOf(folder, read([MIKY]), KATERINA).isFollowing).toBe(false)
  })

  it('its chat is a member’s, at Important, and nobody else’s — following the team does not put you in it', () => {
    expect(teamOf(folder, read([MIKY]), MIKY).chat).toMatchObject({ kind: 'chat', in: true, level: 'important' })
    expect(teamOf(folder, read([MIKY], { [TEAM]: 1 }), KATERINA).chat.in).toBe(false)
  })

  it('an archived team’s chat holds nobody', () => {
    expect(teamOf({ ...folder, archived: { by: MIKY, at: 1 } } as FolderSummary, read([MIKY]), MIKY).chat.in).toBe(false)
  })
})

describe('mayMove (SPEC §3.3)', () => {
  it('a space moves only by a member of its team', () => {
    expect(mayMove([teamOf(folder, read([MIKY]), MIKY)], SPACE)).toBe(true)
    expect(mayMove([teamOf(folder, read([MIKY]), KATERINA)], SPACE)).toBe(false)
  })

  it('a topic the team only leads moves by anyone, and so does anything while no teams are held', () => {
    expect(mayMove([teamOf(folder, read([MIKY]), KATERINA)], TOPIC)).toBe(true)
    expect(mayMove(null, SPACE)).toBe(true)
  })
})

describe('mayChangeTopicIn (TOPI-5)', () => {
  it('offers adding and arranging a topic’s files to a member of its team, private or not', () => {
    expect(mayChangeTopicIn([teamOf(folder, read([MIKY]), MIKY)], TEAM)).toBe(true)
    expect(mayChangeTopicIn([teamOf({ ...folder, private: true }, read([MIKY]), MIKY)], TEAM)).toBe(true)
  })

  it('offers it to anyone in an open team, and to nobody outside a private one, as the relay takes their changes', () => {
    expect(mayChangeTopicIn([teamOf(folder, read([MIKY]), KATERINA)], TEAM)).toBe(true)
    expect(mayChangeTopicIn([teamOf({ ...folder, private: true }, read([MIKY]), KATERINA)], TEAM)).toBe(false)
  })

  it('offers it while the team is not held: a refusal then says why', () => {
    expect(mayChangeTopicIn(null, TEAM)).toBe(true)
    expect(mayChangeTopicIn([], TEAM)).toBe(true)
  })
})

describe('a team chat’s dot', () => {
  const message = (id: string, by: string, at: number, root = id, about: string[] = []) => ({ id, by, at, root, about, urgent: false, body: 'hi' })
  const team = (who: string, people = [MIKY, KATERINA]) => teamOf(folder, read(people), who)
  const root = message('a'.repeat(64), MIKY, 1_700_001_000)
  const reply = message('d'.repeat(64), MIKY, 1_700_001_100, root.id)
  const read_ = { [TEAM]: 1_700_001_050 }

  it('a new conversation lights for a member', () => {
    expect(chatHasUnread(team(KATERINA), [root], {}, KATERINA)).toBe(true)
  })

  it('a reply in a conversation they are not in stays dark, after the root was read', () => {
    expect(chatHasUnread(team(KATERINA), [root, reply], read_, KATERINA)).toBe(false)
  })

  it('a reply in a conversation they wrote in lights', () => {
    const theirs = message('e'.repeat(64), KATERINA, 1_700_001_020, root.id)
    expect(chatHasUnread(team(KATERINA), [root, theirs, reply], read_, KATERINA)).toBe(true)
  })

  it('a lit chat’s card names who started a conversation and who replied in yours, newest first, with their words (ACT-3)', () => {
    const theirs = message('e'.repeat(64), KATERINA, 1_700_001_020, root.id)
    const lines = chatNews(team(KATERINA), [{ ...root, body: 'Shall we ship Friday?' }, theirs, { ...reply, body: 'Yes, Friday' }], {}, KATERINA)
    expect(lines.map((line) => [line.by, line.reason, line.words])).toEqual([
      [MIKY, 'reply-in-yours', 'Yes, Friday'],
      [MIKY, 'new-conversation', 'Shall we ship Friday?'],
    ])
    expect(chatNews(team(KATERINA), [root, reply], read_, KATERINA)).toEqual([])
  })

  it('a message about a file is that file’s, never the chat’s', () => {
    const aboutTopic = message('c'.repeat(64), MIKY, 1_700_001_000, 'c'.repeat(64), [TOPIC])
    expect(chatHasUnread(team(KATERINA), [aboutTopic], {}, KATERINA)).toBe(false)
  })

  it('nothing lights for someone not in the team', () => {
    expect(chatHasUnread(team(KATERINA, [MIKY]), [root], {}, KATERINA)).toBe(false)
  })

  it('a message naming someone not in the team does not light a chat row: they have none', () => {
    const naming = { ...root, body: `nostr:${encodeNpub(KATERINA)} can you look?` }
    expect(chatHasUnread(team(KATERINA, [MIKY, KATERINA]), [naming], {}, KATERINA)).toBe(true)
    expect(chatHasUnread(team(KATERINA, [MIKY]), [naming], {}, KATERINA)).toBe(false)
  })

  /*
    TEA-6: the chat is followed like a space. The teams read carries the
    changes naming the viewer filed in the team, a level on its chat among them.
  */
  const CHAT = folder.channel!
  const change = (by: string, at: number, place: string, field: string, value: string) =>
    signed({ kind: 1851, created_at: at, tags: [['a', place], ['field', field], ['value', value], ['h', TEAM], ['ts', String(at * 1000)], ['p', KATERINA]] }, by)
  const withChanges = (people: string[], ...changes: ReturnType<typeof signed>[]) => teamOf(folder, { ...read(people), changes: { [TEAM]: changes } }, KATERINA)

  it('at All, a reply in a conversation they are not in lights, once sent after they chose All', () => {
    const all = withChanges([MIKY, KATERINA], change(KATERINA, 1_700_000_900, CHAT, `follow:${KATERINA}`, 'all'))
    expect(all.chat).toMatchObject({ in: true, level: 'all' })
    expect(chatHasUnread(all, [root, reply], read_, KATERINA)).toBe(true)
  })

  it('a level on a topic the team leads is not a level on its chat', () => {
    const elsewhere = withChanges([MIKY, KATERINA], change(KATERINA, 1_700_000_900, TOPIC, `follow:${KATERINA}`, 'all'))
    expect(elsewhere.chat.level).toBe('important')
    expect(chatHasUnread(elsewhere, [root, reply], read_, KATERINA)).toBe(false)
  })
})

/*
  Leave on a row in a team's lists (Miky, 13 Nov): wherever the viewer hears from the place — its switch reads All
  or Important, a space reached only by the team's default included — and nowhere else. Judged by the shared fold
  over real rosters and changes, as the dots are.
*/
describe('which of a team’s rows offer Leave', () => {
  const place = (address: string) => ({ ref: address, address, kind: 30840, folder: TEAM, slots: {} }) as unknown as ForeignObject
  const joined = (who: string, address: string) =>
    signed({ ...buildMembershipChange(who, 1_700_000_800_000, { file: address, folder: TEAM, person: who, member: true }), created_at: 1_700_000_800 }, who)
  const leaves = (team: Team, who: string, address: string, changes: SignedEvent[] = []) =>
    leavesTopicIn([team], place(address), (topic, facts) =>
      topicFollowingOf({ address: topic.address!, folder: TEAM, me: who, changes, floor: 0, ...(facts ? { team: facts } : {}) }),
    )
  const withList = (people: string[], list: { teams: Record<string, number>; off: string[] }) =>
    teamOf(folder, { ...read(people), teamsList: { state: 'present', list: parseTeamsBlob(serializeTeamsBlob(list, 1))! } }, KATERINA)

  it('a space the viewer hears only through being in its team offers Leave', () => {
    expect(leaves(teamOf(folder, read([MIKY, KATERINA]), KATERINA), KATERINA, SPACE)).toBe(true)
  })

  it('a public space the viewer hears through following its team offers Leave', () => {
    expect(leaves(teamOf(folder, read([MIKY], { [TEAM]: 1_700_000_300_000 }), KATERINA), KATERINA, SPACE)).toBe(true)
  })

  it('a space whose team default the viewer turned off offers none', () => {
    expect(leaves(withList([MIKY, KATERINA], { teams: {}, off: ['roadmap'] }), KATERINA, SPACE)).toBe(false)
  })

  it('a topic the team leads offers Leave only once the viewer joined it', () => {
    const team = teamOf(folder, read([MIKY, KATERINA]), KATERINA)
    expect(leaves(team, KATERINA, TOPIC)).toBe(false)
    expect(leaves(team, KATERINA, TOPIC, [joined(KATERINA, TOPIC)])).toBe(true)
  })

  it('nothing offers Leave to someone neither in the team nor following it', () => {
    const team = teamOf(folder, read([MIKY]), KATERINA)
    expect(leaves(team, KATERINA, SPACE)).toBe(false)
    expect(leaves(team, KATERINA, TOPIC)).toBe(false)
  })

  it('nothing in an archived team offers Leave, a joined topic included', () => {
    const archived = teamOf({ ...folder, archived: { by: MIKY, at: 1_700_000_900 } }, read([MIKY, KATERINA]), KATERINA)
    expect(leaves(archived, KATERINA, SPACE)).toBe(false)
    expect(leaves(archived, KATERINA, TOPIC, [joined(KATERINA, TOPIC)])).toBe(false)
  })

  // A muted topic reaches here as undefined too; that the hook says so is useTopicsColumn.test's "a muted topic is not yours".
  it('a topic whose following is not known offers none', () => {
    expect(leavesTopicIn([teamOf(folder, read([MIKY, KATERINA]), KATERINA)], place(SPACE), () => undefined)).toBe(false)
  })
})
