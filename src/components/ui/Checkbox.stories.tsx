import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  args: { checked: false },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

/** Unchecked at rest — hairline-strong border, fills with the accent on check. */
export const Unchecked: Story = {}

export const Checked: Story = {
  args: { checked: true },
}

export const Disabled: Story = {
  args: { checked: true, disabled: true },
}

/** Interactive — click to toggle (the component is controlled; state lives here). */
export const Toggleable: Story = {
  render: () => {
    const [checked, setChecked] = useState(false)
    return <Checkbox checked={checked} onChange={setChecked} aria-label="Toggle me" />
  },
}
