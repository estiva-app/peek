import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { MenuPanel } from '@estiva-app/ui'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { ActivityCardContent } from './ActivityCard'
import { ActivityScreen } from './ActivityScreen'
import { danielDm, navigation, release, roadmap, widgets, type ActivityItem } from './fixtures'
import { FollowWords } from './FollowWords'

/**
 * Peek's screens of "Activity indicator on each topic and team", a prototype
 * on the `concept/activity-indicator` branch only (it never merges). Drawn on
 * Peek's own frame and rows on main; only what the project changes is
 * changed. Read me first.
 */
const meta = {
  title: 'Prototype/Activity indicator/Screens',
  component: ActivityScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, { args }) => (
      <MemoryRouter initialEntries={[args.column === 'people' ? '/app/people' : args.column === 'teams' ? '/app/folders' : '/app/topics']}>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <ToastProvider>
                <Story />
              </ToastProvider>
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof ActivityScreen>
export default meta
type Story = StoryObj<typeof meta>

/**
 * Rest the pointer on a row with a dot. Navigation: blue only. Widgets: orange only. Release notes and Roadmap: both,
 * drawn as a blue dot whose card also lists the orange. Roadmap: a long list. Speed and Onboarding: nothing, so no dot.
 * Leave a row and its orange is seen: Widgets' dot goes; Release notes keeps its blue.
 */
export const TopicsBlueWins: Story = { name: 'Topics: when both, blue wins', args: { column: 'topics', look: 'blue-wins' } }

/** The same, but a row with both draws a blue dot with an orange ring. Compare Release notes and Roadmap. */
export const TopicsRing: Story = { name: 'Topics: when both, an orange ring', args: { column: 'topics', look: 'ring' } }

/**
 * Teams: each team's chat, spaces and topics with their own dots; the team's name has none. Design's chat: a new
 * conversation. Reviews: both. Engineering's chat: orange only (Daniel reacted to your message).
 */
export const Teams: Story = { name: 'Teams: a team’s chat and spaces', args: { column: 'teams', look: 'blue-wins' } }

/**
 * People: Katerina's DM is orange (she reacted 👍 to your message). Daniel's is urgent and has a reaction: the urgent
 * mark wins, its card lists both. Ana's: a new message. Petr's: nothing.
 */
export const People: Story = { name: 'People: DMs, one urgent with a reaction', args: { column: 'people', look: 'blue-wins' } }

/**
 * After the hover: Widgets open with its For you. Katerina's 👍, which the hover cleared, is under Earlier with Daniel's
 * from yesterday. The bell in the header opens and closes it; the card's last line opens it too.
 */
export const ForYouAfterTheHover: Story = {
  name: 'For you: after the hover cleared the orange',
  args: { column: 'topics', open: 'widgets', forYou: true, cleared: widgets.items.map((i) => i.id) },
}

/** Roadmap's For you while ten things are new: the card shows five, and "5 more in For you" opens this. */
export const ForYouLong: Story = { name: 'For you: a long list', args: { column: 'topics', open: 'roadmap', forYou: true } }

/** Speed's For you: nothing has lit it. */
export const ForYouEmpty: Story = { name: 'For you: nothing yet', args: { column: 'topics', open: 'speed', forYou: true } }

/**
 * A phone or tablet: there is no hover, so no card. Tapping the row opens the place; its own conversation is on screen,
 * so its orange is seen and what was said there is read. Blue on a listed file stays until that file is opened. What
 * lit it is in its For you, under the bell.
 */
export const Touch: Story = { name: 'On a touch screen: opening clears the orange', args: { column: 'topics', touch: true } }

// --- The card alone, without hovering -----------------------------------------------------------

function CardAlone({ items }: { items: ActivityItem[] }) {
  return (
    <div className="p-6">
      <MenuPanel className="w-[360px] p-1">
        <ActivityCardContent items={items} onForYou={() => {}} />
      </MenuPanel>
    </div>
  )
}

/** The card on its own, as the hover shows it: each state without having to hover. */
export const CardBlueOnly: StoryObj<typeof CardAlone> = { name: 'Card: blue only', render: () => <CardAlone items={navigation.items} /> }
export const CardOrangeOnly: StoryObj<typeof CardAlone> = { name: 'Card: orange only', render: () => <CardAlone items={widgets.items} /> }
export const CardBoth: StoryObj<typeof CardAlone> = { name: 'Card: both', render: () => <CardAlone items={release.items} /> }
export const CardUrgentDm: StoryObj<typeof CardAlone> = { name: 'Card: an urgent DM with a reaction', render: () => <CardAlone items={danielDm.items} /> }
export const CardLong: StoryObj<typeof CardAlone> = { name: 'Card: a long list', render: () => <CardAlone items={roadmap.items} /> }

// --- The follow switch's words --------------------------------------------------------------------

function Switches({ place = 'topic', today = false }: { place?: 'topic' | 'chat'; today?: boolean }) {
  return (
    <div className="p-6">
      <FollowWords level="important" place={place} today={today} />
    </div>
  )
}

/** A topic's switch, open at Important, with the new words under Not following, Important and All. */
export const SwitchNewWords: StoryObj<typeof Switches> = { name: 'Follow switch: new words on a topic', render: () => <Switches /> }
/** A team's chat: it lists no files, so its words say only what lights. */
export const SwitchChat: StoryObj<typeof Switches> = { name: 'Follow switch: new words on a team’s chat', render: () => <Switches place="chat" /> }
/** Today's words, for comparison. */
export const SwitchToday: StoryObj<typeof Switches> = { name: 'Follow switch: today', render: () => <Switches today /> }
