/**
 * Escape keeps the sentence and the answer, and the search shows a dot while
 * it works (KIN-2, "In Peek's ⌘K, Escape keeps your sentence and the answer,
 * and the search shows a dot while it works").
 *
 * The real launcher, held the way the frame holds it (`useKeptLauncher`), under
 * the kit's real top bar: what is asserted is the field's words, the answer on
 * screen, and what the search button says. The model is stood in for, and
 * answers when the test lets it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopBar } from '@estiva-app/ui'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { enter } from '@/test-enter'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { KeptLauncherProvider } from '@/lib/KeptLauncherProvider'
import { useKeptSearch } from './useKeptLauncher'

const { promptForText, captureLauncherContext, insertTextIntoActiveComposer, insertTextWhenComposerOpens, insertTextIntoComposer } = vi.hoisted(() => ({
  promptForText: vi.fn<(instruction: string) => Promise<string | null>>(),
  captureLauncherContext: vi.fn<() => LauncherContext>(),
  insertTextIntoActiveComposer: vi.fn<(text: string) => boolean>(() => true),
  insertTextWhenComposerOpens: vi.fn<(label: string | undefined, text: string) => Promise<boolean>>(async () => true),
  insertTextIntoComposer: vi.fn<(label: string | undefined, text: string) => boolean>(() => false),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill: async () => true, hasPromptApi: () => true, prefillAvailability: async () => 'available', promptForText }
})
vi.mock('@/lib/launcherContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/launcherContext')>('@/lib/launcherContext')
  return { ...actual, captureLauncherContext }
})
// The composer itself is covered in `composerRegistry.test`; here it is where the text is sent, and with which label.
vi.mock('@/lib/composerRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/composerRegistry')>('@/lib/composerRegistry')
  return { ...actual, insertTextIntoActiveComposer, insertTextWhenComposerOpens, insertTextIntoComposer }
})
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }) }
})

Element.prototype.scrollIntoView = vi.fn()

const conversation = (label: string, said: string): LauncherContext => ({
  composer: { isFocused: true, hasDraft: false, label },
  conversation: { references: [], messages: [{ id: `m-${label}`, author: 'Katerina', timestamp: '9:41 AM', body: said }] },
})
const builds = conversation('Build failures', 'the build broke on main after the interop bump')
const launch = conversation('Launch plan', 'we ship the website on Friday')

/** The model, answering only when the test says so. */
let answerNow: (text: string | null) => void = () => {}
const SENTENCE = 'what broke the build'

/** Where the page is, for the test to read, and a way to go somewhere else as a click in the sidebar would. */
function Where() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="where">{pathname}</output>
      <button type="button" onClick={() => navigate('/topic/launch')}>
        Go to Launch plan
      </button>
      <button type="button" onClick={() => navigate('?thread=1')}>
        Open a thread here
      </button>
    </>
  )
}

/** A page's own frame: its search reads the app's kept launcher, as `PeekFrame` does. */
function PageFrame() {
  const kept = useKeptSearch()!
  return (
    <>
      <TopBar onSearch={kept.toggle} searchPlaceholder="Search Peek..." searchStatus={kept.searchStatus} searchStatusLabel={kept.searchStatusLabel} />
      <Where />
    </>
  )
}

/** As the app is built: one launcher above the routes, and every page drawing a frame of its own, thrown away when the page changes. */
function Frame() {
  return (
    <KeptLauncherProvider>
      <Routes>
        <Route path="/topic/builds" element={<PageFrame />} />
        <Route
          path="*"
          element={
            <section>
              <PageFrame />
            </section>
          }
        />
      </Routes>
    </KeptLauncherProvider>
  )
}

function mount() {
  render(
    <MemoryRouter initialEntries={['/topic/builds']}>
      <DebugProvider>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <Frame />
            </ToastProvider>
          </LastSelectionProvider>
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const search = () => screen.getByRole('button', { name: /Search Peek/, hidden: true })
const field = () => document.querySelector<HTMLTextAreaElement>('[data-command-palette-field]')
const box = () => document.querySelector('[role="dialog"]')
/** What the search says about the hidden box: `working`, `waiting`, or null for no dot. */
const dot = () => search().getAttribute('data-search-status')

/** Open with Ctrl+K and wait for the field. */
async function openBox(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}')
  // Shown and with the cursor in it: the dialog takes focus a moment after it opens, and keys pressed before that go nowhere.
  await waitFor(() => {
    expect(field()).not.toBeNull()
    expect(document.activeElement).toBe(field())
  })
  return field()!
}
/** Escape, and wait until the box is off the screen. */
async function hide(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(box()).toBeNull())
}
/** Type the sentence and send it; the model is left working. */
async function ask(user: ReturnType<typeof userEvent.setup>) {
  const input = await openBox(user)
  await enter(input, SENTENCE)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(promptForText).toHaveBeenCalledTimes(1))
}

beforeEach(() => {
  promptForText.mockReset()
  promptForText.mockImplementation(() => new Promise((resolve) => (answerNow = resolve)))
  captureLauncherContext.mockReset()
  captureLauncherContext.mockReturnValue(builds)
  insertTextIntoActiveComposer.mockClear()
  insertTextWhenComposerOpens.mockClear()
  insertTextIntoComposer.mockReset()
  // The message box on screen is the first conversation's.
  insertTextIntoComposer.mockImplementation((label) => label === 'Build failures')
})

describe('Escape keeps what the box holds', () => {
  it('shows the same sentence when the box is opened again, and says Escape hides', async () => {
    const user = mount()
    const input = await openBox(user)
    await enter(input, SENTENCE)
    expect(box()?.textContent).toContain('Esc hide')
    await hide(user)
    expect((await openBox(user)).value).toBe(SENTENCE)
  })

  it('keeps it through a second Ctrl+K and a click on the search, too', async () => {
    const user = mount()
    await enter(await openBox(user), SENTENCE)
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(box()).toBeNull())
    await user.click(search())
    await waitFor(() => expect(field()?.value).toBe(SENTENCE))
  })

  it('opens empty after the field was cleared, and says Escape closes an empty box', async () => {
    const user = mount()
    const input = await openBox(user)
    await enter(input, SENTENCE)
    await user.clear(input)
    expect(box()?.textContent).toContain('Esc close')
    await hide(user)
    expect((await openBox(user)).value).toBe('')
  })

  it('lights no dot for words that were never sent', async () => {
    const user = mount()
    await enter(await openBox(user), SENTENCE)
    await hide(user)
    expect(dot()).toBeNull()
    expect(promptForText).not.toHaveBeenCalled()
  })
})

describe('the dot on the search, for a sentence that was sent', () => {
  it('shows no dot while the box is open, working once it is hidden, and waiting when the answer comes', async () => {
    const user = mount()
    await ask(user)
    expect(dot()).toBeNull()
    await hide(user)
    expect(dot()).toBe('working')
    expect(search().textContent).toContain('working on what you asked')
    await act(async () => answerNow('It broke after the bump [1].'))
    await waitFor(() => expect(dot()).toBe('waiting'))
    expect(search().textContent).toContain('an answer is waiting')
  })

  it('brings the sentence back with its answer, and the dot is gone once it has been seen', async () => {
    const user = mount()
    await ask(user)
    await hide(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    await waitFor(() => expect(dot()).toBe('waiting'))
    expect((await openBox(user)).value).toBe(SENTENCE)
    expect(await screen.findByTestId('answer')).toHaveTextContent('It broke after the bump')
    expect(dot()).toBeNull()
    // Hidden again without acting on it: the answer was seen, so nothing lights, and it is still there.
    await hide(user)
    expect(dot()).toBeNull()
    await openBox(user)
    expect(await screen.findByTestId('answer')).toHaveTextContent('It broke after the bump')
  })

  it('waits with a dot when no answer came back, and says so in the box', async () => {
    const user = mount()
    await ask(user)
    await hide(user)
    await act(async () => answerNow(null))
    await waitFor(() => expect(dot()).toBe('waiting'))
    await openBox(user)
    expect(await screen.findByText(/No answer came back/)).toBeInTheDocument()
    expect(field()?.value).toBe(SENTENCE)
  })

  it('drops the answer and the dot when the sentence is changed', async () => {
    const user = mount()
    await ask(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    expect(await screen.findByTestId('answer')).toBeInTheDocument()
    await user.type(field()!, ' today')
    await waitFor(() => expect(screen.queryByTestId('answer')).toBeNull())
    await hide(user)
    expect(dot()).toBeNull()
    expect((await openBox(user)).value).toBe(`${SENTENCE} today`)
  })
})

describe('after moving to another conversation', () => {
  it('words that were never sent are about the conversation the box is opened in now', async () => {
    const user = mount()
    await enter(await openBox(user), SENTENCE)
    expect(box()?.textContent).toContain('Build failures')
    await hide(user)
    captureLauncherContext.mockReturnValue(launch)
    await openBox(user)
    expect(field()?.value).toBe(SENTENCE)
    expect(box()?.textContent).toContain('Launch plan')
    expect(box()?.textContent).not.toContain('Build failures')
    // And Enter asks about what is said there.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(promptForText).toHaveBeenCalledTimes(1))
    expect(promptForText.mock.calls[0][0]).toContain('we ship the website on Friday')
  })

  it('keeps the sentence when the page changes and its frame is drawn anew', async () => {
    const user = mount()
    await enter(await openBox(user), SENTENCE)
    await hide(user)
    await user.click(screen.getByRole('button', { name: 'Go to Launch plan' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/topic/launch')
    expect((await openBox(user)).value).toBe(SENTENCE)
  })

  it('a sentence that was sent stays about the conversation it was asked in', async () => {
    const user = mount()
    await ask(user)
    await hide(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    captureLauncherContext.mockReturnValue(launch)
    await openBox(user)
    expect(await screen.findByTestId('answer')).toHaveTextContent('It broke after the bump')
    expect(box()?.textContent).toContain('Build failures')
    expect(box()?.textContent).not.toContain('Launch plan')
  })

  it('puts the answer in the message box on screen when the person has not moved', async () => {
    const user = mount()
    await ask(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    await user.click(await screen.findByText('Put the answer in the composer'))
    expect(insertTextIntoComposer).toHaveBeenCalledWith('Build failures', 'It broke after the bump.')
    expect(insertTextWhenComposerOpens).not.toHaveBeenCalled()
    await waitFor(() => expect(box()).toBeNull())
    // Acted on: the next open is empty.
    expect((await openBox(user)).value).toBe('')
  })

  it('puts the answer straight in the message box when only the address changed within the same conversation', async () => {
    const user = mount()
    await ask(user)
    await hide(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    // Same conversation, same message box; the address gained a thread.
    await user.click(screen.getByRole('button', { name: 'Open a thread here' }))
    await openBox(user)
    await user.click(await screen.findByText('Put the answer in the composer'))
    expect(insertTextIntoComposer).toHaveBeenCalledWith('Build failures', 'It broke after the bump.')
    expect(insertTextWhenComposerOpens).not.toHaveBeenCalled()
    await waitFor(() => expect(box()).toBeNull())
  })

  it('opens the conversation the answer is about and puts it in that message box, not the one on screen', async () => {
    const user = mount()
    await ask(user)
    await hide(user)
    await act(async () => answerNow('It broke after the bump [1].'))
    // The person is somewhere else now: another page, another message box.
    captureLauncherContext.mockReturnValue(launch)
    insertTextIntoComposer.mockImplementation((label) => label === 'Launch plan')
    await user.click(screen.getByRole('button', { name: 'Go to Launch plan' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/topic/launch')
    // Somewhere else, the box opens fresh and the ask waits under Recent, "in" where it was asked (KIN-12).
    expect((await openBox(user)).value).toBe('')
    const kept = await screen.findByRole('option', { name: new RegExp(SENTENCE) })
    expect(kept).toHaveTextContent('in Build failures')
    await user.click(kept)
    await user.click(await screen.findByText('Put the answer in the composer'))
    expect(insertTextIntoActiveComposer).not.toHaveBeenCalled()
    expect(insertTextIntoComposer).not.toHaveBeenCalled()
    expect(insertTextWhenComposerOpens).toHaveBeenCalledWith('Build failures', 'It broke after the bump.', expect.any(Function))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/topic/builds'))
  })
})
