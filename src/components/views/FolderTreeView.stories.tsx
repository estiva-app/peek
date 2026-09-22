import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { FolderTreeView } from './FolderTree'

/**
 * The left column as the Folder tree (FOL-21): the Folders the person is in,
 * each a fold, the one holding the open page open.
 *
 * The fixture is the five team Folders FOL-20 leaves on production. What a
 * story can show is the column's shape — the folds, the union dots, which one
 * is open — because a Folder's rows are a relay read made when its fold
 * opens, and Storybook has no viewer, so the open Folder here reads as empty.
 * The rows themselves are `FileTreeView`'s story.
 */
const folders = [
  { id: '925897ad-796e-4bc6-999c-ca19df26c4aa', name: 'Peek', hasState: true },
  { id: '3789d2ca-103c-40e5-906f-0490782db5fd', name: 'Ship', hasState: true },
  { id: '85db5b59-9e49-4ea1-8e93-3d2a2d78c048', name: 'Estiva HQ', hasState: true },
  { id: '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f', name: 'Leaf', hasState: true },
  { id: '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', name: 'Steer', hasState: true },
]

const meta = {
  title: 'Views/FolderTree',
  component: FolderTreeView,
  args: {
    folders,
    signedOut: false,
    unread: {},
    onSelect: () => {},
    onOpenFolder: () => {},
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        {/* The list column's width and insets, as `FolderTree` draws them. */}
        <div className="flex w-[290px] flex-col gap-0.5 bg-bg-surface px-3 py-4">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof FolderTreeView>

export default meta
type Story = StoryObj<typeof meta>

/** Every Folder folded: what a cold load costs nothing beyond the dots. */
export const Folded: Story = {
  args: { unread: { [folders[1].id]: true, [folders[3].id]: true } },
}

/** The Folder holding the open page is open; the others are as they were. */
export const CurrentOpen: Story = {
  args: { currentFolder: folders[0].id, unread: { [folders[1].id]: true } },
}

export const Loading: Story = {
  args: { folders: null },
}

export const SignedOut: Story = {
  args: { folders: null, signedOut: true },
}

export const Empty: Story = {
  args: { folders: [] },
}
