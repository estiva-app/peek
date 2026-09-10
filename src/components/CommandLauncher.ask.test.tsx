/**
 * INT-2 — the Ask row, and the promise that the query survives.
 *
 * **No model is involved in this ticket or these tests.** The surface is all
 * the UX risk and none of the model risk, which is why it is split out: the
 * gesture can be judged before a prompt exists.
 *
 * The assertions worth reading are the negative ones. The original framing was
 * *"as it doesn't match any search, it will do the prompt"*, and PEE-4 makes
 * that unworkable — message search is whole-token, so "no matches" is the
 * normal state of a half-typed word and fallthrough would fire on nearly every
 * keystroke. So Ask must be a **choice**, and it must not disturb anything
 * PEE-4 built.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import type { ModelAvailability } from '@/lib/promptApi'
import { CommandLauncher } from './CommandLauncher'

const { canPrefill, prefillAvailability, downloadModel } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  downloadModel: vi.fn(async () => true),
  // What gates the row since INT-10 — the raw answer, because 'downloadable'
  // now earns an offer where 'unavailable' earns silence.
  prefillAvailability: vi.fn<() => Promise<ModelAvailability>>(async () => 'available'),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, prefillAvailability, downloadModel }
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
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [], messages: [reply('the build broke on main after the interop bump')] },
}

function open(context: LauncherContext = inThread) {
  render(
    <MemoryRouter initialEntries={['/topics/1']}>
      <DebugProvider>
        <PeekDataProvider>
          <CommandLauncher context={context} onClose={vi.fn()} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

const input = () => screen.getByRole('textbox')
const askRow = () => screen.findByText(/Ask about this conversation/i)

beforeEach(() => {
  canPrefill.mockResolvedValue(true)
  prefillAvailability.mockResolvedValue('available')
  downloadModel.mockReset()
  downloadModel.mockResolvedValue(true)
})

describe('the Ask row is offered, not triggered (INT-2)', () => {
  it('appears once something is typed', async () => {
    open()
    expect(screen.queryByText(/Ask about this conversation/i)).not.toBeInTheDocument()
    await userEvent.type(input(), 'what did we decide')
    expect(await askRow()).toBeInTheDocument()
  })

  it('shows the question it would ask, so the row says what it does', async () => {
    open()
    await userEvent.type(input(), 'what did we decide')
    // Scoped to the row: INT-4 added a second row that quotes the same
    // sentence back, read as a brief rather than a question.
    expect(await askRow()).toHaveTextContent('Ask about this conversation: "what did we decide"')
  })

  it('is absent where no model could answer', async () => {
    /*
      The launcher's own rule: an action appears only where it can succeed, so
      a row that would always fail is worse than no row.

      'downloadable' is the case: the model is not on the machine, so asking
      cannot work — and since INT-10 an offer to fetch it stands in the row's
      place rather than nothing at all, asserted below.
    */
    canPrefill.mockResolvedValue(false)
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    // `userEvent.type` flushes between keystrokes, so the resolved probe has
    // settled by here. "Apps" is not a sync point: a typed sentence matches no
    // app, so that section is filtered away.
    await userEvent.type(input(), 'what did we decide')
    expect(screen.queryByText(/Ask about this conversation/i)).not.toBeInTheDocument()
  })

  it('is absent with no conversation open, because there is nothing to ask about', async () => {
    open({ composer: { isFocused: true, hasDraft: false } })
    await userEvent.type(input(), 'what did we decide')
    expect(screen.queryByText(/Ask about this conversation/i)).not.toBeInTheDocument()
  })
})

describe('the query is sovereign (INT-2)', () => {
  it('keeps what was typed when Ask is taken', async () => {
    // Changing how a sentence is interpreted must never cost the sentence.
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    expect(input()).toHaveValue('what did we decide')
  })

  it('keeps it on the way back out too', async () => {
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())
    await userEvent.click(screen.getByRole('button', { name: /Leave Ask/i }))

    expect(input()).toHaveValue('what did we decide')
    // And searching is on offer again.
    expect(await askRow()).toBeInTheDocument()
  })

  it('leaves on Backspace once the box is empty, the rule a scope already follows', async () => {
    /*
      Backspace edits the text while there is text — the same behaviour the
      scope chip has. Emptying the box and pressing it again pops the level,
      rather than Backspace meaning two things at once.
    */
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    await userEvent.clear(input())
    await userEvent.keyboard('{Backspace}')
    // The chip is the marker for "in Ask", not the panel copy — INT-3 replaced
    // the placeholder that used to be asserted here.
    expect(screen.queryByRole('button', { name: /Leave Ask/i })).not.toBeInTheDocument()
  })
})

describe('the Ask surface (INT-2)', () => {
  it('names the question in the chip and in the panel', async () => {
    // Deliberately both: the chip is the state, and the panel is the question
    // the answer is about.
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    expect(screen.getAllByText('what did we decide')).toHaveLength(2)
  })

  it('replaces the result list rather than sitting under it', async () => {
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    expect(screen.queryByText('Apps')).not.toBeInTheDocument()
  })

  it('shows a chip that is not an app chip', async () => {
    /*
      Ask is a mode. Drawing it in the same shape as Ship and Peek would read as
      a third application that does not exist.
    */
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    expect(screen.getByRole('button', { name: /Leave Ask/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Leave Ship/i })).not.toBeInTheDocument()
  })
})

describe('nothing PEE-4 built has changed (INT-2)', () => {
  it('still searches while the Ask row is on offer', async () => {
    // Results coexist with the offer — asking is a choice, not a mode you fall
    // into, and the search must still work while it is available.
    open()
    await userEvent.type(input(), 'pipeline')

    expect(await askRow()).toBeInTheDocument()
    expect(screen.getByText('Topics')).toBeInTheDocument()
    expect(screen.getByText('CI/CD pipeline stuck during build stage')).toBeInTheDocument()
  })

  it('never fires on its own when a search finds nothing', async () => {
    /*
      The rejected design. A query matching nothing is a query matching
      nothing — PEE-4 says so in two distinct sentences, and a third meaning
      would make both meaningless.
    */
    open()
    await userEvent.type(input(), 'zzqxvwmkjjbtplfd')

    expect(screen.queryByRole('button', { name: /Leave Ask/i })).not.toBeInTheDocument()
    expect(await askRow()).toBeInTheDocument()
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
 * The offer sits where the Ask rows would have been, so the rows are never
 * both present, and it starts the fetch only when somebody selects it.
 */
describe('the download is offered rather than deadlocked (INT-10)', () => {
  const offer = () => screen.findByText(/Download the on-device model/i)

  it('offers the fetch where the model could run but is not here', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await userEvent.type(input(), 'what did we decide')

    expect(await offer()).toBeInTheDocument()
    // Says what it costs before it is taken, not after.
    expect(screen.getByText(/Several gigabytes/i)).toBeInTheDocument()
  })

  it('downloads nothing until it is selected', async () => {
    // The PEE-6 guarantee: opening a launcher is not consent to a 22 GB fetch.
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await userEvent.type(input(), 'what did we decide')

    expect(await offer()).toBeInTheDocument()
    expect(downloadModel).not.toHaveBeenCalled()
  })

  it('starts the fetch when it is', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await userEvent.type(input(), 'what did we decide')
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
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await offer())

    expect(await screen.findByText(/Downloading the on-device model… 42%/)).toBeInTheDocument()
  })

  it('replaces itself with the Ask row once the model is here', async () => {
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await userEvent.type(input(), 'what did we decide')
    expect(screen.queryByText(/Ask about this conversation/i)).not.toBeInTheDocument()
    await userEvent.click(await offer())

    expect(await askRow()).toBeInTheDocument()
    expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument()
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
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await offer())

    expect(await screen.findByText(/This browser refused the model/i)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/This browser refused the model/i))
    expect(downloadModel).toHaveBeenCalledTimes(1)
  })

  it('is absent where nothing has been typed, so it is never a nag', async () => {
    // It stands in for the Ask rows and appears on their conditions. A person
    // who opened the launcher to jump to a topic is not asked about models.
    prefillAvailability.mockResolvedValue('downloadable')
    open()

    expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument()
  })

  it('is absent where the browser has no model to offer at all', async () => {
    // 'unavailable' is not 'downloadable'. Nothing to fetch, so nothing to say.
    prefillAvailability.mockResolvedValue('unavailable')
    open()
    await userEvent.type(input(), 'what did we decide')

    expect(screen.queryByText(/Download the on-device model/i)).not.toBeInTheDocument()
  })
})
