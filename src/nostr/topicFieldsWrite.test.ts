/**
 * Peek's writes to a topic, kept in order like every file (ALL-5, ALL-8, SPEC §6.13, §6.14, §6.5): every change names
 * the change it follows; a Delete, which a topic's listing may still declare as a `kind:5`, is the topic's `deleted`
 * change and takes nothing off its team's list; a Restore is that change set back to empty. Asserted on the signed
 * events that reach the relay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, queryRelayTimes, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  queryRelayTimes: vi.fn(),
  publishSigned: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, queryRelayTimes, publishSigned, signViaEstivaId }))

import { applyActionAsViewer, deleteFileAsViewer, forgetUrlShapes, listsPrevAsViewer, renameFileAsViewer, restoreFileAsViewer, setTopicFileAsViewer } from './foreign'
import { relayTimes } from '@/test/listRead'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY = 'cd'.repeat(32)
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const TOPIC_KIND = 30840
const ID = '6f1c2b3a-0000-4000-8000-00000000bbbb'
const TOPIC = `${TOPIC_KIND}:${AUTHOR}:${ID}`
/** A file from another team, listed by its id. */
const FILE = '0d0d0d0d-0000-4000-8000-00000000cccc'
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

const topic = event({ kind: TOPIC_KIND, tags: [['d', ID], ['title', 'Launch'], ['h', FOLDER]] })
const change = (field: string, value: string) =>
  event({ kind: 1851, tags: [['a', TOPIC], ['O', ID], ['field', field], ['value', value], ['h', FOLDER]] })
const channel = event({ kind: 39000, pubkey: RELAY, tags: [['d', FOLDER], ['name', 'Launch team']] })
const state = event({ kind: 30890, pubkey: RELAY, tags: [['d', FOLDER], ['a', TOPIC]] })

/** A relay answering from `world`; the open read answers the first record with each field's changes, a deleted file left out. */
function relayOver(world: TestEvent[]) {
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
  // The same world's times read: a deleted topic is found by its current changes (SPEC §6.5).
  queryRelayTimes.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => relayTimes(world, filters, matches))
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: filters.flatMap((f) => {
      if (f.fields !== 'newest') return world.filter((e) => matches(e, f))
      return world
        .filter((e) => matches(e, f))
        .flatMap((root) => {
          const changes = world.filter((e) => e.kind === 1851 && e.tags.some((t) => t[0] === 'a' && t[1] === TOPIC))
          const deleted = changes.filter((e) => e.tags.some((t) => t[0] === 'field' && t[1] === 'deleted')).at(-1)
          if (deleted?.tags.some((t) => t[0] === 'value' && t[1] === 'true')) return []
          return [root, ...changes]
        })
    }),
  }))
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const sent = () => signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; tags: string[][] })
const wire = () => sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])

beforeEach(() => {
  publishSigned.mockReset()
  publishSigned.mockImplementation(async () => ({ ok: true }))
  signViaEstivaId.mockClear()
  forgetUrlShapes()
})

describe('A change to a topic', () => {
  it('Rename follows the topic’s first record, then the title’s current change', async () => {
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    await renameFileAsViewer({ naddr: TOPIC, actionId: 'rename', title: 'Launch 2' }, 'https://relay.test', token)
    const renamed = change('title', 'Launch 2')
    queryRelay.mockImplementation(relayOver([topic, channel, state, renamed]))
    await renameFileAsViewer({ naddr: TOPIC, actionId: 'rename', title: 'Launch 3' }, 'https://relay.test', token)

    expect(wire()).toEqual([
      [1851, 'title', 'Launch 2', topic.id],
      [1851, 'title', 'Launch 3', renamed.id],
    ])
  })

  it('Delete marks the topic deleted after its first record: no kind:5, and nothing taken off its team’s list', async () => {
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    const result = await deleteFileAsViewer({ naddr: TOPIC, actionId: 'delete', address: TOPIC, folder: FOLDER, hasState: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([[1851, 'deleted', 'true', topic.id]])
  })

  it('Restore sets deleted back to empty after the deleting change, read when the row holds none', async () => {
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver([topic, channel, state, deleting]))
    const result = await restoreFileAsViewer({ naddr: TOPIC, actionId: 'delete' }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([[1851, 'deleted', '', deleting.id]])
  })

  it('Add file follows the topic’s first record for a file never listed, and Remove follows that entry', async () => {
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: FILE, listed: true }, 'https://relay.test', token)
    const added = change(`lists:${FILE}`, 'true')
    queryRelay.mockImplementation(relayOver([topic, channel, state, added]))
    await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: FILE, listed: false }, 'https://relay.test', token)

    expect(wire()).toEqual([
      [1851, `lists:${FILE}`, 'true', topic.id],
      [1851, `lists:${FILE}`, 'false', added.id],
    ])
    expect(tag(sent()[0]!, 'o')).toBe(FILE)
  })

  it('an entry the relay refuses as stale is written again after the newer one', async () => {
    const world = [topic, channel, state]
    queryRelay.mockImplementation(relayOver(world))
    const theirs = change(`lists:${FILE}`, 'false')
    publishSigned.mockImplementationOnce(async () => {
      // Someone else's entry for the same file landed first.
      world.push(theirs)
      return { ok: false, reason: `conflict: lists:${FILE} follows ${theirs.id}` }
    })
    const result = await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: FILE, listed: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire().map((row) => row[3])).toEqual([topic.id, theirs.id])
  })

  it('Undo’s listing is handed the Remove it follows', async () => {
    const removed = change(`lists:${FILE}`, 'false')
    queryRelay.mockImplementation(relayOver([topic, channel, state, removed]))

    expect(await listsPrevAsViewer(TOPIC, FILE, 'https://relay.test', token)).toBe(removed.id)
  })
})
