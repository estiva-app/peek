import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { SCREENER_ITEMS } from '@/api/fixtures'
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
 * It had never been drawn in Storybook: the card reads the conversation, and
 * with no backend `useScreenerPreview` returns nothing, so `ScreenerItem`
 * refused to open a card on an empty box. A caller that brings its own rows has
 * something to say, so this one hands them over (UIG-17).
 *
 * The card waits 350ms, which is `PreviewCard`'s own default — this story waits
 * for it rather than assuming.
 */
export const HoverPreview: Story = {
  args: {
    preview: (
      <ScreenerPreviewCardView
        isTopicResolved={() => false}
        rows={[
          {
            kind: 'message',
            authorName: 'Juan Foley',
            timestamp: '9:14 AM',
            body: "Our CI/CD pipeline has been failing at the build stage since this morning. Logs show it can't resolve some dependencies during the Docker image build step.",
          },
          {
            kind: 'reply',
            authorName: 'Daniel Stanton',
            timestamp: '9:22 AM',
            body: 'Found the root cause — a dependency bump broke the build. Pinning it back now.',
          },
          {
            kind: 'reply',
            authorName: 'Alice Johnson',
            timestamp: '9:41 AM',
            body: 'Confirmed green on my end.',
          },
        ]}
      />
    ),
  },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByText('Updates on the new office layout'))
    // The card portals out of the story root, so it is found through the body.
    await expect(await within(document.body).findByText(/Found the root cause/, undefined, { timeout: 3000 })).toBeVisible()
  },
}
