import type { Meta, StoryObj } from '@storybook/react-vite'
import { PeekDataProvider } from '@/api'
import { SCREENER_ITEMS } from '@/api/fixtures'
import { ScreenerItem } from './ScreenerItem'

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
