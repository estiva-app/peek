import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { MenuPanel } from '@estiva-app/ui'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { ActivityCardContent } from './ActivityCard'
import { ActivityScreen, PlaceList } from './ActivityScreen'
import { danielDm, navigation, release, roadmap, speed, teamPages, widgets, type ActivityItem, type Place } from './fixtures'
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
 * drawn as a blue dot whose card also lists the orange (Miky, 10 Nov). Roadmap: a long list. Speed and Onboarding:
 * nothing new, so no dot and no card. Leave a row and its orange is seen: Widgets' dot goes; Release notes keeps its blue.
 */
export const TopicsBlueWins: Story = { name: 'Topics: the dot explains itself', args: { column: 'topics', look: 'blue-wins' } }

/**
 * Teams: each team's chat, spaces and topics with their own dots; the team's name has none, and opens the team's page
 * with the whole team's list. Design's chat: a new conversation. Reviews: both. Engineering's chat: orange only.
 */
export const Teams: Story = { name: 'Teams: a team’s chat and spaces', args: { column: 'teams', look: 'blue-wins' } }

/**
 * People: Katerina's DM is orange (she reacted 👍 to your message). Daniel's is urgent and has a reaction: the urgent
 * mark wins, its card lists both. Ana's: a new message. Petr's: nothing.
 */
export const People: Story = { name: 'People: DMs, one urgent with a reaction', args: { column: 'people', look: 'blue-wins' } }

/**
 * Widgets' page after the hover: nothing new, so the dot beside its title is a quiet ring. Hover it: Katerina's 👍,
 * which the row's hover cleared, is under Earlier with Daniel's from yesterday.
 */
export const PageAfterTheHover: Story = {
  name: 'A topic’s page: after the hover cleared the orange',
  args: { column: 'topics', open: 'widgets', cleared: widgets.items.map((i) => i.id) },
}

/** Roadmap's page while ten things are new: the dot beside the title is blue; its list holds all ten. */
export const PageLong: Story = { name: 'A topic’s page: a long list', args: { column: 'topics', open: 'roadmap' } }

/** Design's page, opened from the team's name: the dot beside its title lists everything under the team, each line saying where. */
export const PageTeam: Story = { name: 'A team’s page', args: { column: 'teams', open: 'team:Design' } }

/** Speed's page: nothing has happened yet; the ring's list says so. */
export const PageEmpty: Story = { name: 'A topic’s page: nothing yet', args: { column: 'topics', open: 'speed' } }

/**
 * A phone or tablet: there is no hover, so no card on the row. Tapping the row opens the place; its own conversation
 * is on screen, so its orange is seen and what was said there is read. Blue on a listed file stays until that file is
 * opened. Tapping the dot beside the title opens its list.
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

function ListAlone({ place, cleared = [] }: { place: Place; cleared?: string[] }) {
  return (
    <div className="p-6">
      <MenuPanel className="w-[360px] p-1">
        <PlaceList place={place} cleared={new Set(cleared)} />
      </MenuPanel>
    </div>
  )
}

/** The list behind the dot beside a page's title, without hovering. */
export const ListAfterTheHover: StoryObj<typeof ListAlone> = {
  name: 'Page list: after the hover',
  render: () => <ListAlone place={widgets} cleared={widgets.items.map((i) => i.id)} />,
}
export const ListTeam: StoryObj<typeof ListAlone> = { name: 'Page list: a team', render: () => <ListAlone place={teamPages[0]!} /> }
export const ListEmpty: StoryObj<typeof ListAlone> = { name: 'Page list: nothing yet', render: () => <ListAlone place={speed} /> }

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
