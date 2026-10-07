import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDotsVertical } from '@tabler/icons-react'
import { Toolbar, ToolbarButton } from '@estiva-app/ui'
import { SidePanelButton } from './SidePanelButton'

/** The file header's button that shows and hides the Overview column. Pressed while it is shown. Click it. */
const meta = {
  title: 'Folders/SidePanelButton',
  component: SidePanelButton,
  args: { open: true, onToggle: () => {} },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open)
    return (
      <Toolbar aria-label="File actions" surface={false}>
        <SidePanelButton open={open} onToggle={() => setOpen((o) => !o)} />
        <ToolbarButton tooltip="More actions" aria-label="More actions">
          <IconDotsVertical size={16} stroke={1.5} />
        </ToolbarButton>
      </Toolbar>
    )
  },
} satisfies Meta<typeof SidePanelButton>

export default meta
type Story = StoryObj<typeof meta>

/** The column shown: pressed. */
export const Shown: Story = {}

/** The column hidden. */
export const Hidden: Story = { args: { open: false } }
