import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { TopicsColumnView } from './TopicsColumn'

/**
 * Peek's Topics column (TOP-4): your topics with their files under them, one
 * level deep, then "Other topics" to open and join. The fixture is Miky's
 * Widgets topic as production lists it on 2 November, beside two topics with
 * nothing listed. The look is the agent's lean from the Per app prototype,
 * for Katerina to polish.
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
const build1 = file(30850, 'build-1', 'Widgets 2: build 1')
const build2 = file(30850, 'build-2', 'Widgets 2: build 2')
const testing = file(30851, 'testing', 'Testing Widgets')
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

/** Widgets with its three files, one unread; the open file selected under it. */
export const YourTopics: Story = {
  args: {
    state: {
      mine: [
        { topic: release, files: [], archivedFiles: [] },
        { topic: speed, files: [], archivedFiles: [] },
        { topic: widgets, files: [build1, build2, testing], archivedFiles: [] },
      ],
      others,
      archived,
    },
    unread: { [testing.ref]: true },
    selectedRef: build2.ref,
  },
}

/**
 * Widgets as on Miky's workspace on 2 November: both builds are finished and
 * archived, so they wait behind its "Archived" line, which opens them in a
 * dialog; only Testing Widgets is a row of its own.
 */
export const ArchivedFiles: Story = {
  args: {
    state: {
      mine: [
        { topic: speed, files: [], archivedFiles: [] },
        { topic: widgets, files: [testing], archivedFiles: [build1, build2] },
      ],
      others,
      archived,
    },
  },
}

/** Joined nothing yet: the other topics are there to open and join. */
export const NoneJoined: Story = { args: { state: { mine: [], others, archived: [] } } }

/** An archived topic open: "Archived" opens onto its row. */
export const ArchivedOpen: Story = {
  args: { state: { mine: [{ topic: widgets, files: [build1], archivedFiles: [] }], others, archived }, selectedRef: archived[0]!.ref },
}

/** Every topic archived: none active, and the archived ones still there to open. */
export const OnlyArchived: Story = { args: { state: { mine: [], others: [], archived } } }

/** No topic at all. */
export const Empty: Story = { args: { state: { mine: [], others: [], archived: [] } } }

export const Loading: Story = { args: { state: 'loading' } }
