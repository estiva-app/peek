/**
 * INT-3 — the answer, and the sources that make it checkable.
 *
 * The claim this surface makes is not "the model is right". It is **"here is
 * where this came from"**, and every assertion below is about keeping that
 * claim true: sources are never empty, never invented, and always reach the
 * message they name.
 *
 * Nothing here asserts the quality of an answer. That varies with the model and
 * always will — which is exactly why the mitigation is structural.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import { CommandLauncher } from './CommandLauncher'

const { canPrefill, promptForText, scrollToMessage } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  promptForText: vi.fn<(instruction: string) => Promise<string | null>>(),
  scrollToMessage: vi.fn<(id: string) => boolean>(),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, promptForText }
})
vi.mock('@/lib/messageAnchor', () => ({ scrollToMessage }))
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return { ...actual, useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }) }
})

Element.prototype.scrollIntoView = vi.fn()

const thread = [
  { id: 'r1', author: 'Amie', timestamp: '9:02 AM', body: 'morning all' },
  { id: 'r2', author: 'Daniel', timestamp: '9:22 AM', body: 'the migration is blocked on the interop bump' },
  { id: 'r3', author: 'Katerina', timestamp: '9:41 AM', body: 'we decided to postpone the migration until Thursday' },
]

const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [], messages: thread },
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

async function ask(question = 'what did we decide about the migration') {
  open()
  await userEvent.type(input(), question)
  await userEvent.click(await screen.findByText(/Ask about this conversation/i))
}

const sources = () => screen.getByTestId('sources')

beforeEach(() => {
  canPrefill.mockResolvedValue(true)
  promptForText.mockResolvedValue('Postponed until Thursday [3].')
  scrollToMessage.mockReturnValue(true)
  onClose.mockClear()
  promptForText.mockClear()
  scrollToMessage.mockClear()
})

describe('the answer is drawn from selected messages (INT-3)', () => {
  it('sends the thread as numbered material, not as a wall of prose', async () => {
    // Retrieval first, generation second. The numbers are the only citation
    // vocabulary the model gets.
    await ask()

    await screen.findByTestId('answer')
    const instruction = promptForText.mock.calls[0][0]
    expect(instruction).toContain('[2] Daniel: the migration is blocked on the interop bump')
    expect(instruction).toMatch(/cite the messages/i)
  })

  it('says it is reading rather than showing an empty panel', async () => {
    let release: (answer: string) => void = () => {}
    promptForText.mockReturnValue(new Promise<string | null>((resolve) => (release = resolve)))
    await ask()

    expect(await screen.findByText(/Reading the thread/i)).toBeInTheDocument()
    release('Postponed until Thursday [3].')
    expect(await screen.findByTestId('answer')).toBeInTheDocument()
  })

  it('shows the answer with the message it cited', async () => {
    await ask()

    expect(await screen.findByTestId('answer')).toHaveTextContent('Postponed until Thursday [3].')
    expect(sources()).toHaveTextContent('Katerina')
    expect(sources()).toHaveTextContent('we decided to postpone the migration until Thursday')
  })

  it('shows only the messages actually cited', async () => {
    // A citation narrows the list. Showing all three when the model named one
    // would make the sources decorative.
    await ask()
    await screen.findByTestId('answer')

    expect(sources()).not.toHaveTextContent('morning all')
  })

  it('shows every message read when the model cited none', async () => {
    /*
      Citations narrow the source list; they never widen it, and they never
      empty it. Those are the only messages the model saw, so "the answer came
      from these" stays true — and an answer with no sources at all is the one
      thing this feature exists to prevent.
    */
    promptForText.mockResolvedValue('They postponed it until Thursday.')
    await ask()
    await screen.findByTestId('answer')

    expect(sources()).toHaveTextContent('morning all')
    expect(sources()).toHaveTextContent('we decided to postpone the migration until Thursday')
  })

  it('never shows a source the model invented', async () => {
    // Given three messages, a small model will still occasionally cite [7].
    promptForText.mockResolvedValue('Postponed until Thursday [7].')
    await ask()

    expect(await screen.findByTestId('answer')).toHaveTextContent('Postponed until Thursday.')
    expect(sources().querySelectorAll('button')).toHaveLength(thread.length)
  })

  it('says so when no answer comes back', async () => {
    /*
      Silence inverts here. PEE-6's "say nothing rather than apologise" was
      written for prefill nobody asked for; a person who pressed Enter on a
      question is owed an answer or a reason.
    */
    promptForText.mockResolvedValue(null)
    await ask()

    expect(await screen.findByText(/No answer came back/i)).toBeInTheDocument()
    expect(screen.queryByTestId('answer')).not.toBeInTheDocument()
  })
})

describe('a citation reaches the message (INT-3)', () => {
  it('scrolls to it and closes the launcher', async () => {
    await ask()
    await screen.findByTestId('answer')

    await userEvent.click(sources().querySelectorAll('button')[0])
    expect(scrollToMessage).toHaveBeenCalledWith('r3')
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open and says so when the message is not loaded', async () => {
    /*
      A thread paginates, so a cited message can sit above the loaded window.
      Closing first would leave a click that appeared to work and did nothing,
      which is worse than a row that was never offered.
    */
    scrollToMessage.mockReturnValue(false)
    await ask()
    await screen.findByTestId('answer')

    await userEvent.click(sources().querySelectorAll('button')[0])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/Not loaded in the thread/i)).toBeInTheDocument()
  })

  it('numbers each source so it can be matched to the answer', async () => {
    await ask()
    await screen.findByTestId('answer')

    expect(sources()).toHaveTextContent('[3] Katerina · 9:41 AM')
  })
})

describe('refining, and what retrieval admits to (INT-3)', () => {
  it('asks again on Enter with the edited question', async () => {
    /*
      Also a fix: `rows` is still computed on this level, so Enter used to fire
      a search result nobody could see (shipped in INT-2).
    */
    await ask('migration')
    await screen.findByTestId('answer')
    promptForText.mockClear()

    await userEvent.clear(input())
    await userEvent.type(input(), 'when does it ship{Enter}')

    expect(await screen.findByTestId('answer')).toBeInTheDocument()
    expect(promptForText.mock.calls[0][0]).toContain('when does it ship')
  })

  it('says when the question matched nothing and recency chose instead', async () => {
    // A different thing from retrieval, and reported rather than hidden behind
    // an identical-looking answer.
    await ask('zzqxvwmkjjbtplfd')

    await screen.findByTestId('answer')
    expect(screen.getByText(/Nothing in the thread matched/i)).toBeInTheDocument()
  })

  it('does not claim recency when the question matched', async () => {
    await ask()
    await screen.findByTestId('answer')

    expect(screen.queryByText(/Nothing in the thread matched/i)).not.toBeInTheDocument()
  })

  it('writes nothing anywhere', async () => {
    /*
      INT-3's hard boundary. The answer is shown and forgotten — "save this
      answer" is the obvious next request and is exactly what the roadmap holds
      back, because kind:9802 is append-only and a shape settled while the model
      is unsettled is permanent.
    */
    const before = { local: { ...localStorage }, session: { ...sessionStorage } }
    await ask()
    await screen.findByTestId('answer')

    expect({ local: { ...localStorage }, session: { ...sessionStorage } }).toEqual(before)
  })
})
