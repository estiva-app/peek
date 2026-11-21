/**
 * Peek's writes to a topic once topics are kept in order (ALL-5, SPEC §6.13, §6.14, §6.5): the relay announces it, or
 * the tab opted in with `?topicFields=on`, since a relay that keeps them for one team announces nothing.
 *
 * Every change names the change it follows; a Delete, which a topic's listing declares as a `kind:5`, is the topic's
 * `deleted` change and takes nothing off its team's list; a Restore is that change set back to empty. With the switch
 * off everything is written as before. Asserted on the signed events that reach the relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))
// A build with a relay, so the switch asks it; tests have none by default.
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

import { applyActionAsViewer, deleteFileAsViewer, forgetUrlShapes, listsPrevAsViewer, renameFileAsViewer, restoreFileAsViewer, setTopicFileAsViewer } from './foreign'
import { documentFieldsOptIn, forgetProjectFields, topicFieldsOptIn } from './projectFields'

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

/** The relay's NIP-11: the types it says it keeps in order, with the list read offered either way. */
function relayKeeps(types: string[]) {
  const info = { ...(types.length ? { files: { requires_prev: types } } : {}), file_list: { newest: true, text: true } }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => info })))
}

/** A tab's own storage, where the opt-ins are kept. */
function tabStorage() {
  const kept = new Map<string, string>()
  vi.stubGlobal('window', {
    sessionStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) },
  })
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const sent = () => signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; tags: string[][] })
const wire = () => sent().map((e) => [e.kind, tag(e, 'field'), tag(e, 'value'), tag(e, 'prev')])

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

describe('A topic the relay keeps in order', () => {
  it('Rename follows the topic’s first record, then the title’s current change', async () => {
    relayKeeps(['osnova.topic'])
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
    relayKeeps(['osnova.topic'])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    const result = await deleteFileAsViewer({ naddr: TOPIC, actionId: 'delete', address: TOPIC, folder: FOLDER, hasState: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([[1851, 'deleted', 'true', topic.id]])
  })

  it('a Delete run with no value, as a card or the launcher runs a confirm, still deletes: never the empty value, which restores', async () => {
    relayKeeps(['osnova.topic'])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    const result = await applyActionAsViewer({ naddr: TOPIC, actionId: 'delete', value: '' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(wire()).toEqual([[1851, 'deleted', 'true', topic.id]])
  })

  it('Restore sets deleted back to empty after the deleting change, read when the row holds none', async () => {
    relayKeeps(['osnova.topic'])
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver([topic, channel, state, deleting]))
    const result = await restoreFileAsViewer({ naddr: TOPIC, actionId: 'delete' }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([[1851, 'deleted', '', deleting.id]])
  })

  it('Add file follows the topic’s first record for a file never listed, and Remove follows that entry', async () => {
    relayKeeps(['osnova.topic'])
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
    relayKeeps(['osnova.topic'])
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
    relayKeeps(['osnova.topic'])
    const removed = change(`lists:${FILE}`, 'false')
    queryRelay.mockImplementation(relayOver([topic, channel, state, removed]))

    expect(await listsPrevAsViewer(TOPIC, FILE, 'https://relay.test', token)).toBe(removed.id)
  })
})

describe('A tab opted in with ?topicFields=on, on a relay that announces no type', () => {
  it('writes a topic’s changes in order, and a tab that did not opt in writes them as before', async () => {
    relayKeeps([])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    tabStorage()
    try {
      topicFieldsOptIn('?topicFields=on')
      await renameFileAsViewer({ naddr: TOPIC, actionId: 'rename', title: 'Opted in' }, 'https://relay.test', token)
      topicFieldsOptIn('?topicFields=off')
      // Pages alone are not topics.
      documentFieldsOptIn('?documentFields=on')
      forgetProjectFields()
      await renameFileAsViewer({ naddr: TOPIC, actionId: 'rename', title: 'Not opted in' }, 'https://relay.test', token)
    } finally {
      topicFieldsOptIn('?topicFields=off')
      documentFieldsOptIn('?documentFields=off')
    }

    expect(wire()).toEqual([
      [1851, 'title', 'Opted in', topic.id],
      [1851, 'title', 'Not opted in', undefined],
    ])
  })
})

describe('A topic where nothing keeps topics in order', () => {
  it('Delete is the kind:5 and the team’s remove, and Add file names no change it follows', async () => {
    relayKeeps(['osnova.project'])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    await deleteFileAsViewer({ naddr: TOPIC, actionId: 'delete', address: TOPIC, folder: FOLDER, hasState: true }, 'https://relay.test', token)
    await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: FILE, listed: true }, 'https://relay.test', token)

    expect(sent().map((e) => e.kind)).toEqual([5, 1852, 1851])
    expect(tag(sent()[2]!, 'prev')).toBeUndefined()
    expect(await listsPrevAsViewer(TOPIC, FILE, 'https://relay.test', token)).toBeUndefined()
  })

  /*
    A team the relay keeps in order, in a tab that did not opt in: the relay announces nothing for one team, so the
    tab learns it from the refusal, and writes the change again the way the refusal asks.
  */
  it('a Delete the relay refuses as delete-by-field is written again as the deleted change, and nothing is taken off the team’s list', async () => {
    relayKeeps([])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    publishSigned.mockImplementation(async (...args: unknown[]) =>
      (args[1] as { kind: number }).kind === 5 ? { ok: false, reason: 'invalid: delete-by-field: a topic is deleted by its deleted field' } : { ok: true },
    )
    const result = await deleteFileAsViewer({ naddr: TOPIC, actionId: 'delete', address: TOPIC, folder: FOLDER, hasState: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([
      [5, undefined, undefined, undefined],
      [1851, 'deleted', 'true', topic.id],
    ])
  })

  it('a Rename the relay refuses for naming no change it follows is written again after the topic’s first record', async () => {
    relayKeeps([])
    queryRelay.mockImplementation(relayOver([topic, channel, state]))
    publishSigned.mockImplementation(async (...args: unknown[]) =>
      (args[1] as { tags: string[][] }).tags.some((t) => t[0] === 'prev') ? { ok: true } : { ok: false, reason: 'invalid: requires-prev: a topic change names the change it follows in prev' },
    )
    const result = await renameFileAsViewer({ naddr: TOPIC, actionId: 'rename', title: 'Launch 2' }, 'https://relay.test', token)

    expect(result.ok).toBe(true)
    expect(wire()).toEqual([
      [1851, 'title', 'Launch 2', undefined],
      [1851, 'title', 'Launch 2', topic.id],
    ])
  })

  it('Restore of a topic that reads as deleted is still the deleted change, never a kind:5', async () => {
    relayKeeps([])
    const deleting = change('deleted', 'true')
    queryRelay.mockImplementation(relayOver([topic, channel, state, deleting]))
    const result = await restoreFileAsViewer({ naddr: TOPIC, actionId: 'delete', prev: deleting.id }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(wire()).toEqual([[1851, 'deleted', '', deleting.id]])
  })
})
