import { describe, it, expect } from 'vitest'
import type { StreamMessage } from '@/nostr/channelStreams'
import { teamHasUnread } from './teamUnread'

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

const frontier = (markers: Record<string, number> = {}, me = ME) => ({
  marker: (context: string | undefined) => (context ? markers[context] : undefined),
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
