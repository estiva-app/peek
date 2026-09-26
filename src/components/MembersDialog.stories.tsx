import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { PeekDataProvider } from '@/api'
import { MembersDialog } from './MembersDialog'

const noop = () => {}

const memberNames = ['You', 'Alice Johnson', 'Jake Walter', 'Zack Bright', 'Amie Miles']

/*
  The data seam, once, as a decorator — a story hands over args and nothing
  else. Wrapping inside each story's `render` was markup written in a story
  file, which is the thing these pages are meant to stop.
*/
const decorators = [(Story: () => ReactNode) => <PeekDataProvider>{Story()}</PeekDataProvider>]


/**
 * Who is in a topic, and — for a member — the layer that adds more. Two
 * capabilities on one surface, which is why the roster and the add layer are
 * the same dialog rather than two.
 */
const meta = {
  title: 'To be removed/MembersDialog',
  component: MembersDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  decorators,
  args: {
    memberNames,
    onInvite: noop,
    onClose: noop,
  },
} satisfies Meta<typeof MembersDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Opened from the members pill: the roster with the "Add members" row on top
 *  (the viewer is a member). Clicking it slides to the add layer. */
export const Roster: Story = {
  args: { canAdd: true },
}

/** As a non-member: read-only roster — the add affordance lives behind the
 *  Join banner instead (capability rule). */
export const AsANonMember: Story = {}

/** The add layer (also where the empty-topic banner lands directly): back
 *  arrow returns to the roster; suggestions appear only once you type. */
export const AddLayer: Story = {
  args: { canAdd: true, initialView: 'add' },
}
