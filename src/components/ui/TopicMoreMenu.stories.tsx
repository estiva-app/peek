import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDotsVertical } from '@tabler/icons-react'
import { IconButton } from './IconButton'
import { TopicMoreMenu } from './TopicMoreMenu'

/**
 * The one menu a topic has.
 *
 * There were two before, written a few files apart, and they had already
 * drifted: the sidebar row offered "Delete topic" and the conversation header
 * did not, so a topic could be deleted from the list but not from inside
 * itself. Both now render this, which is the only way that stops happening
 * again (PEE-2).
 *
 * Deliberately short. Star and the Folder link are already icons in the
 * conversation header, and repeating them here would lengthen the menu without
 * making either easier to reach (Katerina, 2026-08-19).
 *
 * Items appear only when the caller passes a handler for them, so the menu is
 * never a list of things that cannot happen here.
 *
 * The menu owns its trigger, so these canvases open on a press rather than
 * standing open: press the dots. Escape closes it and gives the button its
 * focus back.
 */
const meta = {
  title: 'Menus/Topic more menu',
  component: TopicMoreMenu,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[260px] justify-end p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    trigger: (
      <IconButton tooltip="More actions" aria-label="More actions">
        <IconDotsVertical size={16} stroke={1.5} />
      </IconButton>
    ),
    onOpenDetails: () => {},
    onToggleOpenWork: () => {},
    onDeleteTopic: () => {},
    openWorkAction: 'add' as const,
  },
} satisfies Meta<typeof TopicMoreMenu>

export default meta
type Story = StoryObj<typeof meta>

/** A topic not on your desk yet. */
export const Default: Story = {}

/**
 * Already on the desk.
 *
 * The label states the direction that will work, so the menu never offers an
 * action that is already true.
 */
export const OnOpenWork: Story = {
  args: { openWorkAction: 'remove' },
}

/**
 * Somewhere deleting is not on offer.
 *
 * Nothing is greyed out — the item is simply absent, which is the same rule the
 * details dialog uses for a name you cannot change.
 */
export const WithoutDelete: Story = {
  args: { onDeleteTopic: undefined },
}
