/**
 * A file is archived with the closest archived file above it, at any depth —
 * PEEKM-2, SPEC §6.5. The page a link opens reads it through
 * `resolveObjectAsViewer`'s `archivedWith`, and `with` is what its notice
 * names and opens: page C under B under A names B while B is archived, and A
 * once B is unarchived. Before, Peek read one level, so C under an archived A
 * read as live and took comments.
 *
 * The relay is faked at the bridge: it answers each filter from the events
 * below, as the relay would.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }

const { queryRelay, events } = vi.hoisted(() => {
  const events: Event[] = []
  const matches = (event: Event, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, wanted]) => {
      if (key === 'limit' || key === 'since' || key === 'until' || key === 'search') return true
      const values = wanted as (string | number)[]
      if (key === 'kinds') return values.includes(event.kind)
      if (key === 'authors') return values.includes(event.pubkey)
      if (key === 'ids') return values.includes(event.id)
      if (key.startsWith('#')) return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
      return true
    })
  const queryRelay = vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true,
    events: events.filter((event) => filters.some((filter) => matches(event, filter))),
  }))
  return { queryRelay, events }
})
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { resolveFolderContentsAsViewer, resolveObjectAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const token = { accessToken: 't', pubkey: AUTHOR } as never
const address = (d: string) => `30840:${AUTHOR}:${d}`
const [A, B, C] = ['page-a', 'page-b', 'page-c'].map(address)

let id = 0
const event = (kind: number, created_at: number, tags: string[][]): Event => ({ id: String(++id).padStart(64, '0'), kind, pubkey: AUTHOR, created_at, tags, content: '', sig: '' })
/** A bare file in the Folder, under `parent` when it has one. */
const page = (at: string, title: string, parent?: string) =>
  event(30840, 100, [['d', at.split(':')[2]], ['h', FOLDER], ['title', title], ...(parent ? [['a', parent]] : [])])
/** Its archive (`'true'`) or restore (`''`), as every app writes it. */
const archiving = (target: string, value: 'true' | '', at: number) => event(1851, at, [['a', target], ['field', 'archived'], ['value', value], ['h', FOLDER]])

const archivedWith = async (target: string) => (await resolveObjectAsViewer(target, 'https://relay.test', token, { archivedWith: true }))?.archived?.with

beforeEach(() => {
  events.length = 0
  events.push(page(A, 'A'), page(B, 'B', A), page(C, 'C', B))
})

describe('the page a link opens names the closest archived file above it, at any depth (PEEKM-2)', () => {
  it('C under B under an archived A is archived with A', async () => {
    events.push(archiving(A, 'true', 200))
    expect(await archivedWith(C)).toBe(A)
  })

  it('with A and B both archived C names B, and once B is unarchived it names A', async () => {
    events.push(archiving(A, 'true', 200), archiving(B, 'true', 210))
    expect(await archivedWith(C)).toBe(B)
    events.push(archiving(B, '', 220))
    expect(await archivedWith(C)).toBe(A)
  })

  it('unarchiving A reopens C', async () => {
    events.push(archiving(A, 'true', 200), archiving(A, '', 230))
    expect(await resolveObjectAsViewer(C, 'https://relay.test', token, { archivedWith: true }).then((file) => file?.archived)).toBeUndefined()
  })
})

describe('a Folder lists no file archived with a parent that lives in another Folder (PEEKM-2)', () => {
  const RELAY = 'f'.repeat(64)
  const APIARY = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
  const relayEvent = (kind: number, tags: string[][]): Event => ({ ...event(kind, 50, tags), pubkey: RELAY })
  const titles = async () => (await resolveFolderContentsAsViewer(APIARY, 'https://relay.test', token)).files.map((file) => file.slots.title?.value)

  beforeEach(() => {
    // A, B and C live in FOLDER; the apiary lists C alone, by its state.
    events.push(relayEvent(39000, [['d', APIARY], ['name', 'Apiary']]), relayEvent(30890, [['d', APIARY], ['name', 'Apiary'], ['a', C]]))
  })

  it('C is listed while nothing above it is archived, gone once A is, and back once A is unarchived', async () => {
    expect(await titles()).toEqual(['C'])
    events.push(archiving(A, 'true', 200))
    expect(await titles()).toEqual([])
    events.push(archiving(A, '', 230))
    expect(await titles()).toEqual(['C'])
  })
})
