import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ScreenerPreviewRow } from '@/api'
import { ScreenerPreviewCardView } from './ScreenerPreviewCard'

/**
 * The Screener hover preview — what the card holds. The card itself is the
 * package's `PreviewCard` (P27): the surface, the 360px, the padding, the
 * 300px cap and the scrollbar are its, and `ScreenerItem` opens it. The
 * decorator below is that box's size and padding, so the rows are read at the
 * width they are read at in the app.
 *
 * The triggering message sits flush; replies are indented with a left border.
 *
 * (Previews are backend-only — with none, the row is drawn without a card at
 * all — so the rows are storied on their own rather than through a hover.)
 */
const SAMPLE: ScreenerPreviewRow[] = [
  {
    authorName: 'Juan Foley',
    timestamp: '9:14 AM',
    kind: 'message',
    body: "Our CI/CD pipeline has been failing at the build stage since this morning — it can't resolve some dependencies during the Docker image build.",
  },
  {
    authorName: 'Priya Nair',
    timestamp: '9:20 AM',
    kind: 'reply',
    body: 'Looks like the Docker base image moved — pinning it now.',
  },
  {
    authorName: 'You',
    timestamp: '9:22 AM',
    kind: 'reply',
    body: "Thanks — I'll re-run the build once that lands.",
  },
]

const meta = {
  title: 'Screener & Desk/ScreenerPreviewCard',
  component: ScreenerPreviewCardView,
  decorators: [
    (Story) => (
      <div className="flex w-[360px] flex-col gap-3 rounded-lg border border-border-default bg-bg-elevated p-3 shadow-lg">
        <Story />
      </div>
    ),
  ],
  args: { isTopicResolved: () => false },
  argTypes: { isTopicResolved: { control: false }, rows: { control: false } },
} satisfies Meta<typeof ScreenerPreviewCardView>

export default meta
type Story = StoryObj<typeof meta>

/** Message + two replies. */
export const Default: Story = { args: { rows: SAMPLE } }

/** Loading — the skeleton shown while the preview query is in flight. */
export const Loading: Story = { args: { rows: undefined } }
