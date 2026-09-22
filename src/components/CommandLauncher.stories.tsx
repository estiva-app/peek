import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import type { LauncherContext } from '@/lib/launcherContext'
import { CommandLauncher } from './CommandLauncher'

const noop = () => {}

/** What a thread hands the launcher when it is opened from inside one. */
const thread = [
  { id: 'r1', author: 'Amie Miles', timestamp: '9:02 AM', body: 'morning all' },
  { id: 'r2', author: 'Daniel Stanton', timestamp: '9:22 AM', body: 'the migration is blocked on the interop bump' },
  { id: 'r3', author: 'Alice Johnson', timestamp: '9:41 AM', body: 'we decided to postpone the migration until Thursday' },
]

const nowhere: LauncherContext = {}
const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [], messages: thread },
}

/**
 * What Cmd/Ctrl+K opens (UIG-29).
 *
 * **It had no story anywhere until UIG-17** — 1,111 lines and nine test files,
 * and the only way to see it was to run the app. These are its resting states.
 *
 * The context is captured once, at the invoking keystroke, and frozen for the
 * launcher's lifetime, so what it acts on cannot change under somebody who is
 * typing into it. That is why it is a prop here rather than something the
 * launcher reads for itself.
 *
 * **The AI rows — Ask, Draft, Make — are not in these pictures.** They need a
 * one-time model download that no Storybook has, and they are hidden rather
 * than disabled when it is absent, on the same rule as the paperclip: an action
 * is offered only where it can succeed.
 */
const meta = {
  title: 'Overlays/CommandLauncher',
  component: CommandLauncher,
  parameters: { layout: 'fullscreen', docs: { story: { inline: false, height: '560px' } } },
  args: { context: nowhere, onClose: noop },
  argTypes: { context: { control: false } },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/topics/1']}>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <ToastProvider>
                <Story />
              </ToastProvider>
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof CommandLauncher>

export default meta
type Story = StoryObj<typeof meta>

/** Opened from nowhere in particular: the first level, nothing typed. */
export const Empty: Story = {}

/**
 * Opened from inside a conversation.
 *
 * The context it was handed is what the chip above the field names — where an
 * insert or an attach would land — and the thread's messages are the target
 * list a field-setting action reads (PEE-3).
 */
export const InAThread: Story = {
  args: { context: inThread },
}

/**
 * Typing.
 *
 * PEE-4's three corpora are searched on the first level only: inside an app the
 * results were never shown, and the relay was being asked anyway on every pause
 * (F9). Messages live on the relay and match whole tokens only, which is a real
 * difference and one `lib/launcherSearch` carries the wording for.
 *
 * This story types for you. **The panel portals out of the story root**, so the
 * field is found through `document.body` — `within(canvasElement)` reaches the
 * wrong tree, which is the same trap the ticket records for dialog stories.
 */
export const Searching: Story = {
  args: { context: inThread },
  play: async () => {
    const field = within(document.body).getByRole('combobox')
    await userEvent.click(field)
    await userEvent.type(field, 'migration')
    await expect(field).toHaveValue('migration')
  },
}
