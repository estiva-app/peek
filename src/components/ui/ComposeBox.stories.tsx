import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { ComposeBox } from './ComposeBox'

/**
 * The `/` menu and the selection toolbar both portal to the body and hang
 * above the caret, the way they do in the app where the composer sits at the
 * bottom of a topic. So the stories put the composer at the bottom of a tall
 * centred box — otherwise they render above the canvas and you see nothing.
 */
const meta = {
  title: 'Messages/Composer/ComposeBox',
  component: ComposeBox,
  parameters: { layout: 'centered' },
  decorators: [
    // The upload actions come from the seam's Convex context.
    Story => (
      <PeekDataProvider>
        <div className="flex min-h-[520px] w-[560px] items-end">
          <div className="w-full">
            <Story />
          </div>
        </div>
      </PeekDataProvider>
    ),
  ],
  args: {
    onSend: () => {},
  },
} satisfies Meta<typeof ComposeBox>

export default meta
type Story = StoryObj<typeof meta>

/** Focus the ProseMirror surface and type, so the menu opens as it does in the app. */
async function typeInComposer(canvasElement: HTMLElement, text: string) {
  const editor = canvasElement.querySelector('.ProseMirror') as HTMLElement | null
  if (!editor) throw new Error('composer editor not found')
  await userEvent.click(editor)
  await userEvent.keyboard(text)
  return editor
}

/**
 * The topic / DM composer. Interactive states (type to trigger them): `/` opens the
 * menu, `!@` turns the composer urgent (thick left bar), the highlighter button pins a
 * highlight, and Enter sends (Shift+Enter = newline).
 */
export const Default: Story = {}

/** Reply composer — the "Reply..." placeholder used inside the thread panel. */
export const Reply: Story = {
  args: { placeholder: 'reply' },
}

/**
 * The `/` menu, open (PEE-18).
 *
 * Format first, then Shortcuts, then Highlights. Each format shows the trigger
 * you would type to get it — `#` for a heading — which is the same language the
 * Shortcuts section speaks, rather than a column of Ctrl chords.
 *
 * Bold, italic and underline are deliberately absent: they apply to text you
 * have already selected, and this menu only opens on an empty composer. They
 * live in the selection toolbar instead — see the story below.
 */
export const SlashMenu: Story = {
  play: async ({ canvasElement }) => {
    await typeInComposer(canvasElement, '/')
    // The menu portals to the body, so query the document rather than the canvas.
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByText('Format')).toBeInTheDocument()
    await expect(canvas.getByText('Heading')).toBeInTheDocument()
    await expect(canvas.getByText('Code')).toBeInTheDocument()
    await expect(canvas.getByText('Numbered list')).toBeInTheDocument()
  },
}

/**
 * Filtering. `/qu` narrows to Quote and Question — the query matches a label and
 * its id, so `/list` reaches both lists.
 */
export const SlashMenuFiltered: Story = {
  play: async ({ canvasElement }) => {
    await typeInComposer(canvasElement, '/qu')
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByText('Quote')).toBeInTheDocument()
    await expect(canvas.queryByText('Heading')).not.toBeInTheDocument()
  },
}

/**
 * The selection toolbar — bold, italic and underline over selected text, each
 * showing whether it is currently on.
 *
 * Same chrome as `ConversationMoreMenu` — both render the shared `Menu`, so the
 * two read as the same app. It portals out of the composer, places itself above
 * the selection, and is kept on screen by the package rather than by arithmetic
 * here. It waits for the selection to settle, so it neither follows a drag nor
 * blinks on a plain click.
 */
export const SelectionToolbar: Story = {
  play: async ({ canvasElement }) => {
    await typeInComposer(canvasElement, 'Pinning the dependency back')
    // Select through the editor, not the DOM: a range set on the document does
    // not reach ProseMirror, so the toolbar would never hear about it.
    await userEvent.keyboard('{Control>}a{/Control}')
    // The toolbar portals out of the canvas, so query the whole document.
    const canvas = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByRole('button', { name: 'Bold' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Italic' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Underline' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  },
}

/**
 * A typed address becomes a link once a space follows it — blue and
 * underlined, the look the sent card gives it (PEE-19). A click on it while
 * writing places the caret; it opens nothing.
 */
export const LinkTyped: Story = {
  play: async ({ canvasElement }) => {
    const editor = await typeInComposer(canvasElement, 'read https://peek.estiva.app/topic/widgets first')
    await expect(editor.querySelector('a[href="https://peek.estiva.app/topic/widgets"]')).toBeInTheDocument()
  },
}

/**
 * Select words and press Link: the toolbar becomes one field for the address.
 * Enter applies it, and so does clicking away; Escape drops what was typed.
 */
export const LinkField: Story = {
  play: async ({ canvasElement }) => {
    await typeInComposer(canvasElement, 'read the widgets topic first')
    await userEvent.keyboard('{Control>}a{/Control}')
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Link' }))
    await expect(await canvas.findByRole('textbox', { name: 'Link URL' })).toBeInTheDocument()
  },
}

/**
 * Linked words, selected again: the field opens by itself with their address
 * in it (Katerina, 2026-09-07, after Linear). Enter with a new address
 * re-addresses the link; Enter on an empty field removes it. After Enter the
 * caret sits after the link, and typing on is plain text.
 */
export const LinkEditing: Story = {
  play: async ({ canvasElement }) => {
    const editor = await typeInComposer(canvasElement, 'read the widgets topic first')
    await userEvent.keyboard('{Control>}a{/Control}')
    const canvas = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Link' }))
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Link URL' }), 'google.com{Enter}')
    await expect(editor.querySelector('a[href="https://google.com"]')).toBeInTheDocument()
    await userEvent.keyboard('{Control>}a{/Control}')
    await expect(await canvas.findByRole('textbox', { name: 'Link URL' })).toHaveValue('https://google.com')
  },
}

