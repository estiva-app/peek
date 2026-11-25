/**
 * A Folder with no state finds its projects in the workspace project list, never by `#buzz-channel` (THE-11, SPEC
 * §6.13). Projects are stored workspace-wide and placed by `buzz-channel`, which is no tag a Nostr filter asks for: on
 * Miky's reopen of 25 Nov the relay ignored it over the socket and answered 500 unrelated files (575 KB) per Folder,
 * and a catch-up from the copy refuses it. The project list read is one a reopen catches up.
 *
 * The relay is faked at the bridge as a socket answers: `#buzz-channel` is ignored, every other filter matched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }

const { queryRelay, events, asked } = vi.hoisted(() => {
  const events: Event[] = []
  const asked: Record<string, unknown>[] = []
  const matches = (event: Event, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, wanted]) => {
      if (key === 'limit' || key === 'since' || key === 'until' || key === 'search' || key === '#buzz-channel') return true
      const values = wanted as (string | number)[]
      if (key === 'kinds') return values.includes(event.kind)
      if (key === 'authors') return values.includes(event.pubkey)
      if (key === 'ids') return values.includes(event.id)
      if (key.startsWith('#')) return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
      return true
    })
  const queryRelay = vi.fn(async (_url: string, filters: Record<string, unknown>[]) => {
    asked.push(...filters)
    const { relayAnswer } = await import('@/test/listRead')
    return { ok: true, events: relayAnswer(events, filters, matches) }
  })
  return { queryRelay, events, asked }
})
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { folderLoadAsViewer, resolveFolderContentsAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY = 'f'.repeat(64)
const TEAM = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const OTHER = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const token = { accessToken: 't', pubkey: AUTHOR } as never

let id = 0
const event = (kind: number, tags: string[][], content = '', pubkey = AUTHOR): Event => ({ id: String(++id).padStart(64, '0'), kind, pubkey, created_at: 100 + id, tags, content, sig: '' })
const project = (d: string, title: string, team: string) => event(30850, [['d', d], ['name', title], ['buzz-channel', team]])
const isWideList = (filter: Record<string, unknown>) => filter.fields === 'newest' && Object.keys(filter).length === 2

beforeEach(() => {
  events.length = 0
  asked.length = 0
  events.push(
    event(31990, [['d', 'ship'], ['k', '30850']], JSON.stringify({ name: 'Ship', projections: { 30850: { widget: 'card', slots: { title: { tag: 'name' } } } } })),
    event(39000, [['d', TEAM], ['name', 'Launch']], '', RELAY),
    event(39000, [['d', OTHER], ['name', 'Elsewhere']], '', RELAY),
    project('launch', 'Launch plan', TEAM),
    project('hiring', 'Hiring', OTHER),
  )
})

describe('a Folder with no state finds its projects in the workspace project list (THE-11)', () => {
  it('lists only the project placed in it, and never asks #buzz-channel', async () => {
    const { files } = await resolveFolderContentsAsViewer(TEAM, 'https://relay.test', token)
    expect(files.map((file) => file.slots.title?.value)).toEqual(['Launch plan'])
    expect(asked.filter((filter) => '#buzz-channel' in filter)).toEqual([])
    expect(asked.filter(isWideList)).toEqual([{ fields: 'newest', kinds: [30850] }])
  })

  it('two Folders read in one load ask the project list once', async () => {
    const load = folderLoadAsViewer('https://relay.test', token)
    const [team, other] = await Promise.all([TEAM, OTHER].map((folder) => resolveFolderContentsAsViewer(folder, 'https://relay.test', token, undefined, 'relay', load)))
    expect([team.files.map((f) => f.slots.title?.value), other.files.map((f) => f.slots.title?.value)]).toEqual([['Launch plan'], ['Hiring']])
    expect(asked.filter(isWideList)).toHaveLength(1)
  })
})
