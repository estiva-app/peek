import { useCallback, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PEOPLE } from '@/api'
import { SuggestionPopover } from '@/extensions/SuggestionPopover'
import { MentionMenu } from './MentionMenu'

/**
 * The menu draws rows and nothing else since D47 — the box, its placement and
 * its scrolling are the package `Popover`'s, which the extension opens against
 * the caret. So the story opens the same shell against a marker standing in
 * for the caret, rather than drawing a panel of its own that no longer exists
 * in the app.
 */
function InTheShell({ children }: { children: React.ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const caret = useCallback((el: HTMLDivElement | null) => {
    setRect(el ? el.getBoundingClientRect() : null)
  }, [])
  return (
    <div className="flex h-[560px] items-end justify-start p-4">
      <div ref={caret} className="text-body-2 text-text-secondary">
        the caret is here
      </div>
      <SuggestionPopover rect={rect} width="w-[658px]" maxHeight="max-h-[360px]" ariaLabel="People">
        {children}
      </SuggestionPopover>
    </div>
  )
}

const meta = {
  title: 'Messages/Composer/MentionMenu',
  component: MentionMenu,
  args: {
    people: PEOPLE.slice(0, 5),
    highlight: 0,
    isUrgent: false,
    onSelect: () => {},
    onHighlightChange: () => {},
  },
  argTypes: {
    people: { control: false },
  },
  render: function Render(args) {
    const [highlight, setHighlight] = useState(args.highlight)
    return (
      <InTheShell>
        <MentionMenu {...args} highlight={highlight} onHighlightChange={setHighlight} />
      </InTheShell>
    )
  },
} satisfies Meta<typeof MentionMenu>

export default meta
type Story = StoryObj<typeof meta>

/** The @-mention dropdown; the highlighted row shows the Enter hint. */
export const People: Story = {}

/** Triggered by !@ — same list, "Urgent mention" header. */
export const Urgent: Story = {
  args: { isUrgent: true },
}

export const SingleMatch: Story = {
  args: { people: PEOPLE.slice(0, 1) },
}
