/**
 * INT-12 and INT-13 — Create topic, on Cmd+K's first level.
 *
 * A topic is a bare file in a Folder, and putting one there is the Folder's
 * built-in `create-file` (SPEC §3.2, interop 0.54.0), which no manifest
 * declares. Peek offers it as Create topic, with the people it is for (Miky,
 * kickoff 2026-10-12): they become members of the file (§11.8). And Peek's own
 * actions are on the first level, not behind Apps → Peek (INT-13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { FOLDER_ACTIONS_ADDRESS, type ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { registerTopicConversation, unregisterTopicConversation } from '@/lib/conversationRegistry'
import { CommandLauncher } from './CommandLauncher'

Element.prototype.scrollIntoView = vi.fn()

const RELAY = 'f'.repeat(64)
const ME = 'a'.repeat(64)
const QA_FOLDER = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const OTHER_FOLDER = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

const startConversation: ResolvedAction = {
  id: 'start-a-conversation',
  label: 'Start a conversation',
  description: 'Start a new conversation in a topic.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'message', type: 'string', required: true, target: 'content' }],
  createsUnder: 'self',
}

/** What interop 0.54.0 offers on every Folder. */
const createFile: ResolvedAction = {
  id: 'create-file',
  label: 'New file',
  description: 'Put a new file in this Folder.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  listed: true,
  declaredBy: { address: FOLDER_ACTIONS_ADDRESS, appName: 'Folder' },
}

const creatableUnder = vi.fn(async (parentKind: number) =>
  parentKind === 39000
    ? {
        actions: [startConversation, createFile],
        parents: [],
        manifest: `31990:${ME}:estiva-peek`,
        parentsFor: {
          'create-file': [
            { address: `39000:${RELAY}:${OTHER_FOLDER}`, title: 'Estiva HQ' },
            { address: `39000:${RELAY}:${QA_FOLDER}`, title: 'QA' },
          ],
        },
      }
    : null,
)

const CREATED = `30840:${ME}:new-topic`
// Typed by signature, so the assertions can read the calls without unused parameters.
const applyAction = vi.fn<(args: Record<string, unknown>) => Promise<{ ok: true; created: string }>>(async () => ({
  ok: true as const,
  created: CREATED,
}))
const reloadFoldersOnScreen = vi.fn(async () => {})
const setMember = vi.fn<(file: string, folder: string, member: boolean, person?: string) => Promise<true>>(async () => true)

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useForeignObjects: () => ({ resolveObject: vi.fn(), resolveFolderProject: vi.fn(), applyAction, creatableUnder }),
    useMembership: () => ({ setMember }),
    // Read when called, not when the hoisted mock is built.
    reloadFoldersOnScreen: () => reloadFoldersOnScreen(),
    usePeople: () => PEOPLE,
    useWorkspacePeople: () => PEOPLE,
  }
})

const PEOPLE = [
  { id: 'b'.repeat(64), name: 'QA-2' },
  { id: 'c'.repeat(64), name: 'Katerina' },
]

function open() {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <CommandLauncher context={{}} onClose={vi.fn()} />
            </ToastProvider>
          </LastSelectionProvider>
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  applyAction.mockClear()
  setMember.mockClear()
  creatableUnder.mockClear()
})
afterEach(() => unregisterTopicConversation())

describe('Peek’s actions are on the first level (INT-13)', () => {
  it('shows Start a conversation and Create topic before anything is typed, and Peek is not an app to go into', async () => {
    open()
    // "Actions", not "Peek": you are in Peek (Miky, INT-13's conversation).
    const peek = await screen.findByRole('group', { name: 'Actions' })
    expect(await within(peek).findByRole('option', { name: /Start a conversation/ })).toBeInTheDocument()
    expect(within(peek).getByRole('option', { name: /Create topic/ })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Apps' })).queryByText('Peek')).not.toBeInTheDocument()
  })
})

describe('Create topic (INT-12)', () => {
  it('opens on the Folder of the topic being read', async () => {
    registerTopicConversation({ references: [], messages: [], folder: QA_FOLDER })
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Create topic/ }))
    expect(await screen.findByLabelText(/folder/i)).toHaveTextContent('QA')
  })

  it('files the topic in the chosen Folder with the built-in, and adds its members after', async () => {
    registerTopicConversation({ references: [], messages: [], folder: QA_FOLDER })
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Create topic/ }))
    await userEvent.type(await screen.findByLabelText(/title/i), 'Pricing')
    await userEvent.type(screen.getByLabelText(/members/i), 'QA-2')
    await userEvent.click(await screen.findByRole('option', { name: /QA-2/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create topic' }))

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1))
    const args = applyAction.mock.calls[0][0]
    expect(args.actionId).toBe('create-file')
    expect(args.declaredBy).toBe(FOLDER_ACTIONS_ADDRESS)
    // The members are Peek's to write, never a tag on the file.
    expect(args.value).toEqual({ title: 'Pricing' })
    await waitFor(() => expect(setMember).toHaveBeenCalledWith(CREATED, QA_FOLDER, true, 'b'.repeat(64)))
  })

  it('reads the open Folders again once the topic exists, so the tree shows it', async () => {
    registerTopicConversation({ references: [], messages: [], folder: QA_FOLDER })
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Create topic/ }))
    await userEvent.type(await screen.findByLabelText(/title/i), 'Pricing')
    await userEvent.click(screen.getByRole('button', { name: 'Create topic' }))
    await waitFor(() => expect(reloadFoldersOnScreen).toHaveBeenCalled())
  })

  it('says so when there is no Folder to add to', async () => {
    creatableUnder.mockImplementationOnce(async () => ({
      actions: [startConversation, createFile],
      parents: [],
      manifest: `31990:${ME}:estiva-peek`,
      parentsFor: { 'create-file': [] },
    }))
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Create topic/ }))
    expect(await screen.findByText('No Folder you can add to yet')).toBeInTheDocument()
  })

  it('starts with no Folder outside one, and says the Folder is needed', async () => {
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Create topic/ }))
    await userEvent.type(await screen.findByLabelText(/title/i), 'Pricing')
    await userEvent.click(screen.getByRole('button', { name: 'Create topic' }))
    expect(applyAction).not.toHaveBeenCalled()
  })
})
