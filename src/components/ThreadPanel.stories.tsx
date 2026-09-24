import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { REPLIES } from '@/api/fixtures'
import type { ConversationData } from '@/api'
import { ThreadPanel, ThreadPanelLoading } from './ThreadPanel'

const conversation: ConversationData = {
  id: 't1_c1',
  authorName: 'Juan Foley',
  timestamp: '9:14 AM',
  body: "Hey everyone, our CI/CD pipeline has been failing at the build stage since this morning. Logs show it can't resolve some dependencies during the Docker image build step.",
}

const replies = REPLIES['t1_c1']

const noop = () => {}

const meta = {
  title: 'Frame/ThreadPanel',
  component: ThreadPanel,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <MemoryRouter>
        <PeekDataProvider>
          <div className="h-[620px] w-[380px] border border-border-subtle bg-bg-surface">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    conversation,
    replies,
    sentReplies: [],
    onClose: () => {},
    onSendReply: () => {},
  },
  argTypes: {
    conversation: { control: false },
    replies: { control: false },
    sentReplies: { control: false },
  },
} satisfies Meta<typeof ThreadPanel>

export default meta
type Story = StoryObj<typeof meta>

/** The thread panel: the pinned original message, a "Replies" divider, the reply cards, and a reply composer. */
export const Default: Story = {}

/** Resolved conversation — the header shows a green "Resolved". */
export const Resolved: Story = {
  args: { isResolved: true },
}

/**
 * Huddle thread — lock icon + member pill in the header, and the button that
 * jumps to the matching DM.
 *
 * That button is drawn only when a caller hands over `onOpenInDm`, which is
 * the huddle side and nothing else. No story passed it, so it had never been
 * drawn (23 September). `openInDmHref` comes with it on purpose: it is a real
 * link, so a modified click opens the DM in a new tab (UIG-14, 4.13).
 */
export const Huddle: Story = {
  args: {
    huddleMembers: ['You', 'Daniel Stanton', 'Juan Foley'],
    huddleMemberCount: 3,
    onOpenInDm: noop,
    openInDmHref: '/app/people/alice',
  },
}

/**
 * **The panel while the thread you switched to is still arriving.**
 *
 * `ThreadPanelLoading`, which had no story at all until UIG-17. It is not a
 * nicety: rendering `null` through that beat tears the column down and reads
 * as the thread closing and reopening — and on a deployed build the beat
 * happens on *every* switch, because remote-only messages have no local copy.
 *
 * Same chrome as the real panel, and the skeleton waits 200ms, so a fast
 * switch shows nothing at all.
 */
export const Loading: StoryObj = {
  render: () => <ThreadPanelLoading onClose={() => {}} />,
}
