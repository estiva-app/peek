import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { buildMembershipChange } from '@estiva-app/conversation'
import { fileMembersQueries, foldFileMembers } from './fileMembers'

const AUTHOR = 'a'.repeat(64)
const BEA = 'b'.repeat(64)
const CAL = 'c'.repeat(64)
const FILE = `30851:${AUTHOR}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const FOLDER = '11111111-1111-4111-8111-111111111111'

let n = 0
const change = (signer: string, person: string, member: boolean, at: number): SignedEvent => ({
  ...buildMembershipChange(signer, at * 1000, { file: FILE, folder: FOLDER, person, member }),
  id: String(++n).padStart(64, '0'),
  sig: '',
})

describe('fileMembers (REA-3)', () => {
  it('asks for the file’s changes and its stream by both anchors, as Ship does', () => {
    expect(fileMembersQueries(FILE)).toEqual([
      { kinds: [1851], '#a': [FILE] },
      { kinds: [1111], '#A': [FILE] },
      { kinds: [1111], '#a': [FILE] },
    ])
  })

  it('the author is in from the start; somebody added is in; a leave signed by the person takes them out', () => {
    const events = [change(AUTHOR, BEA, true, 10), change(CAL, CAL, true, 11), change(CAL, CAL, false, 12)]
    expect([...foldFileMembers(FILE, events).keys()].sort()).toEqual([AUTHOR, BEA])
  })

  it('a leave signed for somebody else does not count, and the author can leave', () => {
    const events = [change(AUTHOR, BEA, true, 10), change(AUTHOR, BEA, false, 11), change(AUTHOR, AUTHOR, false, 12)]
    expect([...foldFileMembers(FILE, events).keys()]).toEqual([BEA])
  })

  it('holds an event answered by two filters once', () => {
    const add = change(AUTHOR, BEA, true, 10)
    expect(foldFileMembers(FILE, [add, add]).size).toBe(2)
  })
})
