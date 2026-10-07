import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { NavTree, NavTreeSection } from '@estiva-app/ui'
import { JoinedFileRowsView } from './FileTreeView'

/**
 * One Folder's files in Topics, flat (Katerina and Miky, 7 October): every
 * file of yours is a row of its own, a topic, a sub-topic, a Ship project and
 * a Ship issue on the same level. Drawn under its Folder's heading, as the
 * column draws it. The data is invented.
 */
const ME = 'a1'.repeat(32)
const SHIP = 'b2'.repeat(32)
const at = (kind: number, owner: string, d: string) => `${kind}:${owner}:${d}`
const RELEASE = at(30840, ME, 'release-notes')
const CHECKLIST = at(30840, ME, 'release-checklist')
const PROJECT = at(30850, SHIP, 'payments-v2')
const ISSUE = at(30851, SHIP, 'card-form')
const CRASH = at(30840, ME, 'crash-android')
const PRICING = at(30840, ME, 'pricing-copy')

const file = (address: string, title: string, over: Partial<ForeignObject> = {}): ForeignObject =>
  ({
    ref: address,
    address,
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    kind: Number(address.split(':')[0]),
    appName: address.startsWith('3084') ? 'File' : 'Estiva Ship',
    widget: 'card',
    slots: { title: { value: title } },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
    ...over,
  }) as unknown as ForeignObject

/* In the listing's order, with the issue read by address placed after its project. */
const FILES = [
  file(RELEASE, 'Release notes 2.4'),
  file(CHECKLIST, 'Release checklist', { parentRef: RELEASE }),
  file(PROJECT, 'Payments v2'),
  file(ISSUE, 'Card form validation', { parentRef: PROJECT }),
  file(CRASH, 'Crash on launch, Android 14'),
  file(PRICING, 'Pricing page copy'),
]
/* Yours: everything but the project and the pricing topic. */
const MINE = new Set([RELEASE, CHECKLIST, ISSUE, CRASH])

const state = { id: 'mobile', name: 'Mobile app', hasState: true, source: 'state' as const, files: FILES }

const meta = {
  title: 'Folders/JoinedFileRowsView',
  component: JoinedFileRowsView,
  args: {
    state,
    files: FILES,
    filter: 'mine',
    isMember: (address: string) => MINE.has(address),
    unread: { [CRASH]: true, [ISSUE]: true },
    selectedRef: RELEASE,
    onSelect: () => {},
  },
  decorators: [
    (Story) => (
      // The list column's width and insets, and the Folder's heading over the rows, as Topics draws them.
      <div className="flex w-[290px] flex-col bg-bg-surface px-3 py-4">
        <NavTree>
          <NavTreeSection id="mobile" title="Mobile app" defaultOpen>
            <Story />
          </NavTreeSection>
        </NavTree>
      </div>
    ),
  ],
} satisfies Meta<typeof JoinedFileRowsView>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Topics: the four files of yours, one level. The sub-topic is beside its
 * parent, not under it; the issue is a row though its project is not yours.
 */
export const Topics: Story = {}

/** Topics filtered to Unread: only the files of yours with something new, and the open file. */
export const Unread: Story = { args: { filter: 'mine-unread' } }

/** An issue of yours is still being read, and nothing else here is yours: a row is coming. */
export const Waiting: Story = { args: { files: FILES.slice(2, 3), waiting: true, selectedRef: undefined } }

/** The Folder holds nothing of yours — the open file's Folder, shown for the open file's sake. */
export const NothingOfYours: Story = { args: { files: FILES.slice(5), selectedRef: undefined } }

export const Loading: Story = { args: { state: 'loading' } }

/** A refused read is not an empty Folder. */
export const Unreadable: Story = { args: { state: { failed: 'not_a_member' } } }
