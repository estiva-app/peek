import type { Meta, StoryObj } from '@storybook/react-vite'
import { SCREENER_PREVIEW_ROWS } from '@/api/fixtures'
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
export const Default: Story = { args: { rows: SCREENER_PREVIEW_ROWS } }

/** Loading — the skeleton shown while the preview query is in flight. */
export const Loading: Story = { args: { rows: undefined } }
