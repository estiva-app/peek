/**
 * CONCEPT — Insights, Journal and Risks in Peek (prototype issue 009bc509; concept/insights-journal-risks). Peek's real
 * frame, Topics column and message card; Mark as… comes in through the card's one concept-only hook. Never merged.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { PeoplePageView } from '@/pages/PeoplePage'
import { PeekFrame } from '@/layouts/PeekFrame'
import { Conversation, DeciderTopicsColumn, TopicFrame } from './PeekMessages'
import { DAY, HOUR, marked, type StoryMessage } from './messages'
import { CLAUDE, KATERINA, MIKY, PROJECT } from './fixtures'

const noop = () => {}

// Universal Navigation, in the words said there (fixtures.ts; the Leaf page of real examples, 16 Nov).
const sidebar: StoryMessage = { id: 'm1', author: MIKY, ago: 6 * DAY + 2.6 * HOUR, text: 'One thing I’m not happy about is the sidebar navigation in Ship and Leaf. My brother called out immediately the inconsistencies.' }
const belongs: StoryMessage = { id: 'm2', author: KATERINA, ago: 3 * DAY, text: 'I can’t find where the file belongs to. Nothing is selected on the left panel.' }
const names: StoryMessage = { id: 'm3', author: MIKY, ago: 3 * DAY - 0.4 * HOUR, text: 'Initiatives for cross-app work, Topics for team rooms — Katerina to judge on the prototype.' }
const teamsAndTopics: StoryMessage = { id: 'm4', author: KATERINA, ago: 2 * HOUR, text: 'Let’s go with Teams and Topics at the top and drop Folders from the sidebar completely.' }
const whatIsNew: StoryMessage = { id: 'm5', author: MIKY, ago: 1.3 * HOUR, text: 'What is new in Ship and Leaf needs more thinking before we build it.' }

const BELONGS_INSIGHT = marked('Insight', 'Nothing on the left says where an open file belongs', MIKY)
const SIDEBAR_DECISION = marked('Decision', 'The sidebar shows Teams and Topics, never Folders', MIKY)

// Friday Meetings: Miky's notes, marked as an Insight and accepted; Katerina's remark, marked as a Concern and Rejected.
const FRIDAY: StoryMessage[] = [
  {
    id: 'f1',
    author: MIKY,
    ago: 38 * DAY,
    text: 'Meeting notes … we discussed the annoyance caused by being member of many Ship issues… we see at least 3 types of topics (people, work, places). Anything I missed?',
    mark: marked('Insight', 'Being a member of many Ship issues is an annoyance', MIKY, 'accepted'),
  },
  { id: 'f2', author: KATERINA, ago: 33 * DAY, text: 'The list is getting long, but it’s fine for now.', mark: marked('Concern', 'Peek’s topic list is too long', MIKY, 'rejected') },
]

const universal = (marks: Record<string, StoryMessage['mark']> = {}) =>
  [sidebar, belongs, names, teamsAndTopics, whatIsNew].map((m) => ({ ...m, mark: marks[m.id] }))

const meta = {
  title: 'Concept/Insights, Journal and Risks',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, { parameters }) => (
      <MemoryRouter initialEntries={[(parameters.route as string | undefined) ?? '/app/topics']}>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <Story />
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * Bubble up: Miky's question about the names grew a thread. Katerina's decision and Miky's concern in it were marked,
 * so they show under his message in the topic's feed as a timeline; the plain replies between are said quietly.
 */
export const ThreadBubblesUp: Story = { render: () => <BubbleUp /> }
/** The timeline pressed: the whole thread opens in the right column, every reply, the marked ones with their labels (Miky, 18 Nov). */
export const ThreadBubblesUpOpen: Story = { render: () => <BubbleUp open="m3" /> }

function BubbleUp({ open }: { open?: string }) {
  return (
    <TopicFrame>
      <Conversation
        openThread={open}
        title="Universal Navigation"
        about={PROJECT}
        messages={[
          sidebar,
          {
            ...names,
            replies: [
              { id: 'r1', author: KATERINA, ago: 2.9 * DAY, text: 'Topics is fine. Initiatives feels big for a two-week project.' },
              { id: 'r2', author: MIKY, ago: 2.8 * DAY, text: 'An initiative holds several projects; a project stays a project.' },
              { id: 'r3', author: KATERINA, ago: 2 * HOUR, text: teamsAndTopics.text, mark: SIDEBAR_DECISION },
              { id: 'r4', author: MIKY, ago: 1.8 * HOUR, text: 'Agreed.' },
              { id: 'r5', author: MIKY, ago: 1.3 * HOUR, text: whatIsNew.text, mark: marked('Concern', 'Ship and Leaf “what is new” needs more thinking', MIKY, 'accepted') },
              { id: 'r6', author: KATERINA, ago: 1 * HOUR, text: 'I’ll draw the sidebar first.' },
            ],
          },
          { ...belongs, mark: BELONGS_INSIGHT },
        ]}
      />
    </TopicFrame>
  )
}

/** Miky looks at: Katerina's message marked by him as an Insight wears "Insight" beside its time; every other message's ⋯ offers Mark as ▸. */
export const TopicWithAnInsight: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} messages={universal({ m2: BELONGS_INSIGHT })} />
    </TopicFrame>
  ),
}

/** Miky looks at: the same message as Katerina sees it, signed in as her; resting on the line reads "Insight · … · marked by Miky". */
/**
 * Its label pressed (Miky, 19 Nov: option A): the Insight opens in the column a thread opens in, as in Leaf and Ship.
 * Its fields, its source, then its own conversation and box: the talk that shapes it, apart from any thread. ✕ closes.
 * A label on a reply inside an open thread does the same, with ← back to that thread (ThreadBubblesUpOpen).
 */
export const LabelOpensItem: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} messages={universal({ m2: BELONGS_INSIGHT })} openItem="m2" />
    </TopicFrame>
  ),
}

/**
 * Sent before the model answered (Miky, 19 Nov: suggesting never blocks sending). Its answer lands on the sent message:
 * sure about Miky's last one, so it is marked as a Concern at once with Undo (a delete, nothing left behind); unsure
 * about his earlier one, so "Decision?" is only offered under it, one press to mark, and it fades if ignored.
 */
export const SuggestedAfterSend: Story = {
  render: () => (
    <TopicFrame>
      <Conversation
        title="Universal Navigation"
        about={PROJECT}
        messages={universal({ m2: BELONGS_INSIGHT }).map((m) =>
          m.id === whatIsNew.id ? { ...m, suggested: { word: 'Concern' as const, sure: true } } : m.id === names.id ? { ...m, suggested: { word: 'Decision' as const, sure: false } } : m,
        )}
      />
    </TopicFrame>
  ),
}

/**
 * Katerina deleted the Insight Miky marked on her message (Miky, 19 Nov: anyone may delete a highlight). The topic
 * shows nothing where it was; Miky, its marker, is told in his Topics column, and the line opens it, read only, with
 * who deleted it and why. Nobody else sees it, and agents no longer read it.
 */
export const DeletedHighlightIsTold: Story = {
  render: () => (
    <PeekFrame
      leftPanel={<DeciderTopicsColumn title={BELONGS_INSIGHT.title} ago={HOUR / 4} by={KATERINA} verb="deleted your Insight" />}
      rightPanel={
        <Conversation
          title="Universal Navigation"
          about={PROJECT}
          messages={universal()}
          deleted={{ message: belongs.id, mark: BELONGS_INSIGHT, by: KATERINA, reason: 'Not an insight, I was only venting.' }}
        />
      }
    />
  ),
}

export const TopicWithAnInsightAsKaterina: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} me={KATERINA} messages={universal({ m2: BELONGS_INSIGHT })} />
    </TopicFrame>
  ),
}

/** Miky looks at: a marked message's ⋯ (Katerina's, marked as an Insight) says Open Insight and Unmark, not Mark as. */
export const MarkedMessageMenu: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} messages={[belongs, names].map((m) => ({ ...m, mark: m.id === 'm2' ? BELONGS_INSIGHT : undefined }))} />
    </TopicFrame>
  ),
}

/**
 * Miky looks at: Katerina's "The list is getting long" was marked as a Concern and the Concern was Rejected, so her
 * message has no line (and its ⋯ offers Mark as again); his accepted Insight above it keeps its amber line.
 */
export const RejectedItemLeavesNoLine: Story = {
  render: () => (
    <TopicFrame selected={1}>
      <Conversation title="Friday Meetings" about={PROJECT} messages={FRIDAY} />
    </TopicFrame>
  ),
}

/** Miky looks at: in a DM with Katerina (only the two of them read it, unlike any team) the ⋯ has no Mark as row at all. */
export const PrivateDmOffersNoMark: Story = {
  parameters: { route: '/app/people/katerina' },
  render: () => (
    <PeoplePageView
      loading={false}
      starred={[]}
      people={[
        { id: 'katerina', name: KATERINA.name, isUnread: false, isUrgent: false, canHide: true },
        { id: 'claude', name: CLAUDE.name, isUnread: false, isUrgent: false, canHide: true },
      ]}
      selectedId="katerina"
      onHideDm={noop}
      rightPanel={
        <Conversation
          title={KATERINA.name}
          dm
          privateRoom
          messages={[
            { id: 'd1', author: KATERINA, ago: 5 * HOUR, text: 'I can’t find where the file belongs to. Nothing is selected on the left panel.' },
            { id: 'd2', author: MIKY, ago: 4 * HOUR, text: 'Same for me. Let’s say it in Universal Navigation so it can be marked there.' },
          ]}
        />
      }
    />
  ),
}

/**
 * Miky looks at: Katerina is told once that he wrote a Decision in her name, the way a mention tells her today — the
 * Universal Navigation row lights in her Topics column, and resting on it opens its card with the line "Miky wrote a
 * decision in your name · The sidebar shows Teams and Topics, never Folders", which opens the Journal entry. She is
 * in Friday Meetings meanwhile; her message in Universal Navigation carries the blue line (Every type once).
 */
export const DeciderIsTold: Story = {
  render: () => (
    <PeekFrame
      leftPanel={<DeciderTopicsColumn title={SIDEBAR_DECISION.title} ago={HOUR / 3} />}
      rightPanel={<Conversation title="Friday Meetings" about={PROJECT} me={KATERINA} messages={FRIDAY} />}
    />
  ),
}

/** Miky looks at: each type's line once — an Insight (amber), a Decision (blue, Journal) and a Concern (red, Risks). */
export const EveryTypeOnce: Story = {
  render: () => (
    <TopicFrame>
      <Conversation
        title="Universal Navigation"
        about={PROJECT}
        messages={universal({ m2: BELONGS_INSIGHT, m4: SIDEBAR_DECISION, m5: marked('Concern', 'Ship and Leaf “what is new” needs more thinking', MIKY, 'open') })}
      />
    </TopicFrame>
  ),
}

/**
 * Trial (Miky, 19 Nov): one message highlighted, not sorted yet (grey; its ⋯ offers Sort as ▸ the seven words), and one
 * marked as a To-do (green), which Ship then lists under the project's Scope to decide. Mark as ▸ on any other message
 * lists the seven words with Highlight apart below them.
 */
export const HighlightAndToDo: Story = {
  render: () => (
    <TopicFrame>
      <Conversation
        title="Universal Navigation"
        about={PROJECT}
        messages={universal({ m3: marked('Highlight', 'Initiatives for cross-app work, Topics for team rooms', MIKY), m5: marked('To-do', 'Think through what is new in Ship and Leaf before building it', KATERINA, 'open') })}
      />
    </TopicFrame>
  ),
}

/**
 * Trial (Miky, 19 Nov): mark as you write. In the box, type `?` alone on the first line and press Enter: the line goes
 * and Question sits at the message's start. Or press Ctrl/⌘ + . anywhere in the box and type a symbol (`!` `*` `?`
 * `[]` `=` `:` `~` `!!`) or pick a row. This one starts already marked.
 */
export const MarkAsYouWrite: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} typedStart="Question" messages={universal({ m2: BELONGS_INSIGHT })} />
    </TopicFrame>
  ),
}

/**
 * The second trial (Miky, 19 Nov): the same marking, its heading above the box rather than inside it, and the box's
 * border in the word's colour, a property on top of the message. Marking halfway through moves no text; ✕ or
 * Backspace at the start takes it off.
 */
export const MarkAsYouWriteAbove: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} typedStart="Question" typedAbove messages={universal({ m2: BELONGS_INSIGHT })} />
    </TopicFrame>
  ),
}

/** Miky looks at: the moment he highlights a message without a word: where it went, and that it waits to be sorted. */
export const JustHighlighted: Story = {
  render: () => (
    <TopicFrame>
      <Conversation title="Universal Navigation" about={PROJECT} notice="Highlight" messages={universal({ m3: marked('Highlight', 'Initiatives for cross-app work, Topics for team rooms', MIKY) })} />
    </TopicFrame>
  ),
}

/** Miky looks at: the notice the moment he marks a message (here as a Question): where it went, and Open. */
export const JustMarked: Story = {
  render: () => (
    <TopicFrame>
      <Conversation
        title="Universal Navigation"
        about={PROJECT}
        notice="Question"
        messages={universal({ m3: marked('Question', 'Initiatives for cross-app work, Topics for team rooms — Katerina to judge on the prototype', MIKY) })}
      />
    </TopicFrame>
  ),
}
