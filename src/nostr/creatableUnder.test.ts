/**
 * What the launcher can create on a Folder, read through the real interop
 * runtime over a relay that answers from a fixed world (REC-1, interop 0.58).
 *
 * A Folder and a chat message belong to no app (records
 * folders-belong-to-the-protocol, a-chat-message-belongs-to-the-protocol):
 * Start a conversation is the Folder's built-in, beside New file, and Peek's
 * manifest claim on `39000` and `9` is not read. Peek's picker still lists the
 * person's DMs beside their Folders (Miky, REC-1), from Peek's own chat code,
 * and Ship's record channels drop out of it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_ACTIONS_ADDRESS } from '@estiva-app/interop'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async (): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import { creatableUnderAsViewer, forgetUrlShapes } from './foreign'
import { manifestContent } from './manifest'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const THIRD = 'c'.repeat(64)
const RELAY = 'd'.repeat(64)
const PEEK_APP = 'e'.repeat(64)
const SHIP_APP = '8'.repeat(64)
const LEAF_APP = '9'.repeat(64)
const QA = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const RECORD = '5d1e8f9a-0000-4000-8000-000000000001'
const DM = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const GROUP_DM = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5c'
const URL = 'https://relay.test'
const token = { accessToken: 't', pubkey: ME } as never

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
  pubkey: RELAY,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

const web = (entity: string) => ['web', 'https://peek.estiva.app/o/<bech32>', entity]

/** Peek's listing as it is published until the republish: it still claims a Folder and a message. */
const peekClaiming = event({
  kind: 31990,
  pubkey: PEEK_APP,
  tags: [['d', 'estiva-peek'], ['k', '39000'], ['k', '9'], web('naddr'), web('nevent')],
  content: JSON.stringify(manifestContent()),
})
/** Peek's listing after it: the conversation aspect, its two links, and no claim. */
const peekUnclaimed = event({
  kind: 31990,
  pubkey: PEEK_APP,
  tags: [['d', 'estiva-peek'], web('naddr'), web('nevent')],
  content: JSON.stringify({ name: 'Peek', about: 'Conversations', aspect: 'conversation', fileNoun: 'topic', projections: {}, vocabularies: {} }),
})
const ship = event({
  kind: 31990,
  pubkey: SHIP_APP,
  tags: [['d', 'estiva-ship'], ['k', '30850']],
  content: JSON.stringify({
    name: 'Estiva Ship',
    projections: { 30850: { widget: 'card', slots: { title: { tag: 'name' } } } },
    actions: [
      {
        id: 'add-project',
        label: 'New project',
        description: 'Start a project in a Folder: a name, and the Folder lists it straight away.',
        effect: 'writes',
        appliesTo: '39000',
        emits: { kind: 30850, placement: 'buzz-channel', listed: true },
        input: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    ],
  }),
})
const leaf = event({
  kind: 31990,
  pubkey: LEAF_APP,
  tags: [['d', 'estiva-leaf'], ['k', '30842']],
  content: JSON.stringify({
    name: 'Leaf',
    projections: { 30842: { widget: 'card', slots: { title: { tag: 'title' } } } },
    actions: [
      {
        id: 'add-document',
        label: 'New document',
        description: 'Start a document in a Folder: a title, and the Folder lists it straight away.',
        effect: 'writes',
        appliesTo: '39000',
        emits: { kind: 30842, placement: 'h', listed: true },
        input: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      },
    ],
  }),
})

/** A Folder: its channel record and the relay-signed state that makes it one. */
const folder = [event({ kind: 39000, tags: [['d', QA], ['name', 'QA']] }), event({ kind: 30890, tags: [['d', QA]] })]
/** Ship's record channel: a channel, never a Folder — no state. */
const record = event({ kind: 39000, tags: [['d', RECORD], ['name', 'project-5d1e8f9a']] })
/** The relay names a DM "DM" and a group one by its size; newest first in the picker. */
const groupDm = event({ kind: 39000, tags: [['d', GROUP_DM], ['name', 'Group DM (3)'], ['t', 'dm'], ['p', ME], ['p', OTHER], ['p', THIRD]] })
const dm = event({ kind: 39000, tags: [['d', DM], ['name', 'DM'], ['t', 'dm'], ['p', ME], ['p', OTHER]] })
/** An archived DM is not somewhere to write. */
const archivedDm = event({
  kind: 39000,
  tags: [['d', '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5d'], ['name', 'Archived DM'], ['t', 'dm'], ['p', ME], ['p', THIRD], ['archived']],
})

const matches = (e: TestEvent, f: Record<string, unknown>) => {
  if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
  if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
  for (const [key, want] of Object.entries(f)) {
    if (!key.startsWith('#')) continue
    const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
    if (!(want as string[]).some((v) => held.includes(v))) return false
  }
  return true
}

/** A relay answering from `world`; `refuse` names a filter it answers with a refusal. */
function relayOver(world: TestEvent[], refuse?: (f: Record<string, unknown>) => boolean) {
  return async (_url: string, filters: Record<string, unknown>[]) =>
    refuse && filters.some(refuse)
      ? { ok: false as const, reason: 'rate-limited: slow down' }
      : { ok: true as const, events: world.filter((e) => filters.some((f) => matches(e, f))) }
}

const world = (peek: TestEvent) => [peek, ship, leaf, ...folder, record, groupDm, dm, archivedDm]
const titles = (list?: { title: string }[]) => list?.map((p) => p.title)

beforeEach(() => {
  forgetUrlShapes()
  queryRelay.mockReset()
})

describe.each([
  ['after Peek’s listing drops its claim', peekUnclaimed],
  ['while Peek’s listing still claims a Folder and a message', peekClaiming],
])('a Folder’s creations, %s', (_when, peek) => {
  it('offers Start a conversation as the Folder’s own, in Folders and then the person’s DMs, never a record channel', async () => {
    queryRelay.mockImplementation(relayOver(world(peek)))
    const read = await creatableUnderAsViewer(39000, URL, token)

    const conversation = read?.actions.find((a) => a.id === 'start-a-conversation')
    expect(conversation?.declaredBy?.address).toBe(FOLDER_ACTIONS_ADDRESS)
    expect(titles(read?.parentsFor?.['start-a-conversation'])).toEqual(['QA', 'DM', 'Group DM (3)'])
    expect(read?.dms).toEqual([`39000:${RELAY}:${DM}`, `39000:${RELAY}:${GROUP_DM}`])
  })

  it('offers each creation once — Ship’s New project and Leaf’s New document beside the Folder’s two — each into Folders only', async () => {
    queryRelay.mockImplementation(relayOver(world(peek)))
    const read = await creatableUnderAsViewer(39000, URL, token)

    // The apps' own in the order the relay answered their listings (newest first); the Folder's first.
    expect(read?.actions.map((a) => [a.id, a.declaredBy?.address])).toEqual([
      ['create-file', FOLDER_ACTIONS_ADDRESS],
      ['start-a-conversation', FOLDER_ACTIONS_ADDRESS],
      ['add-document', `31990:${LEAF_APP}:estiva-leaf`],
      ['add-project', `31990:${SHIP_APP}:estiva-ship`],
    ])
    for (const id of ['create-file', 'add-project', 'add-document']) expect(titles(read?.parentsFor?.[id])).toEqual(['QA'])
  })
})

describe('when the relay refuses the Folder listing', () => {
  const listing = (f: Record<string, unknown>) => (f.kinds as number[] | undefined)?.includes(30890) === true && !f['#d']

  it('keeps Start a conversation, in the person’s DMs, and drops what needs a Folder', async () => {
    queryRelay.mockImplementation(relayOver(world(peekUnclaimed), listing))
    const read = await creatableUnderAsViewer(39000, URL, token)

    expect(read?.actions.map((a) => a.id)).toEqual(['start-a-conversation'])
    expect(titles(read?.parentsFor?.['start-a-conversation'])).toEqual(['DM', 'Group DM (3)'])
  })

  it('offers nothing when there is no DM either, rather than a picker with nowhere to go', async () => {
    queryRelay.mockImplementation(relayOver([peekUnclaimed, ship, leaf, ...folder, record], listing))
    const read = await creatableUnderAsViewer(39000, URL, token)

    expect(read?.actions ?? []).toEqual([])
  })
})
