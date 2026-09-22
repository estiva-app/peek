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

/** A followed file with an unread comment (FOL-34) — the tree's glyph, the file's title,
 *  the comment as the preview. No hover card: a file's conversation is not in Convex. */
export const FileItem: Story = {
  args: {
    item: {
      id: 'sc_file_30840:0000:story',
      kind: 'file',
      address: '30840:0000:story',
      fileKind: 30840,
      title: 'Q4 hiring plan',
      preview: 'Pushed the headcount numbers into the sheet — can you check the design row before Friday?',
    },
  },
}

/** A file that is not a bare-file topic — a Ship issue — draws the file glyph. */
export const ForeignFileItem: Story = {
  args: {
    item: {
      id: 'sc_file_30851:0000:story',
      kind: 'file',
      address: '30851:0000:story',
      fileKind: 30851,
      title: 'Relay refuses the ICC profile',
      preview: 'Reproduced on production with the re-encoded bytes.',
    },
  },
}
