/**
 * Finding a file's parents, and whether one of them is archived, reads each parent project's current values, not
 * every change ever made to it (ALO-15, ALL-8, SPEC §6.13): the relay's list read, the one way files are read.
 * Asserted on the filters that reach the relay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }

const { queryRelay, events } = vi.hoisted(() => {
  const events: Event[] = []
  const matches = (event: Event, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, wanted]) => {
      if (!['kinds', 'authors', 'ids'].includes(key) && !key.startsWith('#')) return true
      const values = wanted as (string | number)[]
      if (key === 'kinds') return values.includes(event.kind)
      if (key === 'authors') return values.includes(event.pubkey)
      if (key === 'ids') return values.includes(event.id)
      return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
    })
  const queryRelay = vi.fn(async (_url: string, filters: Record<string, unknown>[]) => {
    // The list read (SPEC §6.13): each file it names, with each field's current change.
    const { relayAnswer } = await import('@/test/listRead')
    return { ok: true, events: relayAnswer(events, filters, matches) }
  })
  return { queryRelay, events }
})
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { forgetUrlShapes, resolveObjectAsViewer, resolveObjectsAsViewer, resolveParentsAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const token = { accessToken: 't', pubkey: AUTHOR } as never
const PROJECT = `30850:${AUTHOR}:6f1c2b3a-0000-4000-8000-00000000aaaa`
const PAGE = `30840:${AUTHOR}:page-under-the-project`

let id = 0
const event = (kind: number, created_at: number, tags: string[][]): Event => ({
  id: String(++id).padStart(64, '0'),
  kind,
  pubkey: AUTHOR,
  created_at,
  tags,
  content: '',
  sig: '',
})

/** Every filter that asks for the project's changes without `since` or the list read: its whole history. */
const projectHistoryReads = () =>
  queryRelay.mock.calls
    .flatMap(([, filters]) => filters as Record<string, unknown>[])
    .filter(
      (f) =>
        (f.kinds as number[] | undefined)?.includes(1851) &&
        ((f['#a'] as string[] | undefined) ?? []).includes(PROJECT) &&
        f.since === undefined &&
        f.fields === undefined,
    )

beforeEach(() => {
  events.length = 0
  queryRelay.mockClear()
  forgetUrlShapes()
  // Ship's manifest, a project renamed a few times and then archived, and a page under it.
  events.push(
    {
      ...event(31990, 90, [['d', 'estiva-ship'], ['k', '30850']]),
      content: JSON.stringify({
        name: 'Estiva Ship',
        records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
        // A project can be moved under another one, so finding its parent reads its moves.
        projections: {
          30850: {
            widget: 'card',
            slots: { title: { tag: 'name' }, list: { children: { kind: 30850, via: 'a', limit: 200, movedBy: 'parent' } } },
          },
        },
        actions: [],
      }),
    },
    event(30850, 100, [['d', PROJECT.split(':')[2]], ['name', 'Launch'], ['h', FOLDER]]),
    ...[110, 120, 130].map((at) => event(1851, at, [['a', PROJECT], ['field', 'name'], ['value', `Launch ${at}`], ['h', FOLDER]])),
    event(1851, 140, [['a', PROJECT], ['field', 'archived'], ['value', 'true'], ['h', FOLDER]]),
    event(30840, 150, [['d', PAGE.split(':')[2]], ['h', FOLDER], ['title', 'Notes'], ['a', PROJECT]]),
  )
})

describe('a parent read by the list read', () => {
  it('the page a link opens reads as archived with its project, without reading the project’s every change', async () => {
    const page = await resolveObjectAsViewer(PAGE, 'https://relay.test', token, { archivedWith: true })

    expect(page?.archived?.with).toBe(PROJECT)
    expect(projectHistoryReads()).toEqual([])
  })

  it('a screen of rows marks the page archived with its project, without reading the project’s every change', async () => {
    const objects = await resolveObjectsAsViewer([PAGE], 'https://relay.test', token, 'relay', { archivedWith: true })

    expect(objects[PAGE]?.archived?.with).toBe(PROJECT)
    expect(projectHistoryReads()).toEqual([])
  })

  it('a project card’s parent is found without reading the project’s every change', async () => {
    const parents = await resolveParentsAsViewer([PROJECT], 'https://relay.test', token)

    expect(parents[PROJECT]).toBeNull()
    expect(projectHistoryReads()).toEqual([])
  })
})
