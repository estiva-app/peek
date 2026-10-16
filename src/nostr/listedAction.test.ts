/**
 * An action followed by a Folder command — SPEC §7.3's `listed` (MAN-4).
 *
 * Ship's `delete-project` is a `kind:5` and then a `kind:1852 remove` from
 * every Folder whose state names the project; `add-project` is the record and
 * then an `add` when its Folder has state. interop's single-event builder
 * refuses both rather than build the first half alone, so before this Peek's
 * Delete on a project would have failed with the runtime's sentence the day
 * Ship declared it. These pin that Peek reads the Folders, builds every event,
 * publishes them in order, and does not unlist a second time on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import { applyActionAsViewer, deleteFileAsViewer, forgetUrlShapes } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const RELAY = 'cd'.repeat(32)
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const OTHER = '9c69f247-0000-4000-8000-000000000001'
const UNRELATED = '9c69f247-0000-4000-8000-000000000002'
const PROJECT = 30850
const ISSUE = 30851
const ADDRESS = `${PROJECT}:${AUTHOR}:p1`
const ISSUE_ADDRESS = `${ISSUE}:${AUTHOR}:i1`
const FOLDER_RECORD = `39000:${RELAY}:${FOLDER}`
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

/*
  Ship's two `listed` declarations, as `src/nostr/manifest.ts` in Ship writes
  them. No `39000` claim: a Folder is no app's (SPEC §3.2, interop 0.58), so
  `add-project` is built with Ship's manifest only when the caller names it.
*/
const manifest = event({
  kind: 31990,
  tags: [['d', 'estiva-ship'], ['k', String(PROJECT)], ['k', String(ISSUE)]],
  content: JSON.stringify({
    name: 'Estiva Ship',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
    projections: {
      [PROJECT]: { widget: 'card', slots: { title: { tag: 'name' } } },
      [ISSUE]: { widget: 'row', slots: { title: { tag: 'title' } } },
    },
    actions: [
      {
        id: 'delete-project',
        label: 'Delete',
        appliesTo: String(PROJECT),
        emits: { kind: 5, listed: true },
      },
      {
        id: 'delete-issue',
        label: 'Delete',
        appliesTo: String(ISSUE),
        emits: { kind: 5 },
      },
      {
        id: 'add-project',
        label: 'New project',
        appliesTo: '39000',
        emits: { kind: PROJECT, placement: 'buzz-channel', listed: true },
        input: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    ],
  }),
})

const project = event({ kind: PROJECT, tags: [['d', 'p1'], ['name', 'Launch'], ['buzz-channel', FOLDER]] })
const issue = event({ kind: ISSUE, tags: [['d', 'i1'], ['title', 'Billing'], ['h', FOLDER]] })
const channel = (id: string) => event({ kind: 39000, pubkey: RELAY, tags: [['d', id], ['name', id.slice(-1)]] })
const state = (id: string, addresses: string[], pubkey = RELAY) =>
  event({ kind: 30890, pubkey, tags: [['d', id], ...addresses.map((a) => ['a', a])] })

/** A relay answering from `world`, honouring kinds/authors/#-tags. */
function relayOver(world: TestEvent[]) {
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: world.filter((e) =>
      filters.some((f) => {
        if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
        if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
        for (const [key, want] of Object.entries(f)) {
          if (!key.startsWith('#')) continue
          const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
          if (!(want as string[]).some((v) => held.includes(v))) return false
        }
        return true
      }),
    ),
  }))
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
/** What was published, as `kind op folder`. */
const published = () =>
  signViaEstivaId.mock.calls.map(([e]) => {
    const sent = e as { kind: number; tags: string[][] }
    return [sent.kind, tag(sent, 'op'), tag(sent, 'h')].filter(Boolean).join(' ')
  })

beforeEach(() => {
  publishSigned.mockReset()
  publishSigned.mockImplementation(async () => ({ ok: true }))
  signViaEstivaId.mockClear()
})

describe('a listed deletion', () => {
  const world = [
    manifest,
    project,
    channel(FOLDER),
    channel(OTHER),
    channel(UNRELATED),
    state(FOLDER, [ADDRESS]),
    state(OTHER, [ADDRESS]),
    state(UNRELATED, []),
    // Not the relay's: a state signed by somebody else is no Folder's listing.
    event({ kind: 30890, pubkey: AUTHOR, tags: [['d', UNRELATED], ['a', ADDRESS]] }),
  ]

  it('deletes, then removes it from every Folder whose state names it, and from no other', async () => {
    queryRelay.mockImplementation(relayOver(world))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'delete-project', value: '' }, 'https://relay.test', token)

    expect(result).toMatchObject({ ok: true, listed: true })
    expect(result.incomplete).toBeUndefined()
    expect(published()).toEqual(['5', `1852 remove ${FOLDER}`, `1852 remove ${OTHER}`])
  })

  it('through deleteFileAsViewer, unlists once — the declaration’s commands, not a second remove', async () => {
    queryRelay.mockImplementation(relayOver(world))
    const result = await deleteFileAsViewer(
      { naddr: ADDRESS, actionId: 'delete-project', address: ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result).toEqual({ ok: true })
    expect(published()).toEqual(['5', `1852 remove ${FOLDER}`, `1852 remove ${OTHER}`])
  })

  it('stops at a refused remove, and says the project is gone but still listed', async () => {
    queryRelay.mockImplementation(relayOver(world))
    publishSigned
      .mockImplementationOnce(async () => ({ ok: true }))
      .mockImplementationOnce(async () => ({ ok: false, reason: 'restricted: not a channel member' }))
    const result = await deleteFileAsViewer(
      { naddr: ADDRESS, actionId: 'delete-project', address: ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/deleted but is still listed/)
    // The second remove is never sent: each command assumes the one before it landed.
    expect(published()).toEqual(['5', `1852 remove ${FOLDER}`])
  })

  it('leaves an unlisted deletion to deleteFileAsViewer’s own unlist, as before', async () => {
    queryRelay.mockImplementation(relayOver([manifest, issue, channel(FOLDER), state(FOLDER, [ISSUE_ADDRESS])]))
    const result = await deleteFileAsViewer(
      { naddr: ISSUE_ADDRESS, actionId: 'delete-issue', address: ISSUE_ADDRESS, folder: FOLDER, hasState: true },
      'https://relay.test',
      token,
    )

    expect(result).toEqual({ ok: true })
    expect(published()).toEqual(['5', `1852 remove ${FOLDER}`])
  })

  it('sends nothing after a refused kind:5', async () => {
    queryRelay.mockImplementation(relayOver(world))
    publishSigned.mockImplementationOnce(async () => ({ ok: false, reason: 'blocked: not the author' }))
    const result = await applyActionAsViewer({ naddr: ADDRESS, actionId: 'delete-project', value: '' }, 'https://relay.test', token)

    expect(result).toEqual({ ok: false, reason: 'blocked: not the author' })
    expect(published()).toEqual(['5'])
  })
})

describe('a listed creation', () => {
  const create = () =>
    applyActionAsViewer(
      { naddr: FOLDER_RECORD, actionId: 'add-project', value: { name: 'Launch' }, declaredBy: `31990:${AUTHOR}:estiva-ship` },
      'https://relay.test',
      token,
    )

  it('into a Folder with state: the record in buzz-channel, then an add naming it', async () => {
    queryRelay.mockImplementation(relayOver([manifest, channel(FOLDER), state(FOLDER, [])]))
    const result = await create()

    expect(result).toMatchObject({ ok: true, listed: true })
    const [record, listing] = signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; tags: string[][] })
    expect(record.kind).toBe(PROJECT)
    expect(tag(record, 'buzz-channel')).toBe(FOLDER)
    expect(tag(listing, 'op')).toBe('add')
    expect(tag(listing, 'a')).toBe(result.created)
  })

  it('into a Folder without state: the record alone', async () => {
    queryRelay.mockImplementation(relayOver([manifest, channel(FOLDER)]))
    const result = await create()

    expect(result.ok).toBe(true)
    expect(published()).toEqual([String(PROJECT)])
  })

  it('does not take a state somebody other than the relay signed as the Folder’s', async () => {
    queryRelay.mockImplementation(relayOver([manifest, channel(FOLDER), state(FOLDER, [], AUTHOR)]))
    const result = await create()

    expect(result.ok).toBe(true)
    // An `add` here would make the relay emit state listing only this project.
    expect(published()).toEqual([String(PROJECT)])
  })

  it('reports a refused add as incomplete, beside the record that landed', async () => {
    queryRelay.mockImplementation(relayOver([manifest, channel(FOLDER), state(FOLDER, [])]))
    publishSigned
      .mockImplementationOnce(async () => ({ ok: true }))
      .mockImplementationOnce(async () => ({ ok: false, reason: 'restricted: not a channel member' }))
    const result = await create()

    expect(result).toMatchObject({ ok: true, listed: true, incomplete: 'restricted: not a channel member' })
    expect(result.created).toMatch(/^30850:/)
  })
})

describe('a creation another app declares on a Folder (MAN-8)', () => {
  /*
    Peek's listing still claims a Folder until it is republished, and the
    runtime no longer reads that claim (interop 0.58): a Folder resolves
    through the specification's built-in, which has no `add-project` — so the
    creation is built only because the caller names Ship's manifest as the one
    that declared it.
  */
  const PEEK_APP = 'ee'.repeat(32)
  const peekManifest = event({
    kind: 31990,
    pubkey: PEEK_APP,
    tags: [['d', 'estiva-peek'], ['k', '39000'], ['k', '9']],
    content: JSON.stringify({
      name: 'Peek',
      projections: { 39000: { widget: 'card', slots: { title: { tag: 'name' } } }, 9: { widget: 'card', slots: {} } },
      actions: [],
    }),
  })
  const shipOnly = manifest
  const SHIP_MANIFEST = `31990:${AUTHOR}:estiva-ship`

  beforeEach(() => forgetUrlShapes())

  it('files the project with Ship’s manifest, and lists it in the Folder', async () => {
    queryRelay.mockImplementation(relayOver([peekManifest, shipOnly, channel(FOLDER), state(FOLDER, [])]))
    const result = await applyActionAsViewer(
      { naddr: FOLDER_RECORD, actionId: 'add-project', value: { name: 'Launch' }, declaredBy: SHIP_MANIFEST },
      'https://relay.test',
      token,
    )

    expect(result).toMatchObject({ ok: true, listed: true })
    expect(published()).toEqual([String(PROJECT), `1852 add ${FOLDER}`])
    const [record] = signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; tags: string[][] })
    expect(tag(record, 'buzz-channel')).toBe(FOLDER)
    expect(tag(record, 'name')).toBe('Launch')
  })

  it('refuses without it — the Folder’s own manifest does not declare the action', async () => {
    queryRelay.mockImplementation(relayOver([peekManifest, shipOnly, channel(FOLDER), state(FOLDER, [])]))
    const result = await applyActionAsViewer({ naddr: FOLDER_RECORD, actionId: 'add-project', value: { name: 'Launch' } }, 'https://relay.test', token)

    expect(result.ok).toBe(false)
    expect(published()).toEqual([])
  })

  it('refuses a manifest nothing offered, rather than acting with it', async () => {
    queryRelay.mockImplementation(relayOver([peekManifest, shipOnly, channel(FOLDER), state(FOLDER, [])]))
    const result = await applyActionAsViewer(
      { naddr: FOLDER_RECORD, actionId: 'add-project', value: { name: 'Launch' }, declaredBy: `31990:${RELAY}:made-up` },
      'https://relay.test',
      token,
    )

    expect(result).toEqual({ ok: false, reason: 'That app no longer offers this action here.' })
    expect(published()).toEqual([])
  })
})
