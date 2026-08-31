import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '../../interop/projection'
import { PeekDataProvider } from '@/api'
import { TOPICS } from '@/api/fixtures'
import { LAUNCHER_APPS } from '@/lib/launcherActions'
import { ActionFormPanel } from './ActionFormPanel'
import { ThreadReplyCard } from './ThreadReplyCard'
import { ForeignObjectCard } from './ui/ForeignObjectWidget'

/**
 * The launcher's form step: an object-creating action drawn as a form.
 *
 * Every field here comes from a manifest-shaped declaration
 * (`lib/launcherActions.ts`) — `string` → text input, `text` → textarea,
 * `enum` → Select over the owning app's declared vocabulary, `pubkey` →
 * person picker, `parent` → the object the new one hangs under. RFC 0.4
 * §13.4 is the contract: "an action whose `input.type` is `object` declares
 * `properties` and `required`, and a consumer draws a form."
 *
 * Submitting validates and reports values upward; nothing publishes until
 * the Intelligence runtime lands (the seam is `CommandLauncher.submitAction`).
 */
const ship = LAUNCHER_APPS.find((a) => a.id === 'ship')!
const peek = LAUNCHER_APPS.find((a) => a.id === 'peek')!

const addIssue = ship.actions.find((a) => a.id === 'add-issue')!
const addProject = ship.actions.find((a) => a.id === 'add-project')!
const say = peek.actions.find((a) => a.id === 'say')!
const createTopic = peek.actions.find((a) => a.id === 'create-topic')!

/** The demo topics, exactly as the launcher passes them in the app. */
const topicOptions = TOPICS.filter((t) => !t.isResolved).map((t) => ({
  value: t.id,
  label: t.title,
}))

const meta = {
  title: 'Launcher/Action form',
  component: ActionFormPanel,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <PeekDataProvider>
        {/* The launcher shell this panel sits inside (width and chrome). */}
        <div className="w-[658px] bg-bg-elevated border border-border-default rounded-lg shadow-lg overflow-hidden">
          <Story />
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    app: ship,
    action: addIssue,
    onSubmit: () => {},
  },
} satisfies Meta<typeof ActionFormPanel>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Ship → Create issue, the worked example. Title and Project are what Ship's
 * manifest declares today; Status and Assignee are this design's proposal for
 * what the declaration should grow.
 */
export const ShipCreateIssue: Story = {}

/** The same form filled the way a person would leave it before submitting. */
export const ShipCreateIssueFilled: Story = {
  args: {
    initialValues: {
      title: 'Empty state for the files panel is missing',
      project: 'files-and-sharing',
      status: 'todo',
    },
  },
}

/** Ship → Create project — proposed whole: Ship declares no add-project yet. */
export const ShipCreateProject: Story = {
  args: { action: addProject },
}

/**
 * Peek → Start a conversation. The topic picker is LIVE in the app (the
 * launcher passes `useTopics()`); the story passes the same demo list.
 */
export const PeekStartConversation: Story = {
  args: {
    app: peek,
    action: say,
    parentOptions: { topic: topicOptions },
  },
}

export const PeekCreateTopic: Story = {
  args: { app: peek, action: createTopic },
}

/**
 * What submitting is FOR — the end state in Peek once the runtime lands.
 *
 * The created issue's `nostr:naddr…` reference goes into the reply, and
 * `MessageBody` already renders any such reference through
 * `ForeignObjectWidget`. Storybook has no relay to resolve against, so this
 * story draws the resolved card directly beneath the reply — the exact
 * composition the app produces once the reference resolves.
 */
const PERSON = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

const justCreated: ForeignObject = {
  address: `30851:${PERSON}:fee-12`,
  naddr: 'naddr1qqjxxcny8yexydp495enjces956x2vec95uk2ety94nxydeexc6nver9xycrz',
  kind: 30851,
  widget: 'card',
  appName: 'Estiva Ship',
  slots: {
    title: { value: 'Empty state for the files panel is missing', field: 'title' },
    subtitle: { value: 'FEE-12' },
    status: { label: 'Status', value: 'Todo', colour: 'neutral', field: 'status' },
  },
  meta: [{ label: 'Assignee', value: PERSON, isPubkey: true, field: 'assignee' }],
  people: { [PERSON]: { displayName: 'Amie Miles' } },
  comments: [],
  folder: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
  openUrl: 'https://ship.estiva.app/#/issue/fee-12',
  actions: [],
  viaRecommendation: true,
}

export const AfterCreateInReply: Story = {
  render: () => (
    <div className="flex flex-col gap-2 p-4 bg-bg-default">
      <ThreadReplyCard
        authorName="Alice Johnson"
        timestamp="2:14 PM"
        body="Good catch — filed it in Ship so it doesn't get lost:"
      />
      <div className="pl-11">
        <ForeignObjectCard object={justCreated} />
      </div>
    </div>
  ),
}
