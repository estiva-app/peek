import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { PeekDataProvider } from '@/api'
import { AddToOpenWorkDialog } from './AddToOpenWorkDialog'

const noop = () => {}

/*
  The data seam, once, as a decorator — a story hands over args and nothing
  else. Wrapping inside each story's `render` was markup written in a story
  file, which is the thing these pages are meant to stop.
*/
const decorators = [(Story: () => ReactNode) => <PeekDataProvider>{Story()}</PeekDataProvider>]


/**
 * The Desk "+" picker: topics not already in Open work, unresolved first,
 * multi-selected via checkboxes (click anywhere on a row).
 */
const meta = {
  title: 'Screener & Desk/AddToOpenWorkDialog',
  component: AddToOpenWorkDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  decorators,
  args: {
    onAdd: noop,
    onClose: noop,
  },
} satisfies Meta<typeof AddToOpenWorkDialog>

export default meta
type Story = StoryObj<typeof meta>

/** The primary button stays disabled until something is selected, and counts
 *  the picks once it is. */
export const Default: Story = {}
