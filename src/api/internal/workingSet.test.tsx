/**
 * The live working set, computed in the browser (REM-4) — the rules
 * `watchableChannels` held in Convex: priority order, one subscription per
 * channel, a ceiling, and nothing watched that has no channel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const GREG = 'a'.repeat(64)
const JUAN = 'b'.repeat(64)

vi.mock('convex/react', () => ({
  useQuery: () => {
    throw new Error('the working set asked Convex')
  },
}))

let screenerItems: unknown[] = []
vi.mock('./screener', () => ({ useScreener: () => ({ items: screenerItems }) }))

let openWorkEntries: unknown[] = []
vi.mock('./openWork', () => ({ useOpenWork: () => ({ entries: openWorkEntries }) }))

let starredSet: { topics: string[]; people: string[] } | undefined
vi.mock('./starred', () => ({ useStarred: () => ({ set: starredSet }) }))

let topics: unknown = []
vi.mock('@/api/topics', () => ({ useTopics: () => topics }))

let dmChannels: Record<string, string> = {}
const channelOf = (pubkey: string) => dmChannels[pubkey]
vi.mock('./dms', () => ({ useDmChannels: () => ({ channelOf }) }))

async function channels() {
  const { useWorkingSetChannels } = await import('./workingSet')
  return renderHook(() => useWorkingSetChannels()).result.current
}

beforeEach(() => {
  screenerItems = []
  openWorkEntries = []
  starredSet = undefined
  topics = [
    { id: 't1', title: 'One', isResolved: false, folderId: 'u-1' },
    { id: 't2', title: 'Two', isResolved: false, folderId: 'u-2' },
    { id: 't3', title: 'Old', isResolved: false, folderId: null },
  ]
  dmChannels = { [GREG]: 'd-greg', [JUAN]: 'd-juan' }
})

describe('useWorkingSetChannels', () => {
  it('watches a starred DM by its partner’s pubkey and the channel the relay names', async () => {
    starredSet = { topics: [], people: [GREG] }
    expect(await channels()).toEqual([{ containerKind: 'dm', containerKey: GREG, channelUuid: 'd-greg' }])
  })

  it('orders the Screener, then open work, then stars, and keeps a repeat in its first place', async () => {
    screenerItems = [{ id: 's', kind: 'topic', topicId: 't2', topicTitle: 'Two', preview: '' }]
    openWorkEntries = [{ kind: 'dm', key: JUAN, pubkey: JUAN }, { kind: 'topic', id: 't2' }]
    starredSet = { topics: ['t1', 't2'], people: [JUAN] }
    expect((await channels()).map((c) => c.channelUuid)).toEqual(['u-2', 'd-juan', 'u-1'])
  })

  it('uses the channel an open-work entry carries when the index has not delivered its topic', async () => {
    openWorkEntries = [{ kind: 'topic', id: 't9', channelUuid: 'u-9' }]
    expect(await channels()).toEqual([{ containerKind: 'topic', containerKey: 't9', channelUuid: 'u-9' }])
  })

  it('skips what has no channel: an unemitted topic, an unopened DM, a Convex-keyed Screener row, a file', async () => {
    screenerItems = [
      { id: 's1', kind: 'dm', dmId: 'kh7legacy', authorName: 'Old', preview: '' },
      { id: 's2', kind: 'file', address: '30023:x:y', fileKind: 30023, title: 'F', preview: '' },
    ]
    openWorkEntries = [{ kind: 'file', address: '30023:x:y' }]
    starredSet = { topics: ['t3', 'gone'], people: ['c'.repeat(64)] }
    expect(await channels()).toEqual([])
  })

  it('stops at the ceiling watchableChannels held', async () => {
    const { WORKING_SET_LIMIT } = await import('./workingSet')
    topics = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, title: `${i}`, isResolved: false, folderId: `u-${i}` }))
    starredSet = { topics: Array.from({ length: 40 }, (_, i) => `t${i}`), people: [] }
    expect(await channels()).toHaveLength(WORKING_SET_LIMIT)
  })
})
