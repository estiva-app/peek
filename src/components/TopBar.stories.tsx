import type { Meta, StoryObj } from '@storybook/react-vite'
import { ThemeProvider } from '@/lib/theme'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { TopBar } from './TopBar'

const meta = {
  title: 'Navigation/TopBar',
  component: TopBar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      // TopBar reads useTheme (avatar menu), useDebug (? menu), and useAuthActions
      // (sign-out) — the last needs PeekDataProvider's Convex-Auth context.
      <ThemeProvider>
        <DebugProvider>
          <PeekDataProvider>
            <div className="relative h-[160px] bg-bg-base">
              <Story />
            </div>
          </PeekDataProvider>
        </DebugProvider>
      </ThemeProvider>
    ),
  ],
  args: {
    onMenuToggle: () => {},
    onSearchClick: () => {},
  },
} satisfies Meta<typeof TopBar>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The top bar: menu toggle (collapses the shell), the Cmd/Ctrl+K search field (opens the command
 * launcher), the debug "?" (opens the scenario menu), and the avatar (opens the theme menu).
 * Click the avatar or "?" to open those menus.
 */
export const Default: Story = {}
