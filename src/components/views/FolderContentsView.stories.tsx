import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { FolderContentsView } from './FolderContentsView'

/**
 * One Folder's contents, drawn in Peek (RFC 0.4 §4, §5).
 *
 * The fixture below is three files of three kinds owned by three apps, and the
 * third is the point rather than decoration: a tide reading from an app nobody
 * wrote, whose widget chain is `["tideboard", "card"]`. No consumer implements
 * `tideboard`, so the chain falls back to `card` — RFC 0.4 §13.3 closes every
 * chain in one of card/row/table/stat precisely so there is always something
 * left to draw.
 *
 * A folder view that could only render Ship's kinds would look identical to
 * this one until the day a third app existed, which is why the fixture has one.
 */
const RELAY = 'f'.repeat(64)
const PERSON = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    ref: 'r',
    address: 'a',
    naddr: 'naddr1',
    eventId: 'e',
    kind: 30850,
    widget: 'card',
    appName: 'Estiva Ship',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: true,
    ...over,
  }) as ForeignObject

const FILES: ForeignObject[] = [
  file({
    ref: `30850:${PERSON}:proj`,
    kind: 30850,
    appName: 'Estiva Ship',
    // Ship declares `list: { children: { kind: 30851, via: 'a' } }` on a
    // project, so this row gets a disclosure and the topic below does not.
    listsChildren: true,
    slots: { title: { value: 'Payment integration' }, status: { value: 'In Progress' } },
  }),
  file({
    ref: `39000:${RELAY}:0212db6d-bcbf-40d0-890e-f4f056db2f5d`,
    kind: 39000,
    appName: 'Peek',
    slots: { title: { value: 'Feedback on Ship' } },
  }),
  file({
    ref: `30911:${RELAY}:spring`,
    kind: 30911,
    appName: 'Tide table',
    widget: ['tideboard', 'card'],
    slots: { title: { value: 'Spring tides' } },
  }),
]

const meta = {
  title: 'Views/FolderContentsView',
  component: FolderContentsView,
  decorators: [
    (Story) => (
      <div className="w-[560px] bg-bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FolderContentsView>

export default meta
type Story = StoryObj<typeof meta>

/** Three apps' files as peers, each drawn through its own manifest. */
export const ThreeApps: Story = {
  args: {
    state: { id: 'f1', name: 'Onboarding', hasState: true, source: 'state', files: FILES },
  },
}

/**
 * The approximation, and it says so.
 *
 * A Folder with no state event is read by containment — each file's own `h`
 * tag — which lists an app's records and **cannot list a topic**, because under
 * `h` a topic is the container rather than something inside it. The short list
 * is the only visible symptom, so the line above it is the whole explanation a
 * reader gets.
 */
export const NoFolderStateYet: Story = {
  args: {
    state: { id: 'f1', name: 'Onboarding', hasState: false, source: 'channel', files: [FILES[0]!] },
  },
}

/**
 * Empty, and deliberately indistinguishable from "empty for you".
 *
 * §4.2 drops a file the reader cannot see rather than marking it, because the
 * count is itself the disclosure — so a Folder with nothing in it and a Folder
 * whose contents this viewer may not read render the same way, on purpose.
 */
export const Empty: Story = {
  args: { state: { id: 'f1', name: 'Onboarding', hasState: true, source: 'state', files: [] } },
}

/**
 * A refused read is not an empty Folder.
 *
 * Kept apart because they looked alike once already: "no project linked to this
 * topic" was shown for a relay that had refused the read, which is the
 * ambiguity PEE-10 exists to remove. Same trap, one level up.
 */
export const CouldNotBeRead: Story = { args: { state: { failed: 'unreachable' } } }

/**
 * Not a member — a real answer, arrived at successfully.
 *
 * It says nothing about the relay being reachable, which is why the read path
 * keeps it out of the connection indicator. The view still cannot show
 * contents, so a reader sees the same sentence; the distinction is for the
 * layer deciding whether anything is wrong.
 */
export const NotAMember: Story = { args: { state: { failed: 'not_a_member' } } }

/** Still resolving. The relay read is an action, not a reactive query. */
export const Loading: Story = { args: { state: 'loading' } }

/**
 * Counts, and the two silences.
 *
 * The project has twelve messages and says so. The topic is **absent from the
 * map** — a Peek topic's messages carry `h` and no `a`, so it counts zero
 * however busy it is, and drawing "0" over a live conversation would be worse
 * than drawing nothing. The tide reading was never askable at all. Both stay
 * blank, for different reasons, and neither is a bug.
 */
export const WithMessageCounts: Story = {
  args: {
    state: { id: 'f1', name: 'Onboarding', hasState: true, source: 'state', files: FILES },
    counts: { [FILES[0]!.ref]: 12 },
    onSelect: () => {},
  },
}

/** At the cap, where the badge stops claiming an exact total. */
export const CountAtTheCap: Story = {
  args: {
    state: { id: 'f1', name: 'Onboarding', hasState: true, source: 'state', files: [FILES[0]!] },
    counts: { [FILES[0]!.ref]: 200 },
    onSelect: () => {},
  },
}
