import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ListColumn } from '@estiva-app/ui'
import { AppShell } from './AppShell'
import { useRailClosed } from './railClosed'

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <span className="text-caption text-text-muted">{label}</span>
    </div>
  )
}

/** A page's list column as the pages draw it: the package's `ListColumn`, closing with the rail. */
function ListPanel() {
  const railClosed = useRailClosed()
  return (
    <ListColumn title="List" collapsed={railClosed}>
      <Placeholder label="Left panel (list)" />
    </ListColumn>
  )
}

const meta = {
  title: 'Navigation/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <MemoryRouter initialEntries={['/people']}>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <Story />
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    // A page hands the frame its list column, which draws itself (UIG-14, N9).
    leftPanel: <ListPanel />,
    rightPanel: <Placeholder label="Conversation area" />,
  },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The app frame: nav rail + left panel + conversation area inside the rounded app card,
 * with the top bar overlaid. Click the top-left menu button to collapse the rail + left panel.
 */
export const Default: Story = {}

/** With the right-hand thread panel slot filled. */
export const WithThreadPanel: Story = {
  args: {
    threadPanel: <Placeholder label="Thread panel" />,
  },
}
