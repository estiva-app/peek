/**
 * Topics' Mine filter keeps the teams a person works in. A file moved to another team since the relay keeps files
 * in order is named on that team's list by its id only (SHI-64): the team still counts as theirs.
 */
import { describe, expect, it } from 'vitest'
import type { FolderSummary } from '@estiva-app/interop'
import { mineOf } from './loadAhead'

const PK = 'a'.repeat(64)
const STARTED = '11111111-1111-4111-8111-111111111111'
const MOVED_TO = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const PROJECT = `30850:${PK}:project`

describe('mineOf — the teams Topics opens on Mine', () => {
  it('keeps the team whose list names a file you are a member of by its id only, and not a team listing another file', () => {
    const folders: FolderSummary[] = [
      { id: STARTED, hasState: true, addresses: [] },
      { id: MOVED_TO, hasState: true, addresses: [], ids: ['project'] },
      { id: OTHER, hasState: true, addresses: [], ids: ['someone-elses'] },
    ]
    const membership = { isMember: (address: string) => address === PROJECT, memberFiles: [PROJECT] }

    const mine = mineOf(folders, {}, new Set(), membership).map((folder) => folder.id)

    expect(mine).toEqual([MOVED_TO])
  })
})
