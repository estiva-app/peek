import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { CommandLauncher } from './CommandLauncher'

/**
 * The Cmd/Ctrl+K launcher — the Intelligence modal's human face.
 *
 * Three levels, one input: global (Ship and Peek as drillable apps), app
 * scope (the app's declared actions), and the form step (an object-creating
 * action drawn as a form — see Launcher/Action form for every form on its
 * own).
 *
 * The component portals a full-viewport backdrop, so each story IS the open
 * modal. Esc/backdrop clicks call a no-op close here.
 */
const meta = {
  title: 'Launcher/Command launcher',
  component: CommandLauncher,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // A search result row navigates (PEE-4), so the launcher needs a router.
    (Story) => (
      <MemoryRouter initialEntries={['/desk']}>
        <PeekDataProvider>
          <div className="h-[560px] bg-bg-default">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    context: {},
    onClose: () => {},
  },
} satisfies Meta<typeof CommandLauncher>

export default meta
type Story = StoryObj<typeof meta>

/** The global level: search default plus the two Estiva apps. */
export const Global: Story = {}

/** Drilled into Ship: its declared actions, chip in the input. */
export const ShipScope: Story = {
  args: { initialAppId: 'ship' },
}

/** Drilled into Peek. */
export const PeekScope: Story = {
  args: { initialAppId: 'peek' },
}

/** The form step: Ship → Create issue, open inside the launcher chrome. */
export const CreateIssueForm: Story = {
  args: { initialAppId: 'ship', initialActionId: 'add-issue' },
}
