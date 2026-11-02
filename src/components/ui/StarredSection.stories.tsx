import type { Meta, StoryObj } from '@storybook/react-vite'
import { StarredSection, type StarredItem } from './StarredSection'

const ITEMS: StarredItem[] = [
  { id: 'alice', name: 'Alice Johnson' },
  { id: 'juan', name: 'Juan Foley', isUnread: true },
  { id: 'hallie', name: 'Hallie Pratt', isUnread: true, isUrgent: true },
]

const meta = {
  title: 'Frame/StarredSection',
  component: StarredSection,
  render: args => (
    <div className="w-72">
      <StarredSection {...args} />
    </div>
  ),
} satisfies Meta<typeof StarredSection>

export default meta
type Story = StoryObj<typeof meta>

/** No starred items — guidance copy. Click the header to collapse. */
export const Empty: Story = {}

export const Populated: Story = {
  args: { items: ITEMS },
}

/** The person whose conversation is open is the current row. A click opens a person's page, through the app's router. */
export const WithSelection: Story = {
  args: { items: ITEMS, selectedId: 'alice' },
}
