import type { Meta, StoryObj } from '@storybook/react-vite'
import { PeekDataProvider } from '@/api'
import { AddToOpenWorkDialog } from './AddToOpenWorkDialog'

const meta = {
  title: 'Screener & Desk/AddToOpenWorkDialog',
  component: AddToOpenWorkDialog,
  parameters: {
    layout: 'fullscreen',
    // Portals a fixed overlay to document.body — iframe it in Docs.
    docs: { story: { inline: false, height: '560px' } },
  },
  decorators: [
    // Topics + the open-work set come through the seam.
    Story => (
      <PeekDataProvider>
        <Story />
      </PeekDataProvider>
    ),
  ],
  args: {
    onAdd: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof AddToOpenWorkDialog>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The Desk "+" picker: topics not already in Open work, unresolved first,
 * multi-selected via checkboxes (click anywhere on a row). The primary
 * button stays disabled until something is selected and counts the picks.
 */
export const Default: Story = {}
