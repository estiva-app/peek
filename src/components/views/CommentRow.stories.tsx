import type { Meta, StoryObj } from '@storybook/react-vite'
import type { People } from '@estiva-app/interop'
import { IconMessage } from '@tabler/icons-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { CommentRow } from './CommentRow'

/**
 * One comment on a file another app owns — the row the conversation pane and
 * the thread pane both draw (FOL-19).
 *
 * It is one component precisely so a reply and the comment it answers look
 * alike: they are the same kind of thing, and drawing them differently would
 * say they are not.
 */
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const now = Math.floor(Date.now() / 1000)

const PEOPLE: People = { [CATH]: { displayName: 'Cath' } }

const meta = {
  title: 'Views/CommentRow',
  component: CommentRow,
  parameters: { layout: 'centered' },
  args: {
    comment: {
      id: 'c1',
      author: CATH,
      body: 'The route has to resolve a child by address, not against the listing.',
      createdAt: now - 3600,
    },
    people: PEOPLE,
  },
  decorators: [
    Story => (
      <div className="w-[360px] bg-bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommentRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * An author with no published `kind:0`. A shortened key, never "Unknown" —
 * which twice over would make two people look like one.
 */
export const Unnamed: Story = {
  args: { comment: { id: 'c2', author: SHIP, body: 'Filed.', createdAt: now - 120 } },
}

/**
 * The conversation pane's thread control, in the slot it actually uses.
 *
 * Under the body, labelled, counted. It was an unlabelled icon in the `actions`
 * slot until FOL-25, and what that cost is written on `ForeignConversationView`.
 */
export const WithThread: Story = {
  args: {
    below: (
      <Button variant="muted" size="small" leadingIcon={<IconMessage size={14} stroke={1.5} />}>
        3 replies
      </Button>
    ),
  },
}

/** The actions slot: the row's right edge, on the name's line. */
export const WithActions: Story = {
  args: {
    actions: (
      <IconButton tooltip="Copy link" aria-label="Copy link">
        <IconMessage size={16} stroke={1.5} />
      </IconButton>
    ),
  },
}

/** The manner the conversation pane uses for the comment whose thread is open. */
export const Highlighted: Story = {
  args: { className: '-mx-2 rounded-md bg-bg-inset px-2 py-1.5' },
}
