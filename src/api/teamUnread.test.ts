import { describe, it, expect } from 'vitest'
import type { StreamMessage } from '@/nostr/channelStreams'
import { teamHasFollowedStream, teamHasUnread } from './teamUnread'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const PK = 'b'.repeat(64)
const FOL16 = `30851:${PK}:fol-16`
const FOL18 = `30851:${PK}:fol-18`
const ROOT = 'a'.repeat(64)
const NOW = 1_800_000_000
const HORIZON = 90 * 24 * 60 * 60

const said = (id: string, at: number, about: string[] = [], by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: id,
  about,
  urgent: false,
})
const replied = (id: string, at: number, inThread: string, about: string[] = [], by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: inThread,
  about,
  urgent: false,
})

/* Everything followed unless a test says otherwise: the FOL-16/18 rules are
   judged over the followed set, and these tests are about the rules. */
const frontier = (markers: Record<string, number> = {}, me = ME, followed: (key: string) => boolean = () => true) => ({
  marker: (context: string | undefined) => (context ? markers[context] : undefined),
  followed,
  me,
  nowSeconds: NOW,
  horizonSeconds: HORIZON,
})

/*
  SPEC §11.3, FOL-18. The team's dot is the union of its streams, each judged
  against its own marker: the channel uuid for the general stream, the file's
  address for a file's. The done-when is the second block — a Folder lights
  for a sibling file nobody read, and only that file's marker puts it out.
*/
describe('teamHasUnread — the general stream answers to the channel marker', () => {
  it('lights when the chat has a root later than the channel marker', () => {
    expect(teamHasUnread(FOLDER, [said('m', 2000)], frontier({ [FOLDER]: 1000 }))).toBe(true)
  })

  it('is dark once the chat is read', () => {
    expect(teamHasUnread(FOLDER, [said('m', 500)], frontier({ [FOLDER]: 1000 }))).toBe(false)
  })

  it('is dark with nothing said', () => {
    expect(teamHasUnread(FOLDER, [], frontier())).toBe(false)
  })
})

describe("teamHasUnread — a file's stream answers to the file's marker, never the channel's", () => {
  // Said an hour ago: inside the horizon, so a file nobody ever read is new.
  const AT = NOW - 3600
  const siblingUnread = [said('fol16', AT, [FOL16]), said('fol18', AT, [FOL18])]

  it('lights for a file nobody read, however recently the chat was read', () => {
    const f = frontier({ [FOLDER]: NOW, [FOL16]: NOW })
    expect(teamHasUnread(FOLDER, siblingUnread, f)).toBe(true)
  })

  it("goes dark only when that file's own marker advances past it", () => {
    expect(teamHasUnread(FOLDER, siblingUnread, frontier({ [FOL16]: NOW, [FOL18]: AT - 1 }))).toBe(true)
    expect(teamHasUnread(FOLDER, siblingUnread, frontier({ [FOL16]: NOW, [FOL18]: AT }))).toBe(false)
  })

  it('reads a message about two files as in both streams', () => {
    const both = [said('m', AT, [FOL16, FOL18])]
    expect(teamHasUnread(FOLDER, both, frontier({ [FOL16]: NOW }))).toBe(true)
    expect(teamHasUnread(FOLDER, both, frontier({ [FOL16]: NOW, [FOL18]: NOW }))).toBe(false)
  })

  it('keeps a message whose `a` is not an address in the general stream', () => {
    const odd = [said('m', 1500, ['not-an-address'])]
    expect(teamHasUnread(FOLDER, odd, frontier({ [FOLDER]: 1000 }))).toBe(true)
    expect(teamHasUnread(FOLDER, odd, frontier({ [FOLDER]: 2000 }))).toBe(false)
  })
})

describe('teamHasUnread — the rules it inherits from the file judge', () => {
  it('never counts your own message, in the chat or on a file', () => {
    const mine = [said('a', 2000, [], ME), said('b', 2000, [FOL18], ME)]
    expect(teamHasUnread(FOLDER, mine, frontier({ [FOLDER]: 1000 }))).toBe(false)
  })

  it('lets a stream frontier clear its threads, and a thread marker clear its own replies', () => {
    const thread = [said(ROOT, 100, [FOL18]), replied('r', 1500, ROOT, [FOL18])]
    expect(teamHasUnread(FOLDER, thread, frontier({ [FOL18]: 9000 }))).toBe(false)
    expect(teamHasUnread(FOLDER, thread, frontier({ [FOL18]: 1000, [`thread:${ROOT}`]: 9000 }))).toBe(false)
    expect(teamHasUnread(FOLDER, thread, frontier({ [FOL18]: 1000, [`thread:${ROOT}`]: 1000 }))).toBe(true)
  })

  it('reads an absent marker by the horizon: recent is new, older is quiet (§11.6)', () => {
    expect(teamHasUnread(FOLDER, [said('m', NOW - 10, [FOL18])], frontier())).toBe(true)
    expect(teamHasUnread(FOLDER, [said('m', NOW - HORIZON - 10, [FOL18])], frontier())).toBe(false)
  })
})

/*
  FOL-30. The dot exists only for what you follow: each stream is asked of
  `followed` by its key — the file's address, the Folder's own id for the
  general stream — and an unfollowed stream contributes nothing however new
  it is. The ticket's done-when in miniature: a message in a followed file
  lights the team, the same in an unfollowed file lights nothing, and taking a
  file off the list puts a lit team out at once, with no marker moving.
*/
describe('teamHasUnread — only followed streams are judged (FOL-30)', () => {
  const only =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key)

  it('lights for a followed file and not for an unfollowed one, given the same message', () => {
    const messages = [said('m', NOW - 10, [FOL18])]
    expect(teamHasUnread(FOLDER, messages, frontier({}, ME, only(FOL18)))).toBe(true)
    expect(teamHasUnread(FOLDER, messages, frontier({}, ME, only(FOL16)))).toBe(false)
    expect(teamHasUnread(FOLDER, messages, frontier({}, ME, () => false))).toBe(false)
  })

  it('gates the general stream on the Folder itself being followed', () => {
    const chat = [said('m', NOW - 10)]
    expect(teamHasUnread(FOLDER, chat, frontier({}, ME, only(FOLDER)))).toBe(true)
    expect(teamHasUnread(FOLDER, chat, frontier({}, ME, only(FOL18)))).toBe(false)
  })

  it('follows a file without following its Folder, and the other way round', () => {
    const both = [said('chat', NOW - 10), said('m', NOW - 10, [FOL18])]
    // Chat is new, but only the file is followed: the file lights, and reading it puts the team out.
    expect(teamHasUnread(FOLDER, both, frontier({}, ME, only(FOL18)))).toBe(true)
    expect(teamHasUnread(FOLDER, both, frontier({ [FOL18]: NOW }, ME, only(FOL18)))).toBe(false)
    // The file is new, but only the Folder is followed: the chat lights, and reading the chat puts the team out.
    expect(teamHasUnread(FOLDER, both, frontier({}, ME, only(FOLDER)))).toBe(true)
    expect(teamHasUnread(FOLDER, both, frontier({ [FOLDER]: NOW }, ME, only(FOLDER)))).toBe(false)
  })

  it('unfollowing clears a lit team at once, with no marker moving', () => {
    const messages = [said('m', NOW - 10, [FOL18])]
    expect(teamHasUnread(FOLDER, messages, frontier({}, ME, only(FOL18)))).toBe(true)
    expect(teamHasUnread(FOLDER, messages, frontier({}, ME, only()))).toBe(false)
  })
})

/*
  The `Followed` filter's Folder-level question — FOL-41. Judged over the same
  messages as the dot and with no read of its own, which is what makes the
  filter affordable; what it cannot see is pinned here too, so the limit is a
  test rather than a comment.
*/
describe('teamHasFollowedStream — does this Folder hold anything followed', () => {
  const only =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key)

  it('is true when the Folder itself is followed — that is its general chat', () => {
    expect(teamHasFollowedStream(FOLDER, [], only(FOLDER))).toBe(true)
  })

  it('is true when a message names a followed file', () => {
    expect(teamHasFollowedStream(FOLDER, [said('m', NOW - 10, [FOL18])], only(FOL18))).toBe(true)
  })

  it('is false when the talk in it is about files nobody follows', () => {
    expect(teamHasFollowedStream(FOLDER, [said('m', NOW - 10, [FOL18])], only(FOL16))).toBe(false)
  })

  /*
    Chat in a Folder is the Folder's own stream, not a file's, so it answers to
    following the Folder — the same rule `teamHasUnread` streams by, and the
    reason the dot does not light for a team whose chat you do not follow.
  */
  it('is false when the Folder has chat but the Folder is not followed', () => {
    expect(teamHasFollowedStream(FOLDER, [said('m', NOW - 10)], only(FOL18))).toBe(false)
  })

  /*
    The limit, written down: a followed file that nobody has said anything in
    leaves no trace in these streams, so its Folder is not one of the answers.
    `All` is the recovery, and the Folder is one click away in it.
  */
  it('cannot see a followed file that has no messages', () => {
    expect(teamHasFollowedStream(FOLDER, [], only(FOL18))).toBe(false)
  })

  /* An `a` that is not an address names no stream — `teamHasUnread`'s rule. */
  it('ignores an `a` that is not an address', () => {
    expect(teamHasFollowedStream(FOLDER, [said('m', NOW - 10, ['not-an-address'])], () => true)).toBe(true)
    expect(teamHasFollowedStream(FOLDER, [said('m', NOW - 10, ['not-an-address'])], only('not-an-address'))).toBe(
      false,
    )
  })
})
