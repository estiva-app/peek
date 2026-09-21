import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { NavRail } from './NavRail'

const meta = {
  title: 'Navigation/NavRail',
  component: NavRail,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, ctx) => (
      <MemoryRouter initialEntries={[ctx.parameters.route ?? '/app/people']}>
        <LastSelectionProvider>
          <div className="bg-bg-base h-[260px] flex">
            <Story />
          </div>
        </LastSelectionProvider>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof NavRail>

export default meta
type Story = StoryObj<typeof meta>

/** The full left navigation rail — Desk / Topics / People. People is the active route here. */
export const Default: Story = {}

/** Desk active. */
export const DeskActive: Story = {
  parameters: { route: '/app/desk' },
}
