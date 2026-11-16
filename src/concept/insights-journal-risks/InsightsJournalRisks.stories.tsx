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
export const ThreadBubblesUp: Story = {
  render: () => (
    <TopicFrame>
      <Conversation
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
  ),
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
