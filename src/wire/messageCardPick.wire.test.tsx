/**
 * A pick on a file's card under a message, at the wire, as in Leaf and Ship
 * (WBD-10, 5ebf2756). A card changes a status or an owner and nothing else
 * (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md).
 * The pick shows at once and stays while it is written and read back; an
 * issue whose project is archived is read-only, so a pick on it sends nothing
 * and says why.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { MessageCard } from '@/components/ui/MessageLinks'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

/** What the copy on the device holds: set per test, answered as the relay would answer it. */
const kept: { events: SignedEvent[] } = { events: [] }
vi.mock('@/nostr/readFrom', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/nostr/readFrom')>()
  const matches = (filter: Record<string, unknown>, event: SignedEvent) =>
    (!Array.isArray(filter.kinds) || filter.kinds.includes(event.kind)) &&
    (!Array.isArray(filter.authors) || filter.authors.includes(event.pubkey)) &&
    (!Array.isArray(filter.ids) || filter.ids.includes(event.id)) &&
    Object.entries(filter).every(
      ([key, want]) => !key.startsWith('#') || !Array.isArray(want) || event.tags.some((t) => t[0] === key.slice(1) && want.includes(t[1])),
    )
  return {
    ...original,
    readFrom: async (...args: Parameters<typeof original.readFrom>) => {
      const [source, , filters] = args
      if (source !== 'copy') return original.readFrom(...args)
      return { ok: true, events: kept.events.filter((event) => filters.some((filter) => matches(filter, event))) }
    },
  }
})

const SHIP = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const ISSUE = 30851
const PROJECT = 30850
const D = '2b9e4c1a-7d3f-4e5a-9b6c-0d1e2f3a4b5c'
const ADDRESS = `${ISSUE}:${SHIP}:${D}`
const PROJECT_ADDRESS = `${PROJECT}:${SHIP}:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f`
const NADDR = encodeNaddr({ kind: ISSUE, pubkey: SHIP, identifier: D, relays: [] })

/** Ship's project and issue as its manifest declares them: an issue moves between projects by `project`, and has a status picker. */
const manifest = signed(
  {
    kind: 31990,
    tags: [['d', 'estiva-ship'], ['k', String(PROJECT)], ['k', String(ISSUE)]],
    content: JSON.stringify({
      name: 'Ship',
      records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
      vocabularies: {
        issueStatuses: [
          { value: 'todo', label: 'Todo' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'done', label: 'Done' },
        ],
      },
      projections: {
        [PROJECT]: {
          widget: 'card',
          noun: 'project',
          slots: { title: { fold: 'name', tag: 'name' }, list: { children: { kind: ISSUE, via: 'a', limit: 200, movedBy: 'project' } } },
        },
        [ISSUE]: { widget: 'row', noun: 'issue', slots: { title: { fold: 'title', tag: 'title' }, status: { fold: 'status', map: 'issueStatuses', default: 'todo' } } },
      },
      actions: [
        { id: 'set-issue-status', label: 'Change status', appliesTo: String(ISSUE), emits: { kind: 1851, field: 'status' }, input: { type: 'string', enum: 'issueStatuses' } },
        { id: 'assign-issue', label: 'Assign', appliesTo: String(ISSUE), emits: { kind: 1851, field: 'assignee' }, input: { type: 'pubkey' } },
      ],
    }),
  },
  SHIP,
)
const project = signed({ kind: PROJECT, created_at: 1_700_000_000, tags: [['d', PROJECT_ADDRESS.split(':')[2]], ['name', 'Widgets 2'], ['h', FOLDER]] }, SHIP)
const issue = signed({ kind: ISSUE, created_at: 1_700_000_100, tags: [['d', D], ['title', 'A card holds its pick'], ['a', PROJECT_ADDRESS], ['h', FOLDER]] }, SHIP)
/** The project archived after the copy was kept: its issues are archived with it (FOL-46). */
const projectArchived = signed(
  { kind: 1851, created_at: 1_700_000_500, tags: [['a', PROJECT_ADDRESS], ['field', 'archived'], ['value', 'true'], ['h', FOLDER]] },
  SHIP,
)

let relay: WireRelay
/** Releases the relay's answers to reads; until then the card has only the copy. */
let answerReads: () => void
/** Releases the relay's answer to a publish. */
let answerWrites: () => void
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(manifest, project, issue)
  kept.events = []
  const wire = globalThis.fetch
  const reads = new Promise<void>((resolve) => (answerReads = resolve))
  const writes = new Promise<void>((resolve) => (answerWrites = resolve))
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith('/query')) await reads
    if (String(args[0]).endsWith('/events')) await writes
    return wire(...args)
  })
})
afterAll(() => vi.unstubAllGlobals())

/** Open the status picker on the card and choose `label`. */
async function pickStatus(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Status'))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe("a pick on an issue's card under a message", () => {
  it('shows the pick while it is written and read back, not the old status', async () => {
    answerReads()
    render(<MessageCard uri={`nostr:${NADDR}`} />)
    await screen.findByText('A card holds its pick')

    await pickStatus('In progress')

    // Sent, and the relay has not answered: the card still shows what was picked.
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('In progress'))
    answerWrites()
    await waitFor(() => expect(relay.sentOf(1851)).toHaveLength(1))
    const [change] = relay.sentOf(1851)
    expect(change.pubkey).toBe(ME)
    expect(tagOf(change, 'a')).toBe(ADDRESS)
    expect(tagOf(change, 'value')).toBe('in_progress')
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveTextContent('In progress'))
  })

  it('sends nothing for an issue whose project was archived after the copy was kept, and says why', async () => {
    // Its own issue: the tab holds what it read about the first one's project (OPT-5).
    const d = '3c0f5d2b-8e4a-4f6b-8c7d-1e2f3a4b5c6d'
    const another = signed({ kind: ISSUE, created_at: 1_700_000_100, tags: [['d', d], ['title', 'Its project is archived'], ['a', PROJECT_ADDRESS], ['h', FOLDER]] }, SHIP)
    relay.seed(another, projectArchived)
    kept.events = [manifest, project, another]
    answerWrites()
    render(<MessageCard uri={`nostr:${encodeNaddr({ kind: ISSUE, pubkey: SHIP, identifier: d, relays: [] })}`} />)
    await screen.findByText('Its project is archived')

    await pickStatus('In progress')
    answerReads()

    expect(await screen.findByText('This can’t be changed from here.')).toBeInTheDocument()
    expect(relay.sentOf(1851)).toEqual([])
    // Read once for the card, its project's archive turns the pickers into words.
    await waitFor(() => expect(screen.queryByLabelText('Status')).not.toBeInTheDocument())
    expect(screen.getByText('Todo')).toBeInTheDocument()
  })
})
