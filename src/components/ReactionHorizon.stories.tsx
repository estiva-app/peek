import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReactionHorizon } from './ReactionHorizon'

/**
 * The one line a container gains once it holds more messages and replies than
 * the reaction horizon (SPEC §6.6). Nothing on production is over the cap yet,
 * so this is the only place the line can be seen today — which is the point of
 * the story: the day a container crosses 100, the caption has already been
 * rendered and measured.
 */
const meta = {
  title: 'Topics/ReactionHorizon',
  component: ReactionHorizon,
  decorators: [
    Story => (
      <div className="w-[720px] max-w-full px-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReactionHorizon>

export default meta
type Story = StoryObj<typeof meta>

/** A container 14 past the horizon — the shape every reader will meet first. */
export const Fourteen: Story = { args: { omitted: 14 } }

/** The singular, because "1 older ones were" is the kind of thing a story catches. */
export const One: Story = { args: { omitted: 1 } }

/** Under the cap there is nothing to explain, so nothing is drawn — not an empty line. */
export const Nothing: Story = { args: { omitted: 0 } }

/**
 * The same line under a DM (DMS-5). The cap is per container and a DM now has
 * one, so the noun changes and nothing else does.
 */
export const InAConversation: Story = { args: { omitted: 14, container: 'conversation' } }
