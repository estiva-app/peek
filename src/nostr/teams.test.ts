/**
 * Reading the teams (TEA-5): which teams the viewer follows comes from their
 * own private list, and only the newest one counts (§12.3, last write wins) —
 * an older list read back would undo an Unfollow on the next load. A list
 * signed by someone else is never theirs.
 */
import { describe, expect, it } from 'vitest'
import { serializeTeamsBlob, TEAMS_D_TAG } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'
import { readTeams } from './teams'

const ME = '1'.repeat(64)
const SOMEONE = '2'.repeat(64)
const A = '33333333-3333-4333-8333-333333333333'
const B = '44444444-4444-4444-8444-444444444444'

/** A teams list as the relay stores it: here its content is the plain blob, and `decrypt` below hands it back. */
const listOf = (teams: Record<string, number>, at: number, by = ME) =>
  signed({ kind: 30078, created_at: at, tags: [['d', TEAMS_D_TAG]], content: serializeTeamsBlob({ teams, off: [] }, at) }, by)

const read = (events: SignedEvent[]) =>
  readTeams([A, B], [`39000:${SOMEONE}:${A}`, `39000:${SOMEONE}:${B}`], ME, async () => events, async (ciphertext) => ciphertext)

describe('the teams the viewer follows', () => {
  it('come from their newest list, whatever order the relay answers in', async () => {
    const older = listOf({ [A]: 1 }, 1_700_000_000)
    const newer = listOf({ [B]: 2 }, 1_700_000_100)
    for (const events of [[older, newer], [newer, older]]) {
      const { teamsList } = await read(events)
      expect(teamsList.state === 'present' && Object.keys(teamsList.list.teams)).toEqual([B])
    }
  })

  it('never come from a list someone else signed', async () => {
    const { teamsList } = await read([listOf({ [A]: 1 }, 1_700_000_000), listOf({ [B]: 2 }, 1_700_000_100, SOMEONE)])
    expect(teamsList.state === 'present' && Object.keys(teamsList.list.teams)).toEqual([A])
  })
})
