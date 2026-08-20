import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Field } from './Field'
import { Select } from './Select'
import { TextInput } from './TextInput'

/**
 * A select drawn by Peek rather than by the operating system.
 *
 * The trigger is `TextInput`'s field, so a select and a text field sitting in
 * the same form are the same control with different contents. The menu is the
 * one every other menu in Peek uses.
 *
 * Open one and try the keyboard: arrows move, Home and End jump, Enter and Space
 * pick, Escape closes and puts focus back on the trigger. That is what a native
 * `<select>` gives away for free, and what has to be written by hand the moment
 * you stop using one.
 */
const meta = {
  title: 'Inputs/Select',
  component: Select,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  args: {
    value: 'in_progress',
    onChange: () => {},
    options: [
      { value: 'todo', label: 'Todo' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'done', label: 'Done' },
      { value: 'cancelled', label: 'Cancelled' },
    ],
    ariaLabel: 'Status',
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['default', 'small'] },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

/** Controlled, so the tick and the trigger follow what you pick. */
function Demo(props: Omit<React.ComponentProps<typeof Select>, 'value' | 'onChange'> & { initial?: string }) {
  const { initial = '', ...rest } = props
  const [value, setValue] = useState(initial)
  return <Select {...rest} value={value} onChange={setValue} />
}

/** Field height, matching `TextInput` — the size for a form. */
export const Default: Story = {
  render: (args) => <Demo {...args} initial="in_progress" />,
}

/**
 * Nothing chosen yet: the placeholder is muted, so an empty select does not read
 * as one already holding a value.
 */
export const Empty: Story = {
  render: (args) => <Demo {...args} initial="" placeholder="Choose a status…" />,
}

/**
 * The dense size, matching `Button`'s small.
 *
 * For property rows like the Files panel's, where a full-height field would
 * dominate the label beside it.
 */
export const Small: Story = {
  render: (args) => <Demo {...args} size="small" initial="todo" />,
}

/** In a `Field`, which is how a select appears in a form. */
export const InAField: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Field label="Status">
        <Demo {...args} initial="todo" />
      </Field>
      <Field label="Title" required>
        <TextInput placeholder="What is this about?" />
      </Field>
    </div>
  ),
}

/** Unavailable — the same disabled treatment as every other control. */
export const Disabled: Story = {
  render: (args) => <Demo {...args} initial="done" disabled />,
}

/**
 * Longer labels than the trigger is wide.
 *
 * The trigger truncates rather than growing, so a row of controls keeps its
 * shape; the menu takes the trigger's width as a minimum and grows past it.
 */
export const LongLabels: Story = {
  render: (args) => (
    <Demo
      {...args}
      initial="a"
      options={[
        { value: 'a', label: 'Everything that has ever happened in this workspace' },
        { value: 'b', label: 'Only the things an administrator did' },
      ]}
    />
  ),
}

/** Enough options to scroll — the menu caps its height rather than running off. */
export const ManyOptions: Story = {
  render: (args) => (
    <Demo
      {...args}
      initial="p3"
      options={Array.from({ length: 20 }, (_, i) => ({
        value: `p${i}`,
        label: `Project ${i + 1}`,
      }))}
    />
  ),
}
