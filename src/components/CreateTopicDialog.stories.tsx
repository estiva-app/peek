import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { PEOPLE, PeekDataProvider } from '@/api'
import { CreateTopicDialog } from './CreateTopicDialog'

const noop = () => {}

/*
  The data seam, once, as a decorator — a story hands over args and nothing
  else. Wrapping inside each story's `render` was markup written in a story
  file, which is the thing these pages are meant to stop.
*/
const decorators = [(Story: () => ReactNode) => <PeekDataProvider>{Story()}</PeekDataProvider>]


/**
 * Making a topic: a title, the people invited to it, and — when it grows out of
 * a direct message — what that costs the people already in it.
 */
const meta = {
  title: 'Topics/CreateTopicDialog',
  component: CreateTopicDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  decorators,
  args: {
    onConfirm: noop,
    onCancel: noop,
  },
} satisfies Meta<typeof CreateTopicDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Empty — the confirm button stays disabled until a title is entered. */
export const Empty: Story = {}

/** Pre-filled title and invitees — confirm enabled. */
export const Prefilled: Story = {
  args: { defaultTitle: 'Async export performance', defaultInvitees: [PEOPLE[0], PEOPLE[2]] },
}

/**
 * Started from a DM: the warning-bordered privacy banner explains the DM becomes a
 * private huddle inside the new (public) topic.
 */
export const FromADm: Story = {
  args: { defaultInvitees: [PEOPLE[0]], dmContext: { participants: [PEOPLE[0]] } },
}
