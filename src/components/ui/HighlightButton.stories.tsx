import { useRef } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { EditorContent, useEditor } from '@tiptap/react'
import { peekEditorExtensions } from '@/extensions/peekEditor'
import { Toolbar } from '@estiva-app/ui'
import { PeekDataProvider } from '@/api'
import { HighlightButton } from './HighlightButton'

/**
 * The highlighter, and the five kinds a message can be marked as.
 *
 * It used to live inside `ComposeBox`, which meant a message could be marked
 * when it was written and never afterwards — the edit boxes kept a highlight
 * on save and had no control to change one. All three boxes call this now.
 *
 * The picker hangs off the **box**, not off the button: its bottom edge sits
 * 4px above the box's top, left edges flush. That is where the composer has
 * always put it, and it is what the package's `Menu` does by itself when the
 * room below an anchor is smaller than the panel. Below the box is where it
 * goes when the room is down there instead — an edit box halfway down a list.
 *
 * The story stands the box near the foot of a tall canvas so the picker opens
 * upward here the way it does in the app.
 */
function Box({ withText }: { withText?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const editor = useEditor({
    extensions: peekEditorExtensions,
    content: withText ? '<p>Pinning the dependency back to 3.22 fixed it.</p>' : '<p></p>',
    editorProps: {
      attributes: { class: 'outline-none w-full bg-transparent text-body-2 text-text-primary min-h-[20px]' },
    },
  })
  return (
    <div className="flex min-h-[520px] w-[560px] items-end">
      <div
        ref={boxRef}
        className="relative w-full rounded-lg border border-border-default bg-bg-inset p-3 flex flex-col gap-4"
      >
        <EditorContent editor={editor} />
        {/* The button is a ToolbarButton since 2026-09-11 (§4.2), and Base UI
            throws for a toolbar part with no strip around it. This is the strip
            all three composers draw, so the story shows it as it is used. */}
        <Toolbar aria-label="Compose tools" surface={false} className="flex items-center gap-1">
          <HighlightButton editor={editor} container={boxRef} />
        </Toolbar>
      </div>
    </div>
  )
}

/** The button needs an editor and the box it hangs from, so the stories stand
 *  up a small one rather than passing props at it. */
const meta = {
  title: 'Messages/Composer/HighlightButton',
  component: Box,
  decorators: [
    Story => (
      <PeekDataProvider>
        <Story />
      </PeekDataProvider>
    ),
  ],
} satisfies Meta<typeof Box>

export default meta
type Story = StoryObj<typeof meta>

/** The button as it sits in a toolbar row: one icon, nothing open. */
export const Default: Story = {}

/**
 * Open. Five kinds, each with its own swatch, in the order Katerina set them:
 * Insight, Concern, Conclusion, Question, Summary.
 *
 * Escape and a click outside both close it, and neither is written here — the
 * package's `Menu` owns both exits.
 */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Highlight' }))
    // The panel portals to the body, so query the document rather than the canvas.
    const doc = within(canvasElement.ownerDocument.body)
    await expect(await doc.findByText('Insight')).toBeInTheDocument()
    await expect(doc.getByText('Summary')).toBeInTheDocument()
  },
}

/**
 * Picked. The tag goes in at the head of the message and the picker closes;
 * the caret never left the editor, because the row acts on the press with the
 * default prevented.
 */
export const Picked: Story = {
  args: { withText: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Highlight' }))
    const doc = within(canvasElement.ownerDocument.body)
    await userEvent.click(await doc.findByText('Concern'))
    await expect(within(canvasElement).getByText('Concern')).toBeInTheDocument()
  },
}
