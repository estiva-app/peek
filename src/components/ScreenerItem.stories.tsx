import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { SCREENER_ITEMS, SCREENER_PREVIEW_ROWS } from '@/api/fixtures'
import { ScreenerItem } from './ScreenerItem'
import { ScreenerPreviewCardView } from './ScreenerPreviewCard'

const noop = () => {}

const meta = {
  title: 'Screener & Desk/ScreenerItem',
  component: ScreenerItem,
  decorators: [
    Story => (
      <PeekDataProvider>
        <div className="w-[300px]">
          <Story />
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    item: SCREENER_ITEMS[0],
    onOpen: noop,
    onLater: noop,
    onDismiss: noop,
    /*
      On the meta, so hovering *any* of these stories opens the card — not only
      the one written to prove it (Katerina, 23 September). The real card reads
      the conversation, which needs a backend, so a story that hands over
      nothing shows nothing on hover and reads as a broken behaviour.
    */
    preview: <ScreenerPreviewCardView isTopicResolved={() => false} rows={SCREENER_PREVIEW_ROWS} />,
  },
  argTypes: {
    item: { control: false },
  },
} satisfies Meta<typeof ScreenerItem>

export default meta
type Story = StoryObj<typeof meta>

/** A topic item — topic status icon + title, two-line preview, Open / Later / ✕ Dismiss. */
export const TopicItem: Story = {}

/** A DM item — sender avatar + name. */
export const PersonItem: Story = {
  args: { item: SCREENER_ITEMS[1] },
}

/**
 * **Hovering a row opens the preview card** — the Screener line is only a
 * snippet, so hovering shows more of the actual conversation (asked for on
 * 2026-07-09).
 *
 * Every story here opens it, because the rows are on the meta. This one is the
 * proof: it hovers the row and waits for the card, rather than leaving a
 * behaviour nobody checks.
 *
 * The card waits 350ms, which is `PreviewCard`'s own default — this story waits
 * for it rather than assuming.
 */
export const HoverPreview: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByText('Updates on the new office layout'))
    // The card portals out of the story root, so it is found through the body.
    await expect(
      await within(document.body).findByText(/base image moved/, undefined, { timeout: 3000 }),
    ).toBeVisible()
  },
}
