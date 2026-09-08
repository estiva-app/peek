/**
 * The edit box is a compose box — what the composer can do, editing can do.
 *
 * Katerina reported the half of it that was visible: "the `/` command with the
 * menu are not working when editing an already sent message and it should".
 * The cause was that each of the three editors spelled its own extension list
 * and `SlashCommands` was on only one of them; `peekEditor.ts` is the one list
 * now. The same gap had left the selection toolbar and the highlighter in the
 * composer alone.
 *
 * **What is proved where.** Typing into ProseMirror does not work under jsdom
 * — nothing here mutates a contenteditable, which is how the editor learns
 * what was typed — so no test in this repository types into it, and the `/`
 * menu's own behaviour is proved in a browser by `ComposeBox.stories`. The
 * edit box's is proved the same way, in `ConversationCard.stories`. What is
 * left for here is everything that is not typing: the controls the box now
 * carries, and the Escape rule the menus need, driven through the counter the
 * menus themselves report into.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { openSuggestion, closeSuggestion } from '@/extensions/mention'
import { ConversationCard } from './ConversationCard'

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on
   text nodes, and ProseMirror calls them on every document change. */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

/** Render one of the viewer's own messages and open its editor via the menu. */
async function openEditor(props: Partial<React.ComponentProps<typeof ConversationCard>> = {}) {
  const onHighlightChange = vi.fn()
  const onBodyChange = vi.fn()
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationCard
            authorName="You"
            timestamp="10:24"
            body="The brief, as promised."
            onHighlightChange={onHighlightChange}
            onBodyChange={onBodyChange}
            {...props}
          />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const card = container.firstElementChild as Element
  fireEvent.mouseEnter(card)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByText('Edit message'))
  await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
  const editor = container.querySelector('.ProseMirror') as HTMLElement
  editor.focus()
  return { editor, container, onHighlightChange, onBodyChange }
}

/**
 * Escape, while a type-ahead menu is open.
 *
 * ProseMirror asks `editorProps.handleKeyDown` before it asks any plugin
 * (`someProp` reads the view's own props first), so the edit box saw Escape
 * first and cancelled — the menu never got the key. Reaching for the menu's
 * Escape therefore threw the whole edit away, and had done since long before
 * `/` was registered here: `@` and `[` have always been in the edit box.
 *
 * The menus report into a shared counter, and that counter is what the guard
 * reads, so the counter is what these drive. The menu opening at the caret is
 * a browser's job (the stories).
 */
describe('Escape, while a menu is open', () => {
  it('leaves the edit open — the menu takes the key', async () => {
    const { editor, container } = await openEditor()
    openSuggestion()
    try {
      fireEvent.keyDown(editor, { key: 'Escape' })
      expect(container.querySelector('.ProseMirror')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    } finally {
      closeSuggestion()
    }
  })

  it('cancels the edit when no menu is open', async () => {
    const { editor, container } = await openEditor()
    fireEvent.keyDown(editor, { key: 'Escape' })
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeNull())
  })

  /* The press after the menu closes is a person asking to leave, so the guard
     reads the open counter with no grace period — unlike Enter, which needs
     one because the Enter that picks a row must not also save. */
  it('cancels the edit on the very next press, with no grace period', async () => {
    const { editor, container } = await openEditor()
    openSuggestion()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(container.querySelector('.ProseMirror')).not.toBeNull()

    closeSuggestion()
    fireEvent.keyDown(editor, { key: 'Escape' })
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeNull())
  })

  /* Enter keeps its grace period, and keeps saving. The grace is why this
     waits: `isSuggestionActive` counts the 100ms after a menu closes as still
     busy, and the counter is module-global, so a test that closed one a moment
     ago would otherwise silence this one's Enter. */
  it('leaves Save on Enter alone', async () => {
    const { editor, onBodyChange } = await openEditor()
    await new Promise((r) => setTimeout(r, 120))
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onBodyChange).toHaveBeenCalledWith('The brief, as promised.'))
  })
})

describe('the rest of the composer, in the edit box', () => {
  /* Bold / italic / underline / link over a selection. Only the composer had
     it, so a link — what PEE-19 shipped — could be written into a message and
     never added to one afterwards. */
  it('offers the selection toolbar over selected words', async () => {
    const { editor } = await openEditor()
    editor.focus()
    await userEvent.keyboard('{Control>}a{/Control}')

    expect(await screen.findByRole('button', { name: 'Bold' }, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Italic' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Underline' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link' })).toBeTruthy()
  })

  /* The edit box could always *keep* a highlight — `extractHighlightType`
     reads one back on Save — and had no control to add, change or drop one. */
  it('offers the highlighter, and marks the message with it', async () => {
    const { onHighlightChange } = await openEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    await userEvent.click(await screen.findByText('Concern'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onHighlightChange).toHaveBeenCalledWith('concern')
  })
})
