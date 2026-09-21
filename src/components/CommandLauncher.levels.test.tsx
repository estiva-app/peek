/**
 * UIG-29 — what the launcher's rebuild changed, from Katerina's rulings.
 *
 * The keys themselves (arrows, Tab, Backspace, Ctrl+Enter, focus) are the
 * package's `CommandPalette` and are pinned there. What is Peek's, and pinned
 * here: which rows exist where, in which order, and where they lead — the
 * design's C2, C3, C4, R6, R12, R13 and the bugs F2 and F9.
 */
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider, type MessageHit } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import type { MessageSearchState } from '@/lib/launcherSearch'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'
import { resetRecentsForTests } from '@/lib/recents'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

Element.prototype.scrollIntoView = vi.fn()

const liveAddIssue: ResolvedAction = {
  id: 'add-issue',
  label: 'Add issue',
  description: 'File a new issue under a project.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  createsUnder: 'self',
}

const { creatableUnder, messageSearch, prefillAvailability } = vi.hoisted(() => ({
  // Ship declares Add issue; every other app declares nothing.
  creatableUnder: vi.fn(async (kind: number) =>
    kind === 30850 ? { actions: [liveAddIssue], parents: [{ address: `30850:${'b'.repeat(64)}:p1`, title: 'Projection layer' }] } : null,
  ),
  messageSearch: vi.fn<(query: string) => { state: MessageSearchState; hits: MessageHit[] }>(() => ({ state: { kind: 'idle' }, hits: [] })),
  prefillAvailability: vi.fn(async () => 'available' as const),
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useMessageSearch: messageSearch,
    useForeignObjects: () => ({ resolveObject: vi.fn(async () => null), applyAction: vi.fn(), creatableUnder }),
  }
})
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, prefillAvailability }
})

const inThread: LauncherContext = {
  composer: { label: 'Reply to Amie', isFocused: true, hasDraft: false },
  conversation: { references: [], messages: [{ id: 'r1', author: 'Amie', timestamp: '9:02 AM', body: 'the build broke' }] },
}

/** Where the launcher sent the page, and the message it asked the topic view to open at. */
function Probe() {
  const { pendingTopicMessage } = useLastSelection()
  return (
    <>
      <div data-testid="where">{useLocation().pathname}</div>
      <div data-testid="where-search">{useLocation().search}</div>
      <div data-testid="pending">{JSON.stringify(pendingTopicMessage)}</div>
    </>
  )
}

/** The page a topic view marks as open, the way TopicsPage does. */
function OnTopic({ id }: { id: string }) {
  const { setLastTopicId } = useLastSelection()
  useEffect(() => setLastTopicId(id), [id, setLastTopicId])
  return null
}

function open(context: LauncherContext = {}, props: { initialAppId?: string } = {}, route = '/desk') {
  render(
    <MemoryRouter initialEntries={[route]}>
      <DebugProvider>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <Probe />
              {route.startsWith('/topics/') && <OnTopic id={route.slice('/topics/'.length)} />}
              <CommandLauncher context={context} onClose={vi.fn()} {...props} />
            </ToastProvider>
          </LastSelectionProvider>
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

const field = () => document.querySelector<HTMLInputElement>('[data-command-palette-field]')!
const groupNames = () => screen.queryAllByRole('group').map((g) => g.firstElementChild?.textContent)

beforeEach(() => {
  window.localStorage.clear()
  resetRecentsForTests()
  creatableUnder.mockClear()
  messageSearch.mockClear()
  messageSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
})

describe('the first level, by what was typed', () => {
  it('puts Ask, Draft and Make first for a sentence, and last for a word (C2)', async () => {
    open(inThread)
    await userEvent.type(field(), 'pipeline')
    await waitFor(() => expect(groupNames().at(-1)).toBe('Ask'))
    expect(groupNames()[0]).toBe('Topics')

    await userEvent.clear(field())
    await userEvent.type(field(), 'pipeline stuck')
    await waitFor(() => expect(groupNames()[0]).toBe('Ask'))
  })

  it('puts an app whose name starts with the text first (R6)', async () => {
    open()
    await userEvent.type(field(), 'pe')
    await waitFor(() => expect(groupNames()[0]).toBe('Apps'))
    expect(within(screen.getByRole('group', { name: 'Apps' })).getByText('Peek')).toBeInTheDocument()
  })

  it('names an app without a count of actions it may not have (R12)', async () => {
    open()
    const apps = await screen.findByRole('group', { name: 'Apps' })
    expect(apps).not.toHaveTextContent(/actions/)
  })

  it('finds an app’s action by its name, and opens its form (C4)', async () => {
    open()
    await userEvent.type(field(), 'add')
    const row = await screen.findByRole('option', { name: /Add issue/ })
    expect(row).toHaveTextContent('Ship')
    await userEvent.click(row)
    expect(await screen.findByRole('button', { name: 'Leave Ship · Add issue' })).toBeInTheDocument()
  })
})

describe('recents (C3)', () => {
  beforeEach(() => {
    window.localStorage.setItem(
      'estiva-peek:recents',
      JSON.stringify([
        { kind: 'topic', id: '1' },
        { kind: 'person', id: 'amie' },
      ]),
    )
    resetRecentsForTests()
  })

  it('lists the topics and people opened last, before anything is typed', async () => {
    open()
    const recent = await screen.findByRole('group', { name: 'Recent' })
    expect(recent).toHaveTextContent('CI/CD pipeline stuck during build stage')
    expect(recent).toHaveTextContent('Amie Miles')
    expect(recent).toHaveTextContent('Clear recent')
  })

  it('leaves out the topic you are already in', async () => {
    open({}, {}, '/topics/1')
    const recent = await screen.findByRole('group', { name: 'Recent' })
    await waitFor(() => expect(recent).not.toHaveTextContent('CI/CD pipeline stuck during build stage'))
    expect(recent).toHaveTextContent('Amie Miles')
  })

  it('forgets the one you are on with Ctrl+Backspace', async () => {
    open()
    await screen.findByRole('group', { name: 'Recent' })
    await waitFor(() => expect(document.activeElement).toBe(field()))
    await userEvent.keyboard('{Control>}{Backspace}{/Control}')
    await waitFor(() => expect(screen.getByRole('group', { name: 'Recent' })).not.toHaveTextContent('CI/CD pipeline'))
    expect(JSON.parse(window.localStorage.getItem('estiva-peek:recents')!)).toEqual([{ kind: 'person', id: 'amie' }])
  })

  it('clears them all from the Clear recent row', async () => {
    open()
    await userEvent.click(await screen.findByRole('option', { name: /Clear recent/ }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument())
    expect(JSON.parse(window.localStorage.getItem('estiva-peek:recents')!)).toEqual([])
  })

  /*
    A file opened on its page is recent too (FOL-36) — a topic started since
    #194 is one — and shares the topic slots in the order things were opened.
    Its title is the stored one; it opens at `/topic/<slug>-<d>` (FOL-37); and, like a
    topic, the file you are on is not somewhere to go.
  */
  describe('a file (FOL-36)', () => {
    const FILE = '30840:' + 'c'.repeat(64) + ':0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
    beforeEach(() => {
      window.localStorage.setItem(
        'estiva-peek:recents',
        JSON.stringify([
          { kind: 'file', id: FILE, title: 'FOL-15 test topic 2' },
          { kind: 'topic', id: '1' },
        ]),
      )
      resetRecentsForTests()
    })

    it('is listed by its stored title, newest first, and opens on the file page', async () => {
      open()
      const recent = await screen.findByRole('group', { name: 'Recent' })
      const names = within(recent).getAllByRole('option').map((o) => o.textContent)
      expect(names[0]).toContain('FOL-15 test topic 2')
      expect(names[1]).toContain('CI/CD pipeline stuck during build stage')
      await userEvent.click(within(recent).getByRole('option', { name: /FOL-15 test topic 2/ }))
      // A bare file's link is its short form (FOL-37): the slug and the d.
      expect(screen.getByTestId('where')).toHaveTextContent('/topic/fol-15-test-topic-2-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
    })

    it('is left out when its page is the one you are on', async () => {
      open({}, {}, `/topic/${FILE}`)
      const recent = await screen.findByRole('group', { name: 'Recent' })
      await waitFor(() => expect(recent).toHaveTextContent('CI/CD pipeline stuck during build stage'))
      expect(recent).not.toHaveTextContent('FOL-15 test topic 2')
    })

    it('…and when that page is at its short form, whatever the slug says (FOL-37)', async () => {
      open({}, {}, '/topic/some-old-name-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
      const recent = await screen.findByRole('group', { name: 'Recent' })
      await waitFor(() => expect(recent).toHaveTextContent('CI/CD pipeline stuck during build stage'))
      expect(recent).not.toHaveTextContent('FOL-15 test topic 2')
    })
  })
})

describe('inside an app', () => {
  it('shows only that app’s actions, whichever app was visited before (F2)', async () => {
    open({}, { initialAppId: 'ship' })
    expect(await screen.findByRole('option', { name: /Add issue/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Leave Ship' }))
    await userEvent.type(field(), 'pe')
    await userEvent.keyboard('{Tab}')
    expect(await screen.findByText(/Peek has not published anything/)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Add issue/ })).not.toBeInTheDocument()
  })

  it('does not search messages there, where nobody would see them (F9)', async () => {
    open({}, { initialAppId: 'ship' })
    await userEvent.type(field(), 'add')
    expect(messageSearch.mock.calls.every(([query]) => query === '')).toBe(true)
  })
})

describe('a message result (R13)', () => {
  const FOLDER = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91' // topic 7's Folder in the mock data

  it('opens its topic at the message', async () => {
    messageSearch.mockImplementation((query) =>
      query ? { state: { kind: 'done', count: 1 }, hits: [{ id: 'e1', content: 'the office **layout** is done', pubkey: 'p', createdAt: 1_758_000_000, folder: FOLDER }] } : { state: { kind: 'idle' }, hits: [] },
    )
    open()
    await userEvent.type(field(), 'layout')
    // Words, never markdown.
    const row = await screen.findByRole('option', { name: /the office layout is done/ })
    await userEvent.click(row)
    expect(screen.getByTestId('where').textContent).toMatch(/^\/topic-old\//)
    expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({ folder: FOLDER, eventId: 'e1' })
  })

  it('opens the conversation a reply is in, and lands on the reply', async () => {
    messageSearch.mockImplementation((query) =>
      query ? { state: { kind: 'done', count: 1 }, hits: [{ id: 'e2', content: 'a reply about the layout', pubkey: 'p', createdAt: 1_758_000_000, folder: FOLDER, root: 'e1' }] } : { state: { kind: 'idle' }, hits: [] },
    )
    open()
    await userEvent.type(field(), 'layout')
    await userEvent.click(await screen.findByRole('option', { name: /a reply about the layout/ }))
    expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({ folder: FOLDER, eventId: 'e1', reply: 'e2' })
  })

  /*
    A comment on a file (FOL-36). Its `h` is the team's channel — a Folder no
    topic row carries, which used to make it "not in your sidebar" — and the
    file it is on is where it opens: the file's page, with the thread in the
    URL and the same one-shot for the scroll. The row says which file.
  */
  describe('a comment on a file', () => {
    const TEAM = '925897ad-796e-4bc6-999c-ca19df26c4aa'
    const FILE = '30840:' + 'c'.repeat(64) + ':0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'

    it('opens the file with the thread open, and lands on the comment', async () => {
      messageSearch.mockImplementation((query) =>
        query
          ? { state: { kind: 'done', count: 1 }, hits: [{ id: 'c1', content: 'a comment about the layout', pubkey: 'p', createdAt: 1_758_000_000, folder: TEAM, file: FILE, fileTitle: 'FOL-15 test topic 2' }] }
          : { state: { kind: 'idle' }, hits: [] },
      )
      open()
      await userEvent.type(field(), 'layout')
      const row = await screen.findByRole('option', { name: /a comment about the layout/ })
      expect(row).toHaveTextContent('FOL-15 test topic 2')
      await userEvent.click(row)
      expect(screen.getByTestId('where').textContent).toBe('/topic/fol-15-test-topic-2-0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f')
      expect(screen.getByTestId('where-search').textContent).toBe('?thread=c1')
      expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({ folder: TEAM, eventId: 'c1' })
      expect(screen.queryByText(/not in your sidebar/)).not.toBeInTheDocument()
    })

    it('a reply opens its thread and lands on the reply', async () => {
      messageSearch.mockImplementation((query) =>
        query
          ? { state: { kind: 'done', count: 1 }, hits: [{ id: 'c2', content: 'a reply about the layout', pubkey: 'p', createdAt: 1_758_000_000, folder: TEAM, file: FILE, root: 'c1' }] }
          : { state: { kind: 'idle' }, hits: [] },
      )
      open()
      await userEvent.type(field(), 'layout')
      await userEvent.click(await screen.findByRole('option', { name: /a reply about the layout/ }))
      expect(screen.getByTestId('where-search').textContent).toBe('?thread=c1')
      expect(JSON.parse(screen.getByTestId('pending').textContent!)).toEqual({ folder: TEAM, eventId: 'c1', reply: 'c2' })
    })
  })
})
