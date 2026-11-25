/**
 * Peek's writes to a project, kept in order like every file (ALO-6, ALL-8, SPEC §6.2, §6.5, §6.13).
 *
 * Every change names the change it follows (`prev`). Delete is a change of the `deleted` field, `true` to delete and
 * the empty value to restore, whether Ship's manifest declares it so or still as a `kind:5`; it keeps the project
 * listed in its team, since a deleted file stays listed and readers hide it. Asserted on the signed events that reach
 * the relay.
 */import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, queryRelayTimes, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  queryRelayTimes: vi.fn(),
  publishSigned: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, queryRelayTimes, publishSigned, signViaEstivaId }))

import { applyActionAsViewer, deleteFileAsViewer, forgetUrlShapes, moveFileAsViewer, restoreFileAsViewer } from './foreign'
import { parseBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'
import { relayTimes } from '@/test/listRead'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY = 'cd'.repeat(32)
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const PROJECT = 30850
/** A project's `d`, a uuid: its id (SPEC §6.4). */
const ID = '6f1c2b3a-0000-4000-8000-00000000aaaa'
const ADDRESS = `${PROJECT}:${AUTHOR}:${ID}`
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

/** Ship's manifest, with `delete-project` in the shape a test names. */
function shipManifest(deleteShape: 'kind:5' | 'deleted field') {
  return event({
    kind: 31990,
    tags: [['d', 'estiva-ship'], ['k', String(PROJECT)]],
    content: JSON.stringify({
      name: 'Estiva Ship',
      records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value', order: ['ts', 'id'] },
      vocabularies: {
        archived: [
          { value: '', label: 'Active' },
          { value: 'true', label: 'Archived' },
        ],
        deleted: [
          { value: '', label: 'Restored' },
          { value: 'true', label: 'Deleted' },
        ],
      },
      projections: { [PROJECT]: { widget: 'card', slots: { title: { tag: 'name' } } } },
      actions: [
        { id: 'rename-project', label: 'Rename', appliesTo: String(PROJECT), emits: { kind: 1851, field: 'name' }, input: { type: 'string' } },
        {
          id: 'archive-project',
          label: 'Archive',
          appliesTo: String(PROJECT),
          emits: { kind: 1851, field: 'archived' },
          input: { type: 'string', enum: 'archived' },
        },
        { id: 'comment', label: 'Comment', appliesTo: String(PROJECT), emits: { kind: 1111, scope: 'address' }, input: { type: 'string' } },
        deleteShape === 'kind:5'
          ? { id: 'delete-project', label: 'Delete', effect: 'destructive', appliesTo: String(PROJECT), emits: { kind: 5, listed: true } }
          : {
              id: 'delete-project',
              label: 'Delete',
              effect: 'destructive',
              appliesTo: String(PROJECT),
              emits: { kind: 1851, field: 'deleted' },
              input: { type: 'string', enum: 'deleted' },
            },
      ],
    }),
  })
}

const project = event({ kind: PROJECT, tags: [['d', ID], ['name', 'Launch'], ['h', FOLDER]] })
const change = (field: string, value: string) =>
  event({ kind: 1851, tags: [['a', ADDRESS], ['O', ID], ['field', field], ['value', value], ['h', FOLDER]] })
const nameChange = change('name', 'Launch 2')
const channel = event({ kind: 39000, pubkey: RELAY, tags: [['d', FOLDER], ['name', 'Launch team']] })
const state = event({ kind: 30890, pubkey: RELAY, tags: [['d', FOLDER], ['a', ADDRESS]] })

/**
 * A relay answering from `world`: kinds, authors and `#`-tags, and the open read (`fields: 'newest'` by `#d`), which
 * answers the first record with each field's changes — unless `deletedHidden` and the project's newest `deleted` is
 * `true`, which the open read leaves out (§6.13).
 */
function relayOver(world: TestEvent[], { deletedHidden = false, byIdToo = [] as TestEvent[] } = {}) {
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
  // The same world's times read: a deleted project is found by its current changes (SPEC §6.5).
  queryRelayTimes.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => relayTimes(world, filters, matches))
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: filters.flatMap((f) => {
      if (f.ids) return [...world, ...byIdToo].filter((e) => matches(e, f))
      if (f.fields !== 'newest') return world.filter((e) => matches(e, f))
      const roots = world.filter((e) => matches(e, f))
      return roots.flatMap((root) => {
        const address = `${root.kind}:${root.pubkey}:${root.tags.find((t) => t[0] === 'd')?.[1]}`
        const changes = world.filter((e) => e.kind === 1851 && e.tags.some((t) => t[0] === 'a' && t[1] === address))
        const deleted = changes.filter((e) => e.tags.some((t) => t[0] === 'field' && t[1] === 'deleted')).at(-1)
        if (deletedHidden && deleted?.tags.some((t) => t[0] === 'value' && t[1] === 'true')) return []
        return [root, ...changes]
      })
    }),
  }))
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const sent = () => signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; tags: string[][] })

beforeEach(() => {
  publishSigned.mockReset()
  publishSigned.mockImplementation(async () => ({ ok: true }))
  signViaEstivaId.mockClear()
  forgetUrlShapes()
})

describe('Delete, declared as a change of the deleted field', () => {
  const world = (...more: TestEvent[]) => [shipManifest('deleted field'), project, channel, state, nameChange, ...more]

  it('sends deleted = true after the project’s first record, and leaves it listed in its team', async () => {
    queryRelay.mockImplementation(relayOver(world()))
    const result = await deleteFileAsViewer(
      { naddr: ADDRESS, actionId: 'delete-project', address: ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result).toEqual({ ok: true })
    const events = sent()
    expect(events).toHaveLength(1)
    const [deleted] = events
    expect(deleted.kind).toBe(1851)
    expect(tag(deleted, 'a')).toBe(ADDRESS)
    expect(tag(deleted, 'field')).toBe('deleted')
    expect(tag(deleted, 'value')).toBe('true')
    // Never changed before: its first change follows the first record.
    expect(tag(deleted, 'prev')).toBe(project.id)
  })

  it('Restore sends deleted = empty after the deleting change, even where the open read hides the deleted project', async () => {
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver(world(deleting), { deletedHidden: true }))
    // Restore is the same action with the empty value, after the change the deleted card was read with.
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'delete-project', value: '', prev: deleting.id }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'deleted', '', deleting.id]])
  })

  it('Restore from a card that holds no prev reads the deleted project as before and follows its deleting change', async () => {
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver(world(deleting), { deletedHidden: true }))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'delete-project', value: '' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'deleted', '', deleting.id]])
  })

  it('Restore from Archive → Deleted or a deleted card sends deleted = empty after the deleting change', async () => {
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver(world(deleting), { deletedHidden: true }))
    // What the tab's row and the card call: the project's Delete action, by its id, after the change they hold.
    const result = await restoreFileAsViewer({ naddr: ADDRESS, actionId: 'delete-project', prev: deleting.id }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'deleted', '', deleting.id]])
  })
})

describe('Delete, declared as a kind:5', () => {
  // Interop 0.109: where the relay keeps projects in order it refuses a kind:5 on one, so an older
  // listing's kind:5 Delete is the `deleted` change, and with no change to follow nothing is sent.
  it('marks the file deleted after its first record, with no kind:5 and no team remove', async () => {
    queryRelay.mockImplementation(relayOver([shipManifest('kind:5'), project, channel, state]))
    const result = await deleteFileAsViewer(
      { naddr: ADDRESS, actionId: 'delete-project', address: ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result).toEqual({ ok: true })
    expect(sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])).toEqual([[1851, 'deleted', 'true', project.id]])
  })
})

describe('Delete, when the manifest cannot be read', () => {
  it('sends nothing and says so, rather than a restore and a team remove', async () => {
    // The manifest read fails once (a busy relay); the next read would answer Ship's deleted-field Delete.
    const relay = relayOver([shipManifest('deleted field'), project, channel, state])
    queryRelay.mockImplementation(async (url: string, filters: Record<string, unknown>[]) => {
      if (filters.some((f) => (f.kinds as number[] | undefined)?.includes(31990)) && !relay.mock.calls.length) {
        relay.mock.calls.push([url, filters])
        throw new Error('relay busy')
      }
      return relay(url, filters)
    })
    const result = await deleteFileAsViewer(
      { naddr: ADDRESS, actionId: 'delete-project', address: ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result.ok).toBe(false)
    expect(sent()).toEqual([])
  })
})

describe('A change to a project', () => {
  const world = () => [shipManifest('deleted field'), project, channel, state, nameChange]

  it('names the field’s current change as its prev', async () => {
    queryRelay.mockImplementation(relayOver(world()))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'rename-project', value: 'Launch 3' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    const [renamed] = sent()
    expect([renamed.kind, tag(renamed, 'field'), tag(renamed, 'value'), tag(renamed, 'prev')]).toEqual([1851, 'name', 'Launch 3', nameChange.id])
  })

  it('is set again on top of a crossing change the relay names in its conflict', async () => {
    // Someone renamed it after Peek read it: the open read does not have it yet, the relay does.
    const crossing = change('name', 'Launch 4')
    queryRelay.mockImplementation(relayOver(world(), { byIdToo: [crossing] }))
    publishSigned
      .mockImplementationOnce(async () => ({ ok: false, reason: `conflict: name follows ${crossing.id}` }))
      .mockImplementationOnce(async () => ({ ok: true }))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'rename-project', value: 'Launch 3' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(sent().map((e) => [tag(e, 'value'), tag(e, 'prev')])).toEqual([
      ['Launch 3', nameChange.id],
      ['Launch 3', crossing.id],
    ])
  })

  it('a move to another team names it by its id', async () => {
    queryRelay.mockImplementation(relayOver(world()))
    const OTHER_TEAM = '9c69f247-0000-4000-8000-0000000000ff'
    const file = { ref: ADDRESS, address: ADDRESS }
    const result = await moveFileAsViewer(
      file,
      new Map([[FOLDER, [file]]]),
      [{ id: FOLDER, hasState: true, addresses: [ADDRESS] }],
      { id: OTHER_TEAM, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result.ok).toBe(true)
    const [move] = sent()
    expect([move.kind, tag(move, 'op'), tag(move, 'from'), tag(move, 'h')]).toEqual([1852, 'move', FOLDER, OTHER_TEAM])
    expect(move.tags.filter((t) => t[0] === 'o').map((t) => t[1])).toEqual([ID])
  })

  it('a comment on it names it by its id as well as its address', async () => {
    queryRelay.mockImplementation(relayOver(world()))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'comment', value: 'Looks good' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    const [comment] = sent()
    expect(comment.kind).toBe(1111)
    expect(tag(comment, 'A')).toBe(ADDRESS)
    expect(tag(comment, 'O')).toBe(ID)
    expect(tag(comment, 'prev')).toBeUndefined()
  })
})
