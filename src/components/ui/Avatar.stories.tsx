import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

/**
 * Peek's Avatar draws nothing of its own — the package does that. What is
 * Peek's is **the lookup**, and the lookup is the only thing worth a story
 * here (Katerina, 21 September: a story that repeats the package's is not
 * worth writing).
 *
 * So these stories are the fall-back chain, which nothing else in Peek's
 * Storybook shows: a name Peek has a picture for, a name it does not, and no
 * name at all.
 */
const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  args: { size: 40 },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

/** A name Peek has a picture for: the seeded portrait. */
export const Portrait: Story = {
  args: { name: 'Alice Johnson' },
}

/**
 * A name Peek has **no** picture for. Bob Chen is a real person in the cast
 * with no portrait against his name, so this is the genuine second step rather
 * than an invented one: the package draws his initials on his own colour.
 */
export const Initials: Story = {
  args: { name: 'Bob Chen' },
}

/** No name at all — the silhouette, the last step of the chain. */
export const Silhouette: Story = {
  args: { name: undefined },
}

/** The whole chain at once, which is the picture that was missing. */
export const FallBack: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      {[
        { label: 'has a picture', name: 'Alice Johnson' as string | undefined },
        { label: 'no picture', name: 'Bob Chen' as string | undefined },
        { label: 'no name', name: undefined },
      ].map(({ label, name }) => (
        <div key={label} style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
          <Avatar {...args} name={name} />
          <span className="text-caption text-text-muted">{label}</span>
        </div>
      ))}
    </div>
  ),
}
