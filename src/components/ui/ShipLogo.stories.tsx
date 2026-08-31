import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShipLogoMark } from './ShipLogo'

/**
 * A PLACEHOLDER mark for Ship, drawn for the command launcher's app rows
 * because Ship ships no icon anywhere (2026-08-31). Takes its color from the
 * `text-logo` token like the Peek marks — toggle the theme to see both.
 * Replace the glyph in `ShipLogo.tsx` when Ship gets a real identity.
 */
const meta = {
  title: 'Primitives/ShipLogo',
  component: ShipLogoMark,
  parameters: { layout: 'centered' },
  argTypes: { height: { control: { type: 'range', min: 16, max: 96, step: 4 } } },
} satisfies Meta<typeof ShipLogoMark>

export default meta
type Story = StoryObj<typeof meta>

export const Mark: Story = { args: { height: 24 } }

/** The size run the launcher and future app rows draw from. */
export const Sizes: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-end gap-4">
      {[16, 20, 24, 32, 40].map((s) => (
        <ShipLogoMark key={s} height={s} />
      ))}
    </div>
  ),
}
