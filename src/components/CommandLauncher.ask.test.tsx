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
import { CommandLauncher } from './CommandLauncher'

const { canPrefill } = vi.hoisted(() => ({ canPrefill: vi.fn(async () => true) }))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill }
})
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }) }
})

Element.prototype.scrollIntoView = vi.fn()

/** A launcher invoked from a thread with something in it to ask about. */
const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [], messages: ['the build broke on main after the interop bump'] },
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
      The launcher's own rule: an action appears only where it can succeed.
      Edge 154 gates generative execution outright, and a row that always fails
      there is worse than no row.
    */
    canPrefill.mockResolvedValue(false)
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
    expect(screen.queryByText(/not built yet/i)).not.toBeInTheDocument()
  })
})

describe('the Ask surface (INT-2)', () => {
  it('names the question and says answering is not built', async () => {
    // Shipping it empty is the point: the gesture is judgeable without a model.
    open()
    await userEvent.type(input(), 'what did we decide')
    await userEvent.click(await askRow())

    // It is in the chip and in the panel, deliberately: the chip is the state
    // and the panel is the question the answer will be about.
    expect(screen.getAllByText('what did we decide')).toHaveLength(2)
    expect(screen.getByText(/not built yet/i)).toBeInTheDocument()
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

    expect(screen.queryByText(/not built yet/i)).not.toBeInTheDocument()
    expect(await askRow()).toBeInTheDocument()
  })
})
