import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { TopicsColumnView } from './TopicsColumn'

/**
 * Peek's Topics column (TOP-4, TOPI-10): your topics as one flat list, newest
 * activity first, then Explore topics (TOPI-6). As the approved
 * prototype draws it (peek `concept/topics-level-up`).
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

const file = (kind: number, d: string, title: string): ForeignObject =>
  ({
    ref: `${kind}:${SHIP}:${d}`,
    address: `${kind}:${SHIP}:${d}`,
    kind,
    folder: 'f',
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: { title: { value: title } },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
  }) as unknown as ForeignObject

const widgets = file(30840, 'widgets', 'Widgets')
const release = file(30840, 'release', 'Release notes')
const speed = file(30840, 'speed', 'Speed')
const others = [file(30840, 'onboarding', 'Onboarding'), file(30840, 'hiring', 'Hiring')]
const archived = [file(30840, 'domain', 'Domain name - brainstorming'), file(30840, 'level-2', 'Level 2')]

const meta = {
  title: 'Folders/TopicsColumn',
  component: TopicsColumnView,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="flex h-[600px]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof TopicsColumnView>
export default meta
type Story = StoryObj<typeof meta>

/** Your topics flat, the one where something just happened on top and unread; the open one selected. */
export const YourTopics: Story = {
  args: {
    state: { mine: [widgets, release, speed], others, archived },
    unread: { [widgets.ref]: true },
    selectedRef: speed.ref,
  },
}

/** Explore topics open beside the column: its row is the current one (TOPI-6). */
export const Exploring: Story = { args: { state: { mine: [widgets, release, speed], others, archived }, exploring: true } }

/** Joined nothing yet: the empty line, above Explore topics, where the other topics are. */
export const NoneJoined: Story = { args: { state: { mine: [], others, archived } } }

/** No topic at all. */
export const Empty: Story = { args: { state: { mine: [], others: [], archived: [] } } }

export const Loading: Story = { args: { state: 'loading' } }
