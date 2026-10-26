import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'

/**
 * **The edit box is a compose box**, and for a long time it was not: `/` opened
 * nothing and there was no selection toolbar over a chosen word. Since PEEKM-4
 * it is the very box Peek writes in — the shared box's edit form.
 *
 * These stories are here rather than on `Messages/ConversationCard` because
 * what they are about is the *writing*, not the card (Katerina's review, 22
 * September). The card keeps one editing story, which shows the box; these
 * three show what the box can do.
 *
 * They run in a browser because that is the only place typing reaches
 * ProseMirror — jsdom never mutates a contenteditable, so the unit tests beside
 * the card prove the parts that are not typing.
 */
const meta = {
  title: 'Writing & text/Editing a message',
  component: ConversationCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PeekDataProvider>
          <div className="w-[560px]">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    authorName: 'You',
    timestamp: '11:08 AM',
    body: 'Found the root cause — a dependency bump broke the build. Pinning it back now; will confirm once it goes green.',
  },
} satisfies Meta<typeof ConversationCard>

export default meta
type Story = StoryObj<typeof meta>

async function startEditing(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const doc = within(canvasElement.ownerDocument.body)
  // The quick-action strip appears on hovering the card, which is inside the
  // decorator rather than the canvas root.
  await userEvent.hover(canvasElement.querySelector('div.relative.rounded-lg') as HTMLElement)
  await userEvent.click(await doc.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await doc.findByText('Edit message'))
  const surface = (await canvas.findByText(/Found the root cause/)).closest('.ProseMirror') as HTMLElement
  await userEvent.click(surface)
  return { canvas, doc, surface }
}

/**
 * `/` while editing — the thing that did nothing until 2026-09-08.
 *
 * Same sections the composer shows, at the caret rather than at the start
 * of the box: it is a suggestion plugin, so it opens mid-sentence, which is the
 * normal case here because the message is already in the box.
 */
export const SlashMenu: Story = {
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard(' /')
    await expect(await doc.findByText('Format')).toBeInTheDocument()
    await expect(doc.getByText('Insert')).toBeInTheDocument()
  },
}

/**
 * The same menu, with the message low on the screen.
 *
 * Above the caret is where these menus have always gone, and it is still the
 * preference — the story above only opens downward because the card sits at the
 * top of the canvas with nothing above it. That was the bug: every type-ahead
 * popup hung above the caret and *only* above it, which is right for a composer
 * at the foot of a topic and wrong for a message near the top of the stream,
 * where the menu was drawn off the top of the window. That looks exactly like
 * `/` doing nothing.
 */
export const SlashMenuLowOnTheScreen: Story = {
  decorators: [(Story) => <div className="flex min-h-[620px] items-end"><div className="w-full"><Story /></div></div>],
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard(' /')
    const panel = (await doc.findByText('Format')).closest('div[class*="w-[300px]"]') as HTMLElement
    const box = canvasElement.querySelector('.ProseMirror')!.getBoundingClientRect()
    const menu = panel.getBoundingClientRect()
    // Above the caret it opened from, and wholly on screen.
    await expect(menu.bottom).toBeLessThan(box.bottom)
    await expect(menu.top).toBeGreaterThanOrEqual(0)
  },
}

/** Bold, italic, underline and link over a chosen word, while editing. */
export const SelectionToolbar: Story = {
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard('{Control>}a{/Control}')
    await expect(await doc.findByRole('button', { name: 'Bold' })).toBeInTheDocument()
    await expect(doc.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  },
}
