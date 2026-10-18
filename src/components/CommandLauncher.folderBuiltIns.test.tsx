/**
 * The launcher over the real interop runtime, with Peek's listing as it will
 * be once republished: the conversation aspect and its two links, and no claim
 * on a Folder (`39000`) or a chat message (`9`) — REC-1, interop 0.58.
 *
 * Only the relay and Estiva ID's signing are faked (the bridge's three calls).
 * Every read and every event to sign goes through `creatableUnderAsViewer`,
 * `applyActionAsViewer` and Peek's chat code, so what is asserted is the event
 * that would reach the relay: its kind, tags, content and signer, and that the
 * one signed is the one published.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

Element.prototype.scrollIntoView = vi.fn()

const { queryRelay, publishSigned, signViaEstivaId, viewer } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async (): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  signViaEstivaId: vi.fn(async (event: unknown) => ({ ...(event as object), id: 'f'.repeat(64), sig: '' })),
  viewer: { relayUrl: 'https://relay.test', token: { accessToken: 't', pubkey: 'a'.repeat(64) } as never },
}))

vi.mock('@/nostr/bridge', async () => {
  const actual = await vi.importActual<typeof import('@/nostr/bridge')>('@/nostr/bridge')
  return { ...actual, queryRelay, publishSigned, signViaEstivaId }
})

/* The seam's own wiring, signed in as `viewer`: the launcher's reads and writes, unchanged below it. */
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  const foreign = await vi.importActual<typeof import('@/nostr/foreign')>('@/nostr/foreign')
  const chat = await vi.importActual<typeof import('@/nostr/fileConversation')>('@/nostr/fileConversation')
  return {
    ...actual,
    useForeignObjects: () => ({
      resolveObject: vi.fn(async () => null),
      resolveFolderProject: vi.fn(),
      creatableUnder: (kind: number) => foreign.creatableUnderAsViewer(kind, viewer.relayUrl, viewer.token),
      applyAction: (args: Parameters<typeof foreign.applyActionAsViewer>[0]) =>
        foreign.applyActionAsViewer(args, viewer.relayUrl, viewer.token),
      startConversationInDm: (args: { channel: string; body: string }) =>
        chat.commentAsViewer({ container: { kind: 'channel', h: args.channel }, body: args.body }, viewer.relayUrl, viewer.token),
    }),
  }
})

import { forgetUrlShapes } from '@/nostr/foreign'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const RELAY = 'd'.repeat(64)
const QA = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const RECORD = '5d1e8f9a-0000-4000-8000-000000000001'
const DM = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

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
const WORLD: TestEvent[] = [
  // Peek, republished: what it does for every file, and no kind of its own.
  event({
    kind: 31990,
    pubkey: 'e'.repeat(64),
    tags: [['d', 'estiva-peek'], web('naddr'), web('nevent')],
    content: JSON.stringify({ name: 'Peek', about: 'Conversations', aspect: 'conversation', fileNoun: 'topic', projections: {}, vocabularies: {} }),
  }),
  event({
    kind: 31990,
    pubkey: '8'.repeat(64),
    tags: [['d', 'estiva-ship'], ['k', '30850'], ['k', '30851']],
    content: JSON.stringify({
      name: 'Estiva Ship',
      projections: {
        30850: { widget: 'card', slots: { title: { tag: 'name' } } },
        30851: { widget: 'row', slots: { title: { tag: 'title' } } },
      },
      actions: [
        {
          id: 'add-issue',
          label: 'Add issue',
          description: 'File a new issue under a project: a title, and the project lists it.',
          effect: 'writes',
          appliesTo: '30850',
          emits: { kind: 30851, toAddressOf: 'self', setTag: 'a' },
          input: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
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
  }),
  // A Ship project, without which Ship's section has nothing of its own to read.
  event({ kind: 30850, pubkey: '8'.repeat(64), tags: [['d', 'p1'], ['name', 'Launch'], ['buzz-channel', QA]] }),
  event({ kind: 39000, tags: [['d', QA], ['name', 'QA']] }),
  event({ kind: 30890, tags: [['d', QA]] }),
  event({ kind: 39000, tags: [['d', RECORD], ['name', 'project-5d1e8f9a']] }),
  event({ kind: 39000, tags: [['d', DM], ['name', 'DM'], ['t', 'dm'], ['p', ME], ['p', OTHER]] }),
  // The other person's profile, which names the DM in the picker as on People (REC-1).
  event({ kind: 0, pubkey: OTHER, content: JSON.stringify({ display_name: 'Bob Ellis' }) }),
]

function relayOver(world: TestEvent[]) {
  return async (_url: string, filters: Record<string, unknown>[]) => ({
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
  })
}

const onClose = vi.fn()
function open(initialAppId?: string) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <CommandLauncher context={{}} onClose={onClose} initialAppId={initialAppId} />
            </ToastProvider>
          </LastSelectionProvider>
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

/** What was signed, as the relay would receive it. */
const signed = () => signViaEstivaId.mock.calls.map(([e]) => e as { kind: number; pubkey: string; tags: string[][]; content: string })
/** The ids of what was published: each must be the one signed. */
const published = () => publishSigned.mock.calls.map((call) => ((call as unknown[])[1] as { id?: string } | undefined)?.id)

async function startConversation(where: string, text: string) {
  open()
  const actions = await screen.findByRole('group', { name: 'Actions' })
  await userEvent.click(await within(actions).findByRole('option', { name: /Start a conversation/ }))
  await userEvent.type(await screen.findByLabelText(/message/i), text)
  await userEvent.click(screen.getByRole('combobox'))
  const options = (await screen.findAllByRole('option')).map((o) => o.textContent)
  expect(options).toContain(where)
  await userEvent.click(await screen.findByRole('option', { name: where }))
  await userEvent.click(screen.getByRole('button', { name: 'Start a conversation' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
}

beforeEach(() => {
  forgetUrlShapes()
  queryRelay.mockReset()
  queryRelay.mockImplementation(relayOver(WORLD))
  signViaEstivaId.mockClear()
  publishSigned.mockClear()
  onClose.mockClear()
})

describe('the launcher, with Peek’s listing claiming no Folder and no message', () => {
  it('offers Start a conversation and Create topic once each, and only the DM — named after the person — to start one in, never a Folder nor a record channel', async () => {
    open()
    const actions = await screen.findByRole('group', { name: 'Actions' })
    expect(await within(actions).findAllByRole('option', { name: /Start a conversation/ })).toHaveLength(1)
    expect(within(actions).getAllByRole('option', { name: /Create topic/ })).toHaveLength(1)

    await userEvent.click(within(actions).getByRole('option', { name: /Start a conversation/ }))
    await userEvent.click(await screen.findByRole('combobox'))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Bob Ellis'])
    // Called what it was called while Peek declared it: its picker holds DMs, which are no Folder.
    expect(screen.getByRole('combobox', { name: /topic/i })).toBeInTheDocument()
  })

  it('does not offer Start a conversation to a person with no DM, and still offers Create topic', async () => {
    queryRelay.mockImplementation(relayOver(WORLD.filter((e) => !e.tags.some((t) => t[0] === 't' && t[1] === 'dm'))))
    open()
    const actions = await screen.findByRole('group', { name: 'Actions' })
    expect(await within(actions).findByRole('option', { name: /Create topic/ })).toBeInTheDocument()
    expect(within(actions).queryByRole('option', { name: /Start a conversation/ })).not.toBeInTheDocument()
  })

  it('starts a conversation in a DM there, as the DM’s own message', async () => {
    await startConversation('Bob Ellis', 'Lunch at one?')

    const [message] = signed()
    expect(signed()).toHaveLength(1)
    expect(message.kind).toBe(9)
    expect(message.tags.filter((t) => t[0] === 'h')).toEqual([['h', DM]])
    expect(message.content).toBe('Lunch at one?')
    expect(message.pubkey).toBe(ME)
    expect(published()).toEqual(['f'.repeat(64)])
  })

  it('still offers Ship’s New project on a Folder, in Ship’s section', async () => {
    open('ship')
    expect(await screen.findByText('New project')).toBeInTheDocument()
  })
})
