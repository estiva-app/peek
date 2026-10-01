import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { encodeNpub } from '@estiva-app/protocol'
import { authorOfAddress, foldMemberships, membershipQueries, rosterFilter, rosterOf } from './membership'

const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const FOLDER = '11111111-1111-4111-8111-111111111111'
const NOW = 1_800_000_000
const DAY = 24 * 60 * 60
const THEIRS = `30851:${THEM}:theirs`
const MINE = `30851:${ME}:mine`

let n = 0
const event = (over: Partial<SignedEvent> & Pick<SignedEvent, 'kind' | 'pubkey'>): SignedEvent => ({
  id: `e${++n}`.padEnd(64, '0'),
  created_at: NOW - 1000,
  tags: [],
  content: '',
  sig: '',
  ...over,
})
const comment = (file: string, pubkey: string, over: Partial<SignedEvent> = {}) =>
  event({ kind: 1111, pubkey, tags: [['A', file], ['a', file]], ...over })
const change = (file: string, field: string, value: string, pubkey: string, p: string, at = NOW - 1000) =>
  event({
    kind: 1851,
    pubkey,
    created_at: at,
    tags: [['a', file], ['field', field], ['value', value], ['h', FOLDER], ['ts', String(at * 1000)], ['p', p]],
  })

describe('membershipQueries — the three filters, bounded by the horizon', () => {
  it('asks for the changes that name the viewer, what they wrote, and what mentions them', () => {
    const filters = membershipQueries(ME, NOW)
    expect(filters).toHaveLength(3)
    expect(filters[0]).toMatchObject({ kinds: [1851], '#p': [ME], since: NOW - 90 * DAY })
    expect(filters[1]).toMatchObject({ authors: [ME] })
    expect(filters[2]).toMatchObject({ '#p': [ME] })
  })
})

describe('foldMemberships — SPEC §11.8 over what the relay returned', () => {
  it('a comment of the viewer’s makes them a member from that second', () => {
    const { files } = foldMemberships(ME, [comment(THEIRS, ME, { created_at: NOW - 500 })], NOW)
    expect(files.get(THEIRS)).toEqual({ member: true, since: NOW - 500 })
  })

  it('a placement carrying the viewer’s p makes them a member, and one without does not', () => {
    const placed = change(THEIRS, 'assignee', ME, THEM, ME)
    const unplaced = event({
      kind: 1851,
      pubkey: THEM,
      tags: [['a', `30851:${THEM}:other`], ['field', 'assignee'], ['value', ME]],
    })
    const { files } = foldMemberships(ME, [placed, unplaced], NOW)
    expect(files.get(THEIRS)?.member).toBe(true)
    // Named as a candidate by its change, but folded to nobody: a placement without a `p` places no one.
    expect(files.get(`30851:${THEM}:other`)?.member).toBe(false)
  })

  it('being added by somebody else counts, and leaving is the viewer’s own', () => {
    const added = change(THEIRS, `member:${ME}`, 'true', THEM, ME, NOW - 300)
    const leftByThem = change(THEIRS, `member:${ME}`, 'false', THEM, ME, NOW - 200)
    expect(foldMemberships(ME, [added, leftByThem], NOW).files.get(THEIRS)?.member).toBe(true)
    const leftByMe = change(THEIRS, `member:${ME}`, 'false', ME, ME, NOW - 200)
    expect(foldMemberships(ME, [added, leftByMe], NOW).files.get(THEIRS)).toEqual({ member: false })
  })

  it('a comment after a leave makes them a member again, from the comment', () => {
    const left = change(THEIRS, `member:${ME}`, 'false', ME, ME, NOW - 300)
    const wrote = comment(THEIRS, ME, { created_at: NOW - 100 })
    expect(foldMemberships(ME, [left, wrote], NOW).files.get(THEIRS)).toEqual({ member: true, since: NOW - 100 })
  })

  it('a comment that only tags the viewer is not a mention, and one that names them is', () => {
    const tagged = comment(THEIRS, THEM, { tags: [['A', THEIRS], ['p', ME]], content: 'hello' })
    const named = comment(THEIRS, THEM, { tags: [['A', THEIRS], ['p', ME]], content: `hi nostr:${encodeNpub(ME)}` })
    expect(foldMemberships(ME, [tagged], NOW).files.get(THEIRS)?.member).toBeFalsy()
    const read = foldMemberships(ME, [tagged, named], NOW)
    expect(read.files.get(THEIRS)?.member).toBe(true)
    expect(read.mentioned).toEqual(new Set([named.id]))
  })

  it('a file the viewer created is theirs, from the horizon, unless they left it', () => {
    const talk = comment(MINE, THEM, { tags: [['A', MINE], ['p', ME]] })
    expect(foldMemberships(ME, [talk], NOW).files.get(MINE)).toEqual({ member: true, since: NOW - 90 * DAY })
    const left = change(MINE, `member:${ME}`, 'false', ME, ME)
    expect(foldMemberships(ME, [talk, left], NOW).files.get(MINE)).toEqual({ member: false })
  })

  it('reports the horizon floor for a created file the read held no event for', () => {
    expect(foldMemberships(ME, [], NOW).floor).toBe(NOW - 90 * DAY)
  })
})

describe('authorOfAddress', () => {
  it('names the author of a file address and nothing else', () => {
    expect(authorOfAddress(MINE)).toBe(ME)
    expect(authorOfAddress(FOLDER)).toBeUndefined()
  })
})

describe('the roster — a Folder’s membership', () => {
  it('asks for the member lists that name the viewer', () => {
    expect(rosterFilter(ME)).toEqual({ kinds: [39002], '#p': [ME] })
  })

  it('reads the channel uuid off the list’s d tag', () => {
    const list = event({ kind: 39002, pubkey: 'f'.repeat(64), tags: [['d', FOLDER.toUpperCase()], ['p', ME]] })
    const other = event({ kind: 39000, pubkey: 'f'.repeat(64), tags: [['d', 'ignored']] })
    expect(rosterOf([list, other])).toEqual(new Set([FOLDER]))
  })
})
