/**
 * A pick on a card drawn from the copy on the device, at the wire (Miky,
 * 2026-10-16, kickoff of "A Ship issue's card drawn from the copy has its
 * controls at once"). After a reload the issue's card draws from the copy with
 * its status picker at once. A pick there is shown at once and sent only once
 * the relay has answered and the status is still what the card showed; if
 * somebody changed it meanwhile, the pick is undone with a note and nothing is
 * sent — the copy may be days old, and a pick sent from it would quietly undo
 * the newer change.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { ForeignObjectWidget } from '@/components/ui/ForeignObjectWidget'

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
const KATERINA = 'd4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const ISSUE = 30851
const D = '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const ADDRESS = `${ISSUE}:${SHIP}:${D}`
const NADDR = encodeNaddr({ kind: ISSUE, pubkey: SHIP, identifier: D, relays: [] })

/** Ship's issue as its manifest declares it: a status picker and an assignee picker, on `kind:1851` changes. */
const manifest = signed(
  {
    kind: 31990,
    tags: [['d', 'estiva-ship'], ['k', String(ISSUE)]],
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
const issue = signed({ kind: ISSUE, created_at: 1_700_000_000, tags: [['d', D], ['title', 'Card controls at once'], ['h', FOLDER]] }, SHIP)
/** Katerina marking it Done after the copy was kept. */
const katerinasDone = signed(
  { kind: 1851, created_at: 1_700_000_500, tags: [['a', ADDRESS], ['field', 'status'], ['value', 'done'], ['h', FOLDER]] },
  KATERINA,
)

let relay: WireRelay
/** Releases the relay's answers to reads; until then the card has only the copy. */
let answer: () => void
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(manifest, issue)
  kept.events = [manifest, issue]
  const wire = globalThis.fetch
  const answered = new Promise<void>((resolve) => (answer = resolve))
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith('/query')) await answered
    return wire(...args)
  })
})
afterAll(() => vi.unstubAllGlobals())

/** Open the status picker on the card and choose `label`. */
async function pickStatus(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('Change status'))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe("a pick on an issue's card drawn from the copy", () => {
  it('the card from the copy has its status and assignee pickers before the relay answers', async () => {
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('Card controls at once')).toBeInTheDocument()
    expect(screen.getByLabelText('Change status')).toHaveTextContent('Todo')
    expect(screen.getByLabelText('Assign')).toBeInTheDocument()
    answer()
  })

  it('a pick is shown at once and sent once the relay answers with the status the card showed', async () => {
    render(<ForeignObjectWidget naddr={NADDR} />)
    await screen.findByText('Card controls at once')

    await pickStatus('In progress')

    expect(screen.getByLabelText('Change status')).toHaveTextContent('In progress')
    expect(relay.sentOf(1851)).toEqual([])

    answer()
    await waitFor(() => expect(relay.sentOf(1851)).toHaveLength(1))
    const [change] = relay.sentOf(1851)
    expect(change.pubkey).toBe(ME)
    expect(tagOf(change, 'a')).toBe(ADDRESS)
    expect(tagOf(change, 'field')).toBe('status')
    expect(tagOf(change, 'value')).toBe('in_progress')
  })

  it('a pick on a status somebody changed meanwhile is undone with a note, and nothing is sent', async () => {
    relay.seed(katerinasDone)
    render(<ForeignObjectWidget naddr={NADDR} />)
    await screen.findByText('Card controls at once')

    await pickStatus('In progress')
    answer()

    expect(await screen.findByText('Not sent: changed meanwhile to Done.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Change status')).toHaveTextContent('Done'))
    expect(relay.sentOf(1851)).toEqual([])
  })
})
