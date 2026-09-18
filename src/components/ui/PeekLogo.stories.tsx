import type { Meta, StoryObj } from '@storybook/react-vite'
import { PeekLogoMark, PeekLogoBadge } from './PeekLogo'

/**
 * The Peek brand marks. Both take their color from the `text-logo` token
 * (brand purple on light, white on dark) — toggle the theme to see both.
 */
const meta = {
  title: 'Primitives/PeekLogo',
  component: PeekLogoMark,
  parameters: { layout: 'centered' },
  argTypes: { height: { control: { type: 'range', min: 16, max: 96, step: 4 } } },
} satisfies Meta<typeof PeekLogoMark>

export default meta
type Story = StoryObj<typeof meta>

/** The badge mark alone (native 19×24). */
export const Mark: Story = { args: { height: 24 } }

/** The brand badge — mark on an `accent-muted` rounded square (as in the app + auth screen). */
export const Badge: StoryObj = { render: () => <PeekLogoBadge size={40} /> }

/** Both side by side, plus the badge size scale. */
export const AllMarks: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-8">
      <div className="flex items-end gap-8">
        <PeekLogoMark height={24} />
        <PeekLogoBadge size={40} />
      </div>
      <div className="flex items-center gap-4">
        {[24, 32, 40, 56].map(s => (
          <PeekLogoBadge key={s} size={s} />
        ))}
      </div>
    </div>
  ),
}
