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

const { canPrefill, promptForText, scrollToMessage, scrollToMessageWhenReady, openConversation } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  promptForText: vi.fn<(instruction: string) => Promise<string | null>>(),
  scrollToMessage: vi.fn<(id: string) => boolean>(),
  scrollToMessageWhenReady: vi.fn<(id: string) => Promise<boolean>>(),
  openConversation: vi.fn<(id: string) => boolean>(),
}))
vi.mock('@/lib/threadOpener', () => ({ openConversation }))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, promptForText }
})
vi.mock('@/lib/messageAnchor', () => ({ scrollToMessage, scrollToMessageWhenReady }))
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
  scrollToMessageWhenReady.mockResolvedValue(true)
  openConversation.mockReturnValue(true)
  openConversation.mockClear()
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
    expect(screen.getByText(/Nothing here matched/i)).toBeInTheDocument()
  })

  it('does not claim recency when the question matched', async () => {
    await ask()
    await screen.findByTestId('answer')

    expect(screen.queryByText(/Nothing here matched/i)).not.toBeInTheDocument()
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

describe('asking about a whole topic (INT-8)', () => {
  /*
    A topic publishes its conversations' opening messages — replies are fetched
    per thread and are not in memory. Each carries the conversation it opens and
    how many replies were left behind.
  */
  const acrossConversations: LauncherContext = {
    conversation: {
      references: [],
      messages: [
        { id: 'c1', author: 'Daniel', timestamp: '9:22 AM', body: 'the migration is blocked on the interop bump', conversationId: 'c1', repliesNotRead: 4 },
        { id: 'c2', author: 'Juan', timestamp: '11:04 AM', body: 'lunch?', conversationId: 'c2', repliesNotRead: 2 },
        { id: 'c3', author: 'Katerina', timestamp: '2:15 PM', body: 'we decided to postpone the migration until Thursday', conversationId: 'c3', repliesNotRead: 0 },
      ],
    },
  }

  async function askTopic(question = 'what did we decide about the migration') {
    open(acrossConversations)
    await userEvent.type(input(), question)
    await userEvent.click(await screen.findByText(/Ask about this conversation/i))
  }

  it('offers to answer with no thread open and no composer', async () => {
    // The gap: a topic detail page has neither, and used to offer nothing.
    open(acrossConversations)
    await userEvent.type(input(), 'what did we decide')

    expect(await screen.findByText(/Ask about this conversation/i)).toBeInTheDocument()
    // Draft still needs somewhere to put a reply, and correctly stays away.
    expect(screen.queryByText(/Draft a reply/i)).not.toBeInTheDocument()
  })

  it('cites messages from more than one conversation', async () => {
    promptForText.mockResolvedValue('Blocked on interop [1], postponed to Thursday [3].')
    await askTopic()

    expect(await screen.findByTestId('answer')).toBeInTheDocument()
    expect(sources()).toHaveTextContent('Daniel')
    expect(sources()).toHaveTextContent('Katerina')
  })

  it('opens the conversation a citation points into, then scrolls', async () => {
    /*
      All but the open conversation are unmounted, so `scrollToMessage` finds
      nothing. Asking the topic view to open it is the difference between a
      citation that works and one that reports "not loaded" as its normal case.
    */
    scrollToMessage.mockReturnValue(false)
    promptForText.mockResolvedValue('Postponed to Thursday [3].')
    await askTopic()
    await screen.findByTestId('answer')

    await userEvent.click(sources().querySelectorAll('button')[0])
    expect(openConversation).toHaveBeenCalledWith('c3')
    expect(onClose).toHaveBeenCalled()
  })

  it('says how many replies it never read', async () => {
    /*
      At topic scale this is usually most of what was said. A silent omission
      here reads as "that is all there was" — the failure PEE-4 named.
    */
    promptForText.mockResolvedValue('Blocked on interop [1].')
    await askTopic()
    await screen.findByTestId('answer')

    // Every conversation fits under the budget, so all three were read: 4 + 2 + 0.
    expect(screen.getByText(/6 replies were not read/i)).toBeInTheDocument()
  })

  it('counts only the replies under conversations it actually read', async () => {
    /*
      A reply under a conversation the budget dropped is already inside the
      "did not fit" count, and counting it again would overstate the gap twice
      over. Forced with bodies too long to both fit — the topic-scale case the
      three-line fixture above cannot reach.
    */
    const long = 'the migration is blocked '.repeat(300)
    open({
      conversation: {
        references: [],
        messages: [
          { id: 'c1', author: 'Daniel', timestamp: '9:22 AM', body: long, conversationId: 'c1', repliesNotRead: 4 },
          { id: 'c2', author: 'Juan', timestamp: '11:04 AM', body: long, conversationId: 'c2', repliesNotRead: 99 },
        ],
      },
    })
    await userEvent.type(input(), 'migration')
    await userEvent.click(await screen.findByText(/Ask about this conversation/i))
    await screen.findByTestId('answer')

    expect(screen.getByText(/did not fit/i)).toBeInTheDocument()
    expect(screen.queryByText(/103 replies/i)).not.toBeInTheDocument()
  })
})
