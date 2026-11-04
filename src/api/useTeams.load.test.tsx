/**
 * The teams a tab holds (TEA-5): read once and shared, and read again after the
 * person's own join, leave, add, follow or mark. Reads can come back out of
 * order — a slower read landing after the one a Join started — and only the
 * read started last may decide what is drawn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FolderSummary } from '@estiva-app/interop'
import { signed } from '@/test/wireRelay'
import type { TeamsRead } from '@/nostr/teams'
import { reloadTeamsOnScreen, resetTeamsForTests, useTeams } from './useTeams'

const ME = '1'.repeat(64)
const RELAY = 'b'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const FOLDER: FolderSummary = { id: TEAM, name: 'Steer', hasState: true, channel: `39000:${RELAY}:${TEAM}`, admins: [] }

/** Each read the hook starts, answered by the test when it chooses. */
const reads = vi.hoisted(() => [] as { resolve: (read: TeamsRead) => void; reject: (error: Error) => void }[])
vi.mock('@/nostr/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/teams')>()),
  readTeamsAsViewer: () => new Promise<TeamsRead>((resolve, reject) => reads.push({ resolve, reject })),
}))
vi.mock('@/auth/heldSession', () => ({ heldToken: () => ({ accessToken: 't', pubkey: '1'.repeat(64) }) }))
vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('./useFolderContents', () => ({ useFolders: () => ({ folders: [FOLDER] }), useFolderContents: () => ({ state: 'loading' }) }))

const rosterOf = (...people: string[]): TeamsRead => ({
  rosters: { [TEAM]: [signed({ kind: 39002, created_at: 1_700_000_500, tags: [['d', TEAM], ...people.map((p) => ['p', p])] }, RELAY)] },
  listings: { [TEAM]: [] },
  teamsList: { state: 'absent' },
})

beforeEach(() => {
  reads.length = 0
  resetTeamsForTests()
})

/** The tab's first read has landed, with the viewer in no team; then a slower read is started, and a Join's read after it. */
async function twoReadsInFlight() {
  const hook = renderHook(() => useTeams())
  await act(async () => reads[0].resolve(rosterOf()))
  let slow!: Promise<void>
  let afterJoin!: Promise<void>
  act(() => {
    slow = reloadTeamsOnScreen()
    afterJoin = reloadTeamsOnScreen()
  })
  expect(reads).toHaveLength(3)
  // The read the Join started comes back first.
  await act(async () => {
    reads[2].resolve(rosterOf(ME))
    await afterJoin
  })
  expect(hook.result.current.teams?.[0].isMember).toBe(true)
  return { hook, slow }
}

describe('reads that come back out of order', () => {
  it('a slower read landing after a newer one does not undo it', async () => {
    const { hook, slow } = await twoReadsInFlight()
    await act(async () => {
      reads[1].resolve(rosterOf())
      await slow
    })
    expect(hook.result.current.teams?.[0].isMember).toBe(true)
  })
})
