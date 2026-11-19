/**
 * Peek's writes to an issue once the relay keeps issues in order (ISS-6, SPEC §6.1, §6.2, §6.5): issues' own switch,
 * apart from projects'. A change from an issue's card names the change it follows, a new issue from the launcher is
 * its first record with no text and then its text as one change, and Restore follows the deleting change. Asserted on
 * the signed events that reach the relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => {
  let signed = 0
  return {
    queryRelay: vi.fn(),
    publishSigned: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })),
    // The signer gives each event its id, as Estiva ID does: what a later change names as its `prev`.
    signViaEstivaId: vi.fn(async (event: object) => ({ ...event, id: String(++signed).padStart(64, 'e'), sig: '' })),
  }
})

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))
// A build with a relay, so the switch asks it; tests have none by default.
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

import { applyActionAsViewer, forgetUrlShapes, restoreFileAsViewer } from './foreign'
import { forgetProjectFields } from './projectFields'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY = 'cd'.repeat(32)
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const PROJECT_ID = '6f1c2b3a-0000-4000-8000-00000000aaaa'
const PROJECT = `30850:${AUTHOR}:${PROJECT_ID}`
const ISSUE_ID = '6f1c2b3a-0000-4000-8000-00000000eeee'
const ISSUE = `30851:${AUTHOR}:${ISSUE_ID}`
const FORMAT = 'estiva-blocks-1'
const token = { accessToken: 't', pubkey: AUTHOR } as never

interface TestEvent {
  id: string
  sig: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

let seq = 0
const event = (partial: Partial<TestEvent> & { kind: number }): TestEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: AUTHOR,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

/** Ship's manifest as it is declared for issues at the switch: Add issue, its text, status, and Delete as a field. */
const manifest = event({
  kind: 31990,
  tags: [['d', 'estiva-ship'], ['k', '30850'], ['k', '30851']],
  content: JSON.stringify({
    name: 'Estiva Ship',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value', order: ['ts', 'id'] },
    vocabularies: { deleted: [{ value: '', label: 'Restored' }, { value: 'true', label: 'Deleted' }] },
    projections: {
      30850: { widget: 'card', slots: { title: { tag: 'name' } } },
      30851: { widget: 'card', slots: { title: { tag: 'title' }, body: { tag: 'description', field: 'description' } } },
    },
    actions: [
      {
        id: 'add-issue',
        label: 'Add issue',
        appliesTo: '30850',
        emits: { kind: 30851, setTag: 'a', toAddressOf: 'self' },
        input: {
          type: 'object',
          properties: { title: { type: 'string' }, description: { type: 'string', target: 'content', format: FORMAT } },
          required: ['title'],
        },
      },
      { id: 'describe-issue', label: 'Edit description', appliesTo: '30851', emits: { kind: 1851, field: 'description' }, input: { type: 'string', format: FORMAT } },
      { id: 'set-issue-status', label: 'Status', appliesTo: '30851', emits: { kind: 1851, field: 'status' }, input: { type: 'string' } },
      { id: 'delete-issue', label: 'Delete', effect: 'destructive', appliesTo: '30851', emits: { kind: 1851, field: 'deleted' }, input: { type: 'string', enum: 'deleted' } },
    ],
  }),
})

const project = event({ kind: 30850, tags: [['d', PROJECT_ID], ['name', 'Launch'], ['h', FOLDER]] })
const issue = event({ kind: 30851, tags: [['d', ISSUE_ID], ['title', 'Broken link'], ['a', PROJECT], ['h', FOLDER]] })
const change = (field: string, value: string) => event({ kind: 1851, tags: [['a', ISSUE], ['O', ISSUE_ID], ['field', field], ['value', value], ['h', FOLDER]] })
const statusChange = change('status', 'in_progress')
const channel = event({ kind: 39000, pubkey: RELAY, tags: [['d', FOLDER], ['name', 'Launch team']] })
const world = (...more: TestEvent[]) => [manifest, project, issue, channel, statusChange, ...more]

/** A relay answering from `world`: kinds, authors, ids and `#`-tags, and the open read (`fields: 'newest'`) whole. */
function relayOver(events: TestEvent[]) {
  const matches = (e: TestEvent, f: Record<string, unknown>) => {
    if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
    if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
    if (f.ids && !(f.ids as string[]).includes(e.id)) return false
    for (const [key, want] of Object.entries(f)) {
      if (!key.startsWith('#')) continue
      const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
      if (!(want as string[]).some((v) => held.includes(v))) return false
    }
    return true
  }
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: filters.flatMap((f) => {
      if (f.fields !== 'newest') return events.filter((e) => matches(e, f))
      return events.filter((e) => matches(e, f)).flatMap((root) => {
        const address = `${root.kind}:${root.pubkey}:${root.tags.find((t) => t[0] === 'd')?.[1]}`
        return [root, ...events.filter((e) => e.kind === 1851 && e.tags.some((t) => t[0] === 'a' && t[1] === address))]
      })
    }),
  }))
}

/** The relay's NIP-11, keeping in order the types named. */
function relayKeeps(types: string[]) {
  const info = { files: { requires_prev: types }, file_list: { newest: true, text: true } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => info })))
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const sent = () => publishSigned.mock.calls.map(([, e]) => e as { id: string; kind: number; tags: string[][]; content: string })

beforeEach(() => {
  publishSigned.mockReset()
  publishSigned.mockImplementation(async () => ({ ok: true }))
  signViaEstivaId.mockClear()
  forgetUrlShapes()
  forgetProjectFields()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("A change from an issue's card", () => {
  it('names the status’s current change as its prev, once the relay keeps issues in order', async () => {
    relayKeeps(['osnova.project', 'osnova.issue'])
    queryRelay.mockImplementation(relayOver(world()))
    const result = await applyActionAsViewer({ naddr: ISSUE, actionId: 'set-issue-status', value: 'done' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'status', 'done', statusChange.id]])
  })

  it('names no change it follows while only projects are kept in order (control)', async () => {
    relayKeeps(['osnova.project'])
    queryRelay.mockImplementation(relayOver(world()))
    const result = await applyActionAsViewer({ naddr: ISSUE, actionId: 'set-issue-status', value: 'done' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'status', 'done', undefined]])
  })
})

describe('An issue filed from the launcher', () => {
  it('is its first record with no text, then its text as one change after that record', async () => {
    relayKeeps(['osnova.project', 'osnova.issue'])
    queryRelay.mockImplementation(relayOver(world()))
    const text = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', id: 'b1', content: [{ type: 'text', text: 'Steps to reproduce' }] }] })
    const result = await applyActionAsViewer(
      { naddr: PROJECT, actionId: 'add-issue', value: { title: 'Login fails', description: text }, contentFormat: FORMAT },
      'https://relay.test',
      token,
    )

    expect(result.ok).toBe(true)
    const [first, words, ...rest] = sent()
    expect(rest).toEqual([])
    expect(first.kind).toBe(30851)
    expect(tag(first, 'title')).toBe('Login fails')
    expect(tag(first, 'description')).toBeUndefined()
    expect(first.content).toBe('')
    expect([words.kind, tag(words, 'field'), tag(words, 'value'), tag(words, 'prev'), tag(words, 'content-format')]).toEqual([1851, 'description', text, first.id, FORMAT])
    expect(tag(words, 'a')).toBe(`30851:${AUTHOR}:${tag(first, 'd')}`)
  })

  it('is one event carrying its text while issues are not kept in order (control)', async () => {
    relayKeeps(['osnova.project'])
    queryRelay.mockImplementation(relayOver(world()))
    const result = await applyActionAsViewer(
      { naddr: PROJECT, actionId: 'add-issue', value: { title: 'Login fails', description: 'Steps' } },
      'https://relay.test',
      token,
    )

    expect(result.ok).toBe(true)
    expect(sent().filter((e) => e.kind === 1851)).toEqual([])
    expect(sent().find((e) => e.kind === 30851)?.content).toBe('Steps')
  })
})

describe('Restore of a deleted issue', () => {
  it('sends deleted = empty after the deleting change, from Archive → Deleted', async () => {
    relayKeeps(['osnova.project', 'osnova.issue'])
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver(world(deleting)))
    const result = await restoreFileAsViewer({ naddr: ISSUE, actionId: 'delete-issue', prev: deleting.id }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'deleted', '', deleting.id]])
  })
})
