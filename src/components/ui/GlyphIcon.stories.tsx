import type { Meta, StoryObj } from '@storybook/react-vite'
import { GlyphIcon } from './GlyphIcon'

const meta = {
  title: 'Topics/GlyphIcon',
  component: GlyphIcon,
  args: { glyph: 'issue', size: 14 },
  argTypes: {
    glyph: { control: 'inline-radio', options: ['topic', 'project', 'issue', 'file', 'message'] },
    size: { control: 'inline-radio', options: [14, 16] },
  },
} satisfies Meta<typeof GlyphIcon>

export default meta
type Story = StoryObj<typeof meta>

/** At 14px, as a reference chip wears it. */
export const Default: Story = {}

/** Every glyph at the chip's 14px and the list row's 16px. */
export const AllGlyphs: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3 text-text-secondary">
      {([14, 16] as const).map((size) => (
        <div key={size} className="flex items-center gap-4">
          {(['topic', 'project', 'issue', 'file', 'message'] as const).map((glyph) => (
            <div key={glyph} className="flex flex-col items-center gap-1.5">
              <GlyphIcon glyph={glyph} size={size} />
              <span className="text-caption text-text-muted">{glyph}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}
