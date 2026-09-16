import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

/**
 * The launcher (Cmd/Ctrl+K) — Peek's rows and levels in the package's
 * `CommandPalette` (UIG-29).
 *
 * Storybook has no relay and no signed-in viewer, so what needs one is absent
 * here: no app declares an action, and message search finds nothing. The
 * levels, the keys, the search over topics and people, recents and Ask, Draft
 * and Make are all Peek's real code. Forms have their own stories under
 * Launcher/Action form.
 *
 * The component is the open window; Esc and a click outside call a no-op close.
 */
const meta = {
  title: 'Launcher/Command launcher',
  component: CommandLauncher,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // A result row navigates (PEE-4), a message result hands the topic view a
    // message to open at, and creating says so in a toast.
    (Story) => (
      <MemoryRouter initialEntries={['/desk']}>
        <PeekDataProvider>
          <LastSelectionProvider>
            <ToastProvider>
              <div className="h-[560px]">
                <Story />
              </div>
            </ToastProvider>
          </LastSelectionProvider>
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

/** Opened with nothing open: recents, then the apps. Type to search topics and people. */
export const Global: Story = {}

/**
 * Opened while replying in a thread: Ask, Draft a reply and Suggest what to
 * make come first. The model answers nothing in Storybook, which is what the
 * launcher then says.
 */
export const FromAThread: Story = {
  args: {
    context: {
      composer: { label: 'Reply to Amie', isFocused: true, hasDraft: false },
      conversation: {
        references: [],
        messages: [
          { id: 'r1', author: 'Amie', timestamp: '9:02 AM', body: 'The build broke on main after the interop bump.' },
          { id: 'r2', author: 'Bruno', timestamp: '9:05 AM', body: 'I can pin interop to 0.22 until the fix lands.' },
        ],
      },
    },
  },
}

/**
 * Inside Peek — which publishes no actions, so the note is the whole answer
 * (INT-9). It used to list two forms that closed without publishing.
 */
export const PeekScope: Story = {
  args: { initialAppId: 'peek' },
}
