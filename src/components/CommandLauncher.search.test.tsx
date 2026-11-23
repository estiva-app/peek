/**
 * PEE-4 — Cmd+K finds things, driven from the outside.
 *
 * `launcherSearch.test.ts` proves the matching and the wording. This proves the
 * launcher actually renders them: that typing part of a person's name surfaces
 * a row, and that the message section says which of the two silences it is in.
 * The topic search went with the Convex topics (FOL-23).
 *
 * People come from the mock dataset here, which is the real code
 * path — the test env has no `VITE_RELAY_URL`, so `hasRelay` is false and
 * the seam answers from `src/data`. Message search is the one thing that
 * cannot work in mock mode (there is no relay to ask), so its states are
 * injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { referenceOfValue } from '@/lib/embedValue'
import { enter } from '@/test-enter'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { MessageSearchState } from '@/lib/launcherSearch'
import { fileReference, type ReferenceCandidate } from '@estiva-app/conversation'
import { rememberRecent, resetRecentsForTests } from '@/lib/recents'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

/*
  `vi.hoisted`, because `vi.mock` is hoisted above every top-level const and
  the launcher imports the seam at module scope.
*/
const { messageSearch, fileSearch } = vi.hoisted(() => ({
  messageSearch: vi.fn<() => { state: MessageSearchState; hits: never[] }>(() => ({
    state: { kind: 'idle' },
    hits: [],
  })),
  fileSearch: vi.fn<() => { state: MessageSearchState; hits: ReferenceCandidate[] }>(() => ({
    state: { kind: 'idle' },
    hits: [],
  })),
}))

/* The one file a lit row's card reads, by the reference it is asked with (KIN-3). */
const held = vi.hoisted(() => ({ asked: [] as string[], objects: new Map<string, unknown>() }))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useMessageSearch: messageSearch,
    useFileSearch: fileSearch,
    useHeldObject: (reference: string | null) => {
      if (reference) held.asked.push(reference)
      return { object: (reference && held.objects.get(reference)) ?? 'loading', reload: async () => {}, gone: false }
    },
  }
})

Element.prototype.scrollIntoView = vi.fn()

/** Renders the current path, so a navigation is observable. */
function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function open(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>

        <LastSelectionProvider>

        <ToastProvider>
          <Where />
          <CommandLauncher context={{}} onClose={onClose} />
        </ToastProvider>

        </LastSelectionProvider>

        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return { onClose }
}

async function type(text: string) {
  // The launcher autofocuses its single input.
  await enter(document.querySelector<HTMLInputElement>('[data-command-palette-field]')!, text)
}

describe('Cmd+K finds a person by typing part of them (PEE-4)', () => {
  beforeEach(() => {
    messageSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
  })

  it('finds a person by name, and by role', async () => {
    open()
    await type('designer')

    expect(await screen.findByText('People')).toBeInTheDocument()
    // "Product Designer" is where the word actually appears — a name-only
    // matcher would find nobody for the thing people search by.
    expect(screen.getByText('Alice Johnson')).toBeInTheDocument()
  })

  it('finds a person by the start of a word, never by its middle (SPEC §5.2)', async () => {
    open()
    await type('desi john')
    expect(await screen.findByText('Alice Johnson')).toBeInTheDocument()

    await type('ohnson')
    await waitFor(() => expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument())
  })

  it('shows no sections at all before anything is typed', async () => {
    open()
    expect(screen.queryByText('People')).not.toBeInTheDocument()
    // The apps are still listed — that is the launcher's resting state.
    expect(await screen.findByText('Apps')).toBeInTheDocument()
  })

})

describe('the message section says which silence it is in (PEE-4)', () => {
  it('says plainly that a fragment matched nothing, with nothing about whole words', async () => {
    /*
      The relay matches every word as a word start now (SPEC §5.2), so "pipe"
      finding nothing is a true statement about the workspace, and the old
      "needs a whole word" hint would be a wrong one.
    */
    messageSearch.mockReturnValue({ state: { kind: 'done', count: 0 }, hits: [] })
    open()
    await type('pipe')

    expect(await screen.findByText('No messages matched.')).toBeInTheDocument()
    expect(screen.queryByText(/whole word/i)).not.toBeInTheDocument()
  })

  it('says "nothing you can read" for a membership refusal', async () => {
    messageSearch.mockReturnValue({ state: { kind: 'failed', failure: 'not_a_member' }, hits: [] })
    open()
    await type('pipeline')

    expect(await screen.findByText(/not yours to see/i)).toBeInTheDocument()
    // And never the other sentence: telling somebody nothing matched when the
    // truth is they cannot see it is the ambiguity this ticket exists to end.
    expect(screen.queryByText('No messages matched.')).not.toBeInTheDocument()
  })

  it('says the list is incomplete when the relay refused', async () => {
    messageSearch.mockReturnValue({ state: { kind: 'failed', failure: 'refused' }, hits: [] })
    open()
    await type('pipeline')

    expect(await screen.findByText(/refused the search/i)).toBeInTheDocument()
  })

  it('does not claim an empty corpus when there was no token to ask with', async () => {
    messageSearch.mockReturnValue({ state: { kind: 'signed-out' }, hits: [] })
    open()
    await type('pipeline')

    expect(await screen.findByText(/sign in to search messages/i)).toBeInTheDocument()
  })

  it('reports hits it cannot route rather than dropping them silently', async () => {
    /*
      A message names its Folder on `h`, and a Topic carries the same uuid as
      `folderId`. A hit in a channel with no topic row has nowhere to go, so
      it is not rendered as a row that cannot succeed — but the count is shown,
      because a silent cap reads as "that is all there was".
    */
    messageSearch.mockReturnValue({
      state: { kind: 'done', count: 2 },
      hits: [
        { id: 'a', content: 'pipeline talk', pubkey: 'x'.repeat(64), createdAt: 1, folder: 'unknown-1' },
        { id: 'b', content: 'more pipeline', pubkey: 'x'.repeat(64), createdAt: 2, folder: 'unknown-2' },
      ] as never,
    })
    open()
    await type('pipeline')

    expect(await screen.findByText(/2 more in conversations not in your sidebar/i)).toBeInTheDocument()
  })
})

const AUTHOR = 'b'.repeat(64)
const SUMMARY = 'Match the ledger against the bank export every Friday'
const fileHit = (d: string, kind: number, title: string, caption: string, summary?: string): ReferenceCandidate => ({
  id: `${kind}:${AUTHOR}:${d}`,
  uri: fileReference(`${kind}:${AUTHOR}:${d}`),
  type: kind === 30851 ? 'issue' : 'document',
  kind,
  title,
  caption,
  summary,
  tier: 2,
})
const optionNamed = (title: string) => screen.getAllByRole('option').find((o) => o.textContent?.includes(title))!

describe('Cmd+K finds a file by its title, with its summary (SUM-7)', () => {
  beforeEach(() => {
    messageSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
  })

  it('draws a hit’s summary as its second line and an issue’s project beside the title; no summary, an issue keeps its project and a page its title alone', async () => {
    fileSearch.mockReturnValue({
      state: { kind: 'done', count: 3 },
      hits: [
        fileHit('a', 30851, 'Ledger reconciliation', 'Finance', SUMMARY),
        fileHit('b', 30851, 'Ledger archive', 'Finance'),
        fileHit('c', 30842, 'Ledger notes', ''),
      ],
    })
    open()
    await type('ledger')

    expect(await screen.findByText('Files')).toBeInTheDocument()
    expect(optionNamed('Ledger reconciliation').textContent).toContain(SUMMARY)
    expect(optionNamed('Ledger reconciliation').textContent).toContain('Finance')
    expect(optionNamed('Ledger archive').textContent).toContain('Finance')
    expect(optionNamed('Ledger notes').textContent).not.toContain('Finance')
    expect(optionNamed('Ledger notes').textContent).not.toContain(SUMMARY)
  })

  it('keeps up to three files under a prompt, and only those whose title holds every word (a77dd5e3)', async () => {
    // A name of three words still finds its file; a file that only mentions the words in its summary is not an answer to a sentence.
    fileSearch.mockReturnValue({
      state: { kind: 'done', count: 5 },
      hits: [
        fileHit('a', 30851, 'Ledger reconciliation plan', 'Finance'),
        fileHit('b', 30851, 'Ledger reconciliation plan B', 'Finance'),
        fileHit('s', 30842, 'Quarter close', '', 'The ledger reconciliation plan is in here.'),
        fileHit('c', 30842, 'Ledger reconciliation plan notes', ''),
        fileHit('d', 30842, 'Old ledger reconciliation plan', ''),
      ],
    })
    open()
    await type('ledger reconciliation plan')

    await waitFor(() => expect(screen.getByRole('group', { name: 'Files' })).toBeInTheDocument())
    const listed = within(screen.getByRole('group', { name: 'Files' })).getAllByRole('option').map((o) => o.textContent)
    expect(listed).toHaveLength(3)
    expect(listed[0]).toContain('Ledger reconciliation plan')
    expect(listed.join(' ')).not.toContain('Quarter close')
    expect(listed.join(' ')).not.toContain('Old ledger')

    fireEvent.click(optionNamed('Ledger reconciliation plan'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`30851:${AUTHOR}:a`))
  })

  it('opens the file a hit names', async () => {
    fileSearch.mockReturnValue({ state: { kind: 'done', count: 1 }, hits: [fileHit('a', 30851, 'Ledger reconciliation', 'Finance', SUMMARY)] })
    open()
    await type('ledger')
    fireEvent.click(optionNamed('Ledger reconciliation'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`30851:${AUTHOR}:a`))
  })

  it('says files are missing when the relay was too busy to search them', async () => {
    fileSearch.mockReturnValue({ state: { kind: 'failed', failure: 'rate_limited' }, hits: [] })
    open()
    await type('ledger')
    expect(await screen.findByText(/files are not included/i)).toBeInTheDocument()
  })

  it('says a relay that failed both searches once, not once per section', async () => {
    messageSearch.mockReturnValue({ state: { kind: 'failed', failure: 'refused' }, hits: [] })
    fileSearch.mockReturnValue({ state: { kind: 'failed', failure: 'refused' }, hits: [] })
    open()
    await type('ledger')
    expect(await screen.findByText(/refused the search/i)).toBeInTheDocument()
    expect(screen.queryByText(/files are not included/i)).toBeNull()
  })
})

describe('Recent shows a file’s summary before anything is typed (SUM-7)', () => {
  beforeEach(() => {
    fileSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
    window.localStorage.setItem(
      'estiva-peek:recents',
      JSON.stringify([
        { kind: 'file', id: `30851:${AUTHOR}:a`, title: 'Ledger reconciliation', summary: SUMMARY, caption: 'Finance' },
        { kind: 'file', id: `30851:${AUTHOR}:b`, title: 'Ledger archive', caption: 'Finance' },
        { kind: 'file', id: `30842:${AUTHOR}:c`, title: 'Ledger notes' },
      ]),
    )
    resetRecentsForTests()
  })

  it('a file with a summary shows it, with an issue’s project; without one, an issue keeps its project, as under Files, and a page its title alone', async () => {
    open()
    expect(await screen.findByText('Recent')).toBeInTheDocument()
    expect(optionNamed('Ledger reconciliation').textContent).toContain(SUMMARY)
    expect(optionNamed('Ledger reconciliation').textContent).toContain('Finance')
    expect(optionNamed('Ledger archive').textContent).toContain('Finance')
    expect(optionNamed('Ledger notes').textContent).not.toContain('Finance')
  })
})

describe('Cmd+K shows a lit file’s card beside the box (KIN-3)', () => {
  const pane = () => document.querySelector('[data-command-palette-preview]')
  const reference = (address: string) => referenceOfValue(address)!.replace(/^nostr:/, '')
  const page = (d: string, title: string, summary: string) => {
    const address = `30842:${AUTHOR}:${d}`
    return {
      ref: address,
      address,
      naddr: reference(address),
      eventId: d.padEnd(64, 'e'),
      kind: 30842,
      widget: 'card',
      appName: 'Leaf',
      noun: 'Page',
      openUrl: `https://leaf.estiva.app/document/${d}`,
      slots: { title: { value: title }, subtitle: { value: summary } },
      meta: [],
      comments: [],
      actions: [],
      viaRecommendation: false,
    }
  }

  beforeEach(() => {
    messageSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
    held.asked = []
    held.objects.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('draws the lit page’s card, its title and summary, once the row has stayed lit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const notes = page('c', 'Ledger notes', SUMMARY)
    held.objects.set(notes.naddr, notes)
    fileSearch.mockReturnValue({ state: { kind: 'done', count: 1 }, hits: [fileHit('c', 30842, 'Ledger notes', '')] })
    open()
    await type('ledger')
    await screen.findByText('Files')
    expect(pane()).toBeNull()
    await act(async () => void vi.advanceTimersByTime(300))
    expect(pane()?.textContent).toContain('Ledger notes')
    expect(pane()?.textContent).toContain(SUMMARY)
    expect(held.asked).toContain(notes.naddr)
  })

  it('closes the box when a link on the card is clicked, as choosing the row does', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const notes = page('c', 'Ledger notes', SUMMARY)
    held.objects.set(notes.naddr, notes)
    fileSearch.mockReturnValue({ state: { kind: 'done', count: 1 }, hits: [fileHit('c', 30842, 'Ledger notes', '')] })
    const { onClose } = open()
    await type('ledger')
    await screen.findByText('Files')
    await act(async () => void vi.advanceTimersByTime(300))
    const link = pane()?.querySelector('a')
    expect(link?.textContent).toContain('Ledger notes')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(link!)
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the card of a lit file in Recent, before anything is typed (Miky, 23 Nov)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetRecentsForTests()
    const notes = page('r', 'Quarter notes', SUMMARY)
    held.objects.set(notes.naddr, notes)
    rememberRecent({ kind: 'file', id: notes.address, title: 'Quarter notes' })
    fileSearch.mockReturnValue({ state: { kind: 'idle' }, hits: [] })
    open()
    await screen.findByText('Quarter notes')
    const field = document.querySelector<HTMLInputElement>('[data-command-palette-field]')!
    for (let i = 0; i < 12 && !document.querySelector('[role="option"][data-highlighted]')?.textContent?.includes('Quarter notes'); i++) {
      fireEvent.keyDown(field, { key: 'ArrowDown' })
    }
    await act(async () => void vi.advanceTimersByTime(300))
    expect(document.querySelector('[role="option"][data-highlighted]')?.textContent).toContain('Quarter notes')
    expect(pane()?.textContent).toContain(SUMMARY)
  })

  it('reads and draws nothing for a lit topic, nor for a file the arrows only passed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fileSearch.mockReturnValue({
      state: { kind: 'done', count: 3 },
      hits: [fileHit('t', 30840, 'Ledger room', ''), fileHit('p', 30842, 'Ledger plan', ''), fileHit('q', 30842, 'Ledger quarter', '')],
    })
    open()
    await type('ledger')
    await screen.findByText('Files')
    await act(async () => void vi.advanceTimersByTime(300))
    expect(document.querySelector('[role="option"][data-highlighted]')?.textContent).toContain('Ledger room')
    expect(pane()).toBeNull()
    const field = document.querySelector<HTMLInputElement>('[data-command-palette-field]')!
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    await act(async () => void vi.advanceTimersByTime(300))
    expect(document.querySelector('[role="option"][data-highlighted]')?.textContent).toContain('Ledger quarter')
    expect(held.asked).toEqual(expect.not.arrayContaining([reference(`30840:${AUTHOR}:t`), reference(`30842:${AUTHOR}:p`)]))
    expect(held.asked).toContain(reference(`30842:${AUTHOR}:q`))
  })
})
