/**
 * INT-4 — a drafted reply, previewed first and never sent.
 *
 * Two properties carry the ticket, and both are asserted negatively because
 * both fail silently:
 *
 * 1. **Nothing sends.** The draft reaches the composer and stops. There is no
 *    assertion that can prove a send did not happen from the outside, so the
 *    seam is asserted instead: the only thing this path may call is
 *    `insertTextIntoActiveComposer`.
 * 2. **Nothing is clobbered.** The insert lands at the cursor, so a message
 *    somebody had already started survives — covered at the registry, verified
 *    here to the extent that the launcher never reaches for anything else.
 *
 * The third is a launcher rule rather than an AI one: drafting is a **row**,
 * not an inference. Asking and drafting are the same sentence read two ways,
 * and PEE-4 already settled that the launcher does not guess which was meant.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import { CommandLauncher } from './CommandLauncher'

const { canPrefill, promptForText, insertTextIntoActiveComposer } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  // Typed rather than stubbed with an implementation, so `mock.calls[0][0]`
  // is a `string` and the argument assertions below actually type-check.
  promptForText: vi.fn<(instruction: string) => Promise<string | null>>(),
  insertTextIntoActiveComposer: vi.fn<(text: string) => boolean>(),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, promptForText }
})
vi.mock('@/lib/composerRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/composerRegistry')>('@/lib/composerRegistry')
  return { ...actual, insertTextIntoActiveComposer }
})
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }) }
})

Element.prototype.scrollIntoView = vi.fn()

/** A thread message, with the identity a citation needs (INT-3). */
let seq = 0
const reply = (body: string) => ({ id: `r${seq++}`, author: 'Katerina', timestamp: '9:41 AM', body })

/** A thread with a composer under it — where a draft has somewhere to go. */
const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [], messages: [reply('the build broke on main after the interop bump')] },
}

const onClose = vi.fn()

function open(context: LauncherContext = inThread) {
  render(
    <MemoryRouter initialEntries={['/topics/1']}>
      <DebugProvider>
        <PeekDataProvider>
          <CommandLauncher context={context} onClose={onClose} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

const input = () => screen.getByRole('textbox')
const draftRow = () => screen.findByText(/Draft a reply/i)

async function enterDraft(request = 'offer to take a look tomorrow') {
  open()
  await userEvent.type(input(), request)
  await userEvent.click(await draftRow())
}

beforeEach(() => {
  canPrefill.mockResolvedValue(true)
  promptForText.mockResolvedValue('Happy to take a look tomorrow.')
  insertTextIntoActiveComposer.mockReturnValue(true)
  onClose.mockClear()
  insertTextIntoActiveComposer.mockClear()
  promptForText.mockClear()
})

describe('drafting is offered as its own row (INT-4)', () => {
  it('sits beside Ask rather than replacing it', async () => {
    /*
      The rejected alternative was one row and a model deciding whether the
      sentence was a question or a brief. They fail in opposite directions — a
      brief answered as a question wastes the request — and two rows cost one
      arrow key and are never wrong.
    */
    open()
    await userEvent.type(input(), 'offer to take a look tomorrow')

    expect(await draftRow()).toBeInTheDocument()
    expect(screen.getByText(/Ask about this conversation/i)).toBeInTheDocument()
  })

  it('is absent with no composer, because a draft would have nowhere to go', async () => {
    open({ conversation: { references: [], messages: [reply('the build broke on main')] } })
    await userEvent.type(input(), 'offer to take a look tomorrow')

    // Ask still stands: reading a conversation needs no composer.
    expect(await screen.findByText(/Ask about this conversation/i)).toBeInTheDocument()
    expect(screen.queryByText(/Draft a reply/i)).not.toBeInTheDocument()
  })

  it('is absent with no conversation, because there is nothing to draft from', async () => {
    open({ composer: { isFocused: true, hasDraft: false } })
    await userEvent.type(input(), 'offer to take a look tomorrow')

    expect(screen.queryByText(/Draft a reply/i)).not.toBeInTheDocument()
  })

  it('is absent where no model could write one', async () => {
    // The launcher's own rule: an action appears only where it can succeed.
    canPrefill.mockResolvedValue(false)
    open()
    await userEvent.type(input(), 'offer to take a look tomorrow')

    expect(screen.queryByText(/Draft a reply/i)).not.toBeInTheDocument()
  })

  it('never fires on its own when a search finds nothing', async () => {
    // The same rule INT-2 keeps, restated because a second row is a second
    // chance to get it wrong.
    open()
    await userEvent.type(input(), 'zzqxvwmkjjbtplfd')

    expect(await draftRow()).toBeInTheDocument()
    expect(promptForText).not.toHaveBeenCalled()
  })
})

describe('the draft is written from the thread and the request (INT-4)', () => {
  it('sends both to the model', async () => {
    await enterDraft()

    await waitFor(() => expect(promptForText).toHaveBeenCalled())
    const instruction = promptForText.mock.calls[0][0]
    expect(instruction).toContain('the build broke on main after the interop bump')
    expect(instruction).toContain('offer to take a look tomorrow')
  })

  it('says it is working rather than showing an empty panel', async () => {
    /*
      Measured in INT-1: 8000 characters of thread costs about 2.3 seconds
      before a word comes back. A blank panel for that long reads as broken.
    */
    let release: (answer: string) => void = () => {}
    promptForText.mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve
      }),
    )
    await enterDraft()

    expect(await screen.findByText(/Writing a draft/i)).toBeInTheDocument()
    release('Happy to take a look tomorrow.')
    expect(await screen.findByTestId('draft')).toHaveTextContent('Happy to take a look tomorrow.')
  })

  it('shows the draft before it goes anywhere', async () => {
    // The whole shape of the ticket. An unwanted draft in the composer costs a
    // selection and a delete; seeing it first costs nothing.
    await enterDraft()

    expect(await screen.findByTestId('draft')).toHaveTextContent('Happy to take a look tomorrow.')
    expect(insertTextIntoActiveComposer).not.toHaveBeenCalled()
  })

  it('says plainly that it will not send', async () => {
    await enterDraft()
    await screen.findByTestId('draft')

    expect(screen.getByText(/will not send/i)).toBeInTheDocument()
  })

  it('says so when nothing comes back, instead of showing an empty draft', async () => {
    promptForText.mockResolvedValue(null)
    await enterDraft()

    expect(await screen.findByText(/No draft came back/i)).toBeInTheDocument()
    expect(screen.queryByTestId('draft')).not.toBeInTheDocument()
  })
})

describe('the draft is the person\'s to send (INT-4)', () => {
  it('goes into the composer when they ask, and only then', async () => {
    await enterDraft()
    await screen.findByTestId('draft')

    await userEvent.click(screen.getByRole('button', { name: /Put it in the composer/i }))
    expect(insertTextIntoActiveComposer).toHaveBeenCalledWith('Happy to take a look tomorrow.')
  })

  it('closes the launcher so the composer has the cursor', async () => {
    await enterDraft()
    await screen.findByTestId('draft')
    await userEvent.click(screen.getByRole('button', { name: /Put it in the composer/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('leaves without inserting anything', async () => {
    /*
      Backing out is the common case for a draft that missed — it must cost
      nothing, and in particular must not have already landed.
    */
    await enterDraft()
    await screen.findByTestId('draft')
    await userEvent.click(screen.getByRole('button', { name: /Leave Draft/i }))

    expect(insertTextIntoActiveComposer).not.toHaveBeenCalled()
    expect(input()).toHaveValue('offer to take a look tomorrow')
  })

  it('shows a Draft chip, not the Ask one', async () => {
    // Two modes reaching the same panel; the chip is what says which.
    await enterDraft()

    expect(screen.getByRole('button', { name: /Leave Draft/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Leave Ask/i })).not.toBeInTheDocument()
  })

  it('does not offer to insert on the Ask path, which answers rather than drafts', async () => {
    // Both intents reach the same panel and both call a model (INT-3 filled
    // Ask in). What separates them is what the panel then offers.
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await screen.findByText(/Ask about this conversation/i))

    expect(await screen.findByTestId('sources')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Put it in the composer/i })).not.toBeInTheDocument()
  })
})
