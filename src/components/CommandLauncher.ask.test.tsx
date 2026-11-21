/**
 * The field is a search up to two words and a prompt from the third (a77dd5e3,
 * "In Peek's ⌘K, a third word turns the search into a prompt").
 *
 * INT-2 made asking a row you chose, beside the results. The prompt replaces
 * that row: the words themselves say which it is, Enter asks, and nothing is
 * asked until Enter. What Enter then shows is in `CommandLauncher.answer.test`.
 *
 * **No model is involved in these tests.** They hold the gesture: when the
 * field turns, what stays under it, and what Enter says where nothing can
 * answer — the box is the same in every browser and on every page (Miky, 20
 * November 2026).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { enter } from '@/test-enter'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import type { ModelAvailability } from '@/lib/promptApi'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

const { canPrefill, hasPromptApi, prefillAvailability, downloadModel, promptForText } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  hasPromptApi: vi.fn(() => true),
  downloadModel: vi.fn(async () => true),
  promptForText: vi.fn<(instruction: string) => Promise<string | null>>(async () => 'It broke after the bump [1].'),
  // The raw answer, because 'downloadable' earns an offer where 'unanswered' earns one line.
  prefillAvailability: vi.fn<() => Promise<ModelAvailability | 'unanswered'>>(async () => 'available'),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, hasPromptApi, prefillAvailability, downloadModel, promptForText }
})
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }) }
})

Element.prototype.scrollIntoView = vi.fn()

/** A thread message, with the identity a citation needs (INT-3). */
let seq = 0
const reply = (body: string) => ({ id: `r${seq++}`, author: 'Katerina', timestamp: '9:41 AM', body })

/** A launcher invoked from a thread with something in it to ask about. */
const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false, label: 'Build failures' },
  conversation: { references: [], messages: [reply('the build broke on main after the interop bump')] },
}

function open(context: LauncherContext = inThread) {
  render(
    <MemoryRouter initialEntries={['/topics/1']}>
      <DebugProvider>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <CommandLauncher context={context} onClose={vi.fn()} />
            </ToastProvider>
          </LastSelectionProvider>
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

const input = () => document.querySelector<HTMLTextAreaElement>('[data-command-palette-field]')!
const groupNames = () => screen.queryAllByRole('group').map((g) => g.firstElementChild?.textContent)
const footer = () => document.querySelector('[role="dialog"]')?.textContent ?? ''

beforeEach(() => {
  canPrefill.mockResolvedValue(true)
  hasPromptApi.mockReturnValue(true)
  prefillAvailability.mockResolvedValue('available')
  downloadModel.mockReset()
  downloadModel.mockResolvedValue(true)
  promptForText.mockClear()
})

describe('up to two words the field is a search', () => {
  it('offers no Ask, Draft or Make row before anything is typed, in a conversation', async () => {
    // You ask by writing a sentence; the empty box keeps what the conversation can be changed by, Actions, Recent and Apps.
    open()
    expect(await screen.findByText('Apps')).toBeInTheDocument()
    expect(screen.queryByText(/Ask about this conversation/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Draft a reply/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Suggest what to make/)).not.toBeInTheDocument()
  })

  it('names the conversation once, above the field, from the moment the box opens', async () => {
    // A name arriving with the third word would push the typed line down; the footer's "In …" would say it twice.
    open()
    expect(await screen.findByText('Apps')).toBeInTheDocument()
    expect(screen.getAllByText(/Build failures/)).toHaveLength(1)
    // Alone on its line (the footer's would read "In Build failures"), and before the field.
    const name = screen.getByText('Build failures')
    expect(name.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lists what two words find, on one line, with no Ask row beside it', async () => {
    open()
    await enter(input(), 'product designer')

    expect(await screen.findByText('Alice Johnson')).toBeInTheDocument()
    expect(input().rows).toBe(1)
    expect(screen.queryByText(/^Ask/)).not.toBeInTheDocument()
    expect(groupNames()).not.toContain('Suggested')
  })

  it('stays a search with a quoted phrase or a minus, however many words', async () => {
    // Search syntax (record search-matches-every-word-as-a-word-start) is never read as a sentence.
    open()
    await enter(input(), '"alice johnson" designer -intern')

    expect(input().rows).toBe(1)
    expect(footer()).not.toContain('ask')
  })
})

describe('from the third word the field is a prompt', () => {
  it('grows to three lines, names the conversation, and the search results leave', async () => {
    open()
    await enter(input(), 'alice johnson designer')

    await waitFor(() => expect(input().rows).toBe(3))
    expect(screen.getByText('Build failures')).toBeInTheDocument()
    // A person all three words match is a search result, and those have left.
    expect(screen.queryByText('Alice Johnson')).not.toBeInTheDocument()
    expect(groupNames()).not.toContain('People')
    expect(footer()).toContain('ask')
  })

  it('asks nothing until Enter', async () => {
    // The rejected design (INT-2): a sentence that falls through to the model on its own.
    open()
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))

    expect(promptForText).not.toHaveBeenCalled()
  })

  it('asks about the open conversation on Enter, with the sentence still in the field', async () => {
    open()
    await enter(input(), 'what did we decide')
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByTestId('answer')).toHaveTextContent('It broke after the bump')
    expect(promptForText.mock.calls[0][0]).toContain('what did we decide')
    expect(input()).toHaveValue('what did we decide')
  })

  it('goes back to a search, with its results, when a word is deleted', async () => {
    open()
    await enter(input(), 'product designer alice')
    await waitFor(() => expect(input().rows).toBe(3))

    await userEvent.type(input(), '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}')
    expect(input()).toHaveValue('product designer')
    expect(input().rows).toBe(1)
    expect(await screen.findByText('Alice Johnson')).toBeInTheDocument()
  })
})

describe('where nothing can answer, the box is the same and Enter says why', () => {
  it('says to open a conversation, with none open', async () => {
    open({ composer: { isFocused: true, hasDraft: false } })
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByText('Open a conversation to ask about it.')).toBeInTheDocument()
    expect(promptForText).not.toHaveBeenCalled()
  })

  it('says nothing has been said yet in an open conversation that is empty, not to open one', async () => {
    open({ composer: { isFocused: true, hasDraft: false }, conversation: { references: [], messages: [] } })
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByText('Nothing has been said here yet.')).toBeInTheDocument()
    expect(screen.queryByText('Open a conversation to ask about it.')).not.toBeInTheDocument()
  })

  it('says asking needs the on-device model, in a browser that has none', async () => {
    prefillAvailability.mockResolvedValue('unanswered')
    open()
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByText('Asking needs Chrome’s on-device model.')).toBeInTheDocument()
    expect(promptForText).not.toHaveBeenCalled()
  })

  it('says so too in a browser with no Prompt API, which reports the same as a Chrome that can answer', async () => {
    // Firefox, Safari, a phone: `prefillAvailability` answers 'unavailable' there, as a working Chrome sometimes does.
    hasPromptApi.mockReturnValue(false)
    prefillAvailability.mockResolvedValue('unavailable')
    open()
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByText('Asking needs Chrome’s on-device model.')).toBeInTheDocument()
    expect(promptForText).not.toHaveBeenCalled()
  })

  it('takes the line away when the words change', async () => {
    open({ composer: { isFocused: true, hasDraft: false } })
    await enter(input(), 'what did we decide')
    await userEvent.type(input(), '{Enter}')
    expect(await screen.findByText('Open a conversation to ask about it.')).toBeInTheDocument()

    await userEvent.type(input(), ' today')
    expect(screen.queryByText('Open a conversation to ask about it.')).not.toBeInTheDocument()
  })
})

/**
 * INT-10 — the download nothing offered, filed by Miky on 2026-09-09.
 *
 * He ran for a week on a machine that could run the model, saw no Ask row and
 * no reason for its absence, and got the model in the end by pasting
 * `LanguageModel.create()` into the browser console. Nothing in Peek was ever
 * going to offer it: the gate refuses 'downloadable' (PEE-6, so a form never
 * starts a 22 GB fetch) and the browser fetches only when a page calls
 * `create()`. Neither side moved.
 *
 * The offer sits under a prompt, and it starts the fetch only when somebody
 * selects it.
 */
describe('the download is offered rather than deadlocked (INT-10)', () => {
  const offer = () => screen.findByText(/Download the on-device model to ask/i)

  it('offers the fetch where the model could run but is not here', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(), 'what did we decide')

    expect(await offer()).toBeInTheDocument()
    // Says what it costs before it is taken, not after.
    expect(screen.getByText(/Several gigabytes/i)).toBeInTheDocument()
  })

  it('downloads nothing until it is selected, and Enter points at the offer', async () => {
    // The PEE-6 guarantee: writing a sentence is not consent to a 22 GB fetch.
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(), 'what did we decide')
    expect(await offer()).toBeInTheDocument()
    await userEvent.type(input(), '{Enter}')

    expect(await screen.findByText('Download the on-device model below to ask.')).toBeInTheDocument()
    expect(downloadModel).not.toHaveBeenCalled()
  })

  it('starts the fetch when it is', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(), 'what did we decide')
    await userEvent.click(await offer())

    expect(downloadModel).toHaveBeenCalledTimes(1)
  })

  it('shows progress as a percentage, so a multi-gigabyte wait is legible', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    downloadModel.mockImplementation(async (onProgress?: (fraction: number) => void) => {
      onProgress?.(0.42)
      // Never resolves within the test: this is the in-flight state.
      return await new Promise<boolean>(() => {})
    })
    open()
    await enter(input(), 'what did we decide')
    await userEvent.click(await offer())

    expect(await screen.findByText(/Downloading the on-device model… 42%/)).toBeInTheDocument()
  })

  it('goes once the model is here, and what the model makes possible is offered', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(), 'what did we decide')
    expect(screen.queryByText('Draft a reply')).not.toBeInTheDocument()
    await userEvent.click(await offer())

    await waitFor(() => expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument())
    expect(screen.getByText('Draft a reply')).toBeInTheDocument()
  })

  it('says so rather than retrying where the browser refuses the model', async () => {
    /*
      Edge 154. `create()` throws *"The feature flag gating model execution was
      disabled"* whatever options it is given, and no download begins — the
      gate is browser policy, not a missing file. A row that silently did
      nothing on every click is the dead end this ticket is about.
    */
    prefillAvailability.mockResolvedValue('downloadable')
    downloadModel.mockResolvedValue(false)
    open()
    await enter(input(), 'what did we decide')
    await userEvent.click(await offer())

    expect(await screen.findByText(/This browser refused the model/i)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/This browser refused the model/i))
    expect(downloadModel).toHaveBeenCalledTimes(1)
  })

  it('is absent under a search, so it is never a nag', async () => {
    // A person who opened the launcher to jump to a topic is not asked about models.
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(), 'product designer')
    expect(await screen.findByText('Alice Johnson')).toBeInTheDocument()

    expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument()
  })

  it('is absent where the browser has no model to offer at all', async () => {
    // 'unavailable' is not 'downloadable'. Nothing to fetch, so nothing to say.
    prefillAvailability.mockResolvedValue('unavailable')
    open()
    await enter(input(), 'what did we decide')
    await waitFor(() => expect(input().rows).toBe(3))

    expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument()
  })
})
