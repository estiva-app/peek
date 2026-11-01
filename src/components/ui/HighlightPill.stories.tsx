import type { Meta, StoryObj } from '@storybook/react-vite'
import { HIGHLIGHT_META, type HighlightType } from '@/api'
import { HighlightPill, HighlightSwatch } from './HighlightPill'

const HIGHLIGHT_TYPES = Object.keys(HIGHLIGHT_META) as HighlightType[]

const meta = {
  title: 'Deprecated/HighlightPill',
  component: HighlightPill,
  args: {
    type: 'insight',
  },
  argTypes: {
    type: { control: 'inline-radio', options: HIGHLIGHT_TYPES },
  },
} satisfies Meta<typeof HighlightPill>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** All five highlight types. */
export const AllTypes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-2">
      {HIGHLIGHT_TYPES.map(type => (
        <HighlightPill key={type} type={type} />
      ))}
    </div>
  ),
}

/** Swatch-only form, as used in the compose slash-menu and highlight picker. */
export const Swatches: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-2">
      {HIGHLIGHT_TYPES.map(type => (
        <div key={type} className="flex items-center gap-1">
          <HighlightSwatch type={type} />
          <span className="text-caption text-text-secondary">{type}</span>
        </div>
      ))}
    </div>
  ),
}
