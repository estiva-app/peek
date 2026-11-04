/**
 * Peek's reads of projects once the relay keeps them in order (ALO-6, SPEC §6.13): a team's list and the files `[`
 * offers by the relay's list read, the cards under messages by its open read — all of a screen's cards in one read —
 * and `[` finding a project by a word in its current fields. Asserted on the filters that reach the relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, queryRelayWithMatches, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  queryRelayWithMatches: vi.fn(async (..._args: unknown[]) => ({ events: [], matches: [] })),
  publishSigned: vi.fn(async () => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, queryRelayWithMatches, publishSigned, signViaEstivaId }))
// A build with a relay, so the switch asks it; tests have none by default.
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

import {
  fileCandidatesAsViewer,
  forgetUrlShapes,
  resolveFolderContentsAsViewer,
  resolveObjectsAsViewer,
  searchFileReferencesAsViewer,
} from './foreign'
import { forgetProjectFields } from './projectFields'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const A = `30850:${AUTHOR}:6f1c2b3a-0000-4000-8000-00000000aaaa`
const B = `30850:${AUTHOR}:6f1c2b3a-0000-4000-8000-00000000bbbb`
const token = { accessToken: 't', pubkey: AUTHOR } as never

/** The relay's NIP-11: keeping projects in order and finding them by their words (on), or saying nothing (off). */
function relayInfo(on: boolean) {
  const info = on
    ? {
        files: { requires_prev: ['osnova.project'] },
        file_list: { newest: true, text: true },
        file_search: { types: ['osnova.project'] },
      }
    : { supported_nips: [1, 11] }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => info })))
}

const RELAY = 'cd'.repeat(32)
let seq = 0
const event = (kind: number, tags: string[][], pubkey = AUTHOR) => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey,
  created_at: 1_700_000_000 + seq,
  kind,
  tags,
  content: '',
})
const manifest = {
  ...event(31990, [['d', 'estiva-ship'], ['k', '30850']]),
  content: JSON.stringify({
    name: 'Estiva Ship',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
    projections: { 30850: { widget: 'card', slots: { title: { tag: 'name' } } } },
    actions: [],
  }),
}
/** A team listing two projects, and Ship's manifest for them. */
const world = [
  manifest,
  event(39000, [['d', FOLDER], ['name', 'Launch team']], RELAY),
  event(30890, [['d', FOLDER], ['a', A], ['a', B]], RELAY),
  event(30850, [['d', A.split(':')[2]], ['name', 'Launch'], ['h', FOLDER]]),
  event(30850, [['d', B.split(':')[2]], ['name', 'Roadmap'], ['h', FOLDER]]),
]

/** A relay answering from the world above: kinds, authors, ids and `#`-tags; the rest of a filter is the relay's. */
const answer = (_url: string, filters: Record<string, unknown>[]) => answerFrom(world, filters)

async function answerFrom(events: readonly ReturnType<typeof event>[], filters: Record<string, unknown>[]) {
  return { ok: true, events: events.filter((e) =>
    filters.some((f) => {
      if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
      if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
      if (f.ids && !(f.ids as string[]).includes(e.id)) return false
      for (const [key, want] of Object.entries(f)) {
        if (!key.startsWith('#')) continue
        const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
        if (!(want as string[]).some((v) => held.includes(v))) return false
      }
      return true
    }),
  ) }
}

/** Every filter the relay was asked, one list per request. */
const requests = () => queryRelay.mock.calls.map(([, filters]) => filters as Record<string, unknown>[])
const listReads = () => requests().flat().filter((f) => f.fields === 'newest')

beforeEach(() => {
  queryRelay.mockReset()
  queryRelay.mockImplementation(answer)
  queryRelayWithMatches.mockClear()
  forgetUrlShapes()
  forgetProjectFields()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('with the switch on', () => {
  it('reads a team’s projects by the relay’s list read', async () => {
    relayInfo(true)
    await resolveFolderContentsAsViewer(FOLDER, 'https://relay.test', token).catch(() => undefined)

    expect(listReads().length).toBeGreaterThan(0)
  })

  it('opens every project card on a screen by the open read, in one request', async () => {
    relayInfo(true)
    await resolveObjectsAsViewer([A, B], 'https://relay.test', token).catch(() => undefined)

    const opening = requests().filter((filters) => filters.some((f) => f.fields === 'newest' && f.text === true))
    expect(opening).toHaveLength(1)
    const named = opening[0].flatMap((f) => (f['#d'] as string[] | undefined) ?? [])
    expect(named).toEqual(expect.arrayContaining([A.split(':')[2], B.split(':')[2]]))
  })

  it('`[` finds a project by a word in its current fields', async () => {
    relayInfo(true)
    await searchFileReferencesAsViewer('roadmap', 'https://relay.test', token).catch(() => undefined)

    const asked = queryRelayWithMatches.mock.calls.flatMap(([, filters]) => filters as Record<string, unknown>[])
    expect(asked.some((f) => (f.kinds as number[] | undefined)?.includes(30850) && typeof f.search === 'string' && f.search.includes('roadmap'))).toBe(true)
  })
})

describe('a deleted project, whichever way the switch is', () => {
  // B's newest `deleted` change is `true`: deleted, still listed in its team's state (SPEC §6.5).
  const deleting = event(1851, [['a', B], ['O', B.split(':')[2]], ['field', 'deleted'], ['value', 'true'], ['h', FOLDER]])
  const withDeleted = [...world, deleting]

  it('is gone from its team’s list, with the switch off', async () => {
    relayInfo(false)
    queryRelay.mockImplementation((_url: string, filters: Record<string, unknown>[]) => answerFrom(withDeleted, filters))
    const contents = await resolveFolderContentsAsViewer(FOLDER, 'https://relay.test', token)

    expect(contents.files.map((file) => file.address)).toEqual([A])
  })

  it('is gone from the files `[` offers from a team, with the switch off', async () => {
    relayInfo(false)
    queryRelay.mockImplementation((_url: string, filters: Record<string, unknown>[]) => answerFrom(withDeleted, filters))
    const read = await resolveObjectsAsViewer([A, B], 'https://relay.test', token)
    const offered = await fileCandidatesAsViewer([read[A]!, read[B]!], 0, 'https://relay.test', token)

    expect(offered.map((candidate) => candidate.id)).toEqual([A])
  })
})
