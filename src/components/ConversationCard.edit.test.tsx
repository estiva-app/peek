/**
 * Editing a sent message is the shared box's edit mode (PEEKM-4): the same box
 * Peek writes in, with Cancel and Save. Its keys, its `/` menu, the strip over
 * a selection and Escape with a list open are the package's, and tested there
 * (estiva-ui `CommentBox.test.tsx`). What is left for here is what Peek wires:
 * the keys reach the card's save and cancel, the box opens holding the
 * message's highlight and resolution, and Save hands each change on — shown at
 * once, and only what changed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { addrToNaddr } from '@estiva-app/protocol'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
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
  Element.prototype.scrollIntoView ??= () => {}
})

/** Render one of the viewer's own messages and open its editor via the menu. */
async function openEditor(props: Partial<React.ComponentProps<typeof ConversationCard>> = {}) {
  const onHighlightChange = vi.fn()
  const onBodyChange = vi.fn()
  const onResolvedChange = vi.fn()
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
            onResolvedChange={onResolvedChange}
            {...props}
          />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  fireEvent.mouseEnter(container.firstElementChild as Element)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByText('Edit message'))
  const dom = await waitFor(() => {
    const el = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    if (!el?.editor) throw new Error('no editor yet')
    return el
  })
  return { dom, editor: dom.editor as Editor, container, onHighlightChange, onBodyChange, onResolvedChange }
}

const type = (editor: Editor, text: string) => act(() => void editor.chain().focus('end').insertContent(text).run())
const nodeTypes = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.descendants((node) => void out.push(node.type.name))
  return out
}

describe('the keys of the edit box', () => {
  it('cancels the edit on Escape, saving nothing', async () => {
    const { dom, editor, container, onBodyChange } = await openEditor()
    await type(editor, ' Later.')
    fireEvent.keyDown(dom, { key: 'Escape' })
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeNull())
    expect(onBodyChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('The brief, as promised.')
  })

  it('saves on Enter, and the new text shows at once', async () => {
    const { dom, editor, container, onBodyChange } = await openEditor()
    await type(editor, ' Later.')
    fireEvent.keyDown(dom, { key: 'Enter' })
    await waitFor(() => expect(onBodyChange).toHaveBeenCalledWith('The brief, as promised. Later.'))
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeNull())
    expect(container.textContent).toContain('The brief, as promised. Later.')
  })

  it('saves on Ctrl+Enter', async () => {
    const { dom, editor, onBodyChange } = await openEditor()
    await type(editor, ' Later.')
    fireEvent.keyDown(dom, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onBodyChange).toHaveBeenCalledWith('The brief, as promised. Later.'))
  })
})

describe('a file named while editing', () => {
  const ISSUE = `30851:${'b3'.repeat(32)}:edit-card-issue`
  const OTHER = `30851:${'b3'.repeat(32)}:edit-card-other`

  it('gets its card, saved with the edit (§13.6.2)', async () => {
    const onEmbedsChange = vi.fn()
    const { editor, onBodyChange } = await openEditor({ onEmbedsChange })
    await type(editor, ` nostr:${addrToNaddr(ISSUE, [])}`)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onBodyChange).toHaveBeenCalledTimes(1)
    expect(onEmbedsChange).toHaveBeenCalledWith([expect.objectContaining({ value: ISSUE })])
  })

  it('negative control: a file the message already named gets no card again', async () => {
    const onEmbedsChange = vi.fn()
    const { editor } = await openEditor({ body: `See nostr:${addrToNaddr(OTHER, [])}`, embeds: [], onEmbedsChange })
    await type(editor, ' today')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onEmbedsChange).not.toHaveBeenCalled()
  })
})

describe('a nested list (PEE-57)', () => {
  it('opens nested, and keeps its indent when the edit is saved', async () => {
    const { editor, onBodyChange } = await openEditor({ body: 'Plan:\n- one\n  - two' })
    expect(nodeTypes(editor).filter((t) => t === 'bulletList')).toHaveLength(2)
    await type(editor, ' more')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // Written as a send writes it (`composerText`): a blank line before the list, the indent kept.
    expect(onBodyChange).toHaveBeenCalledWith('Plan:\n\n- one\n  - two more')
  })
})

describe('what the message already has', () => {
  /* The highlighter left the edit box with `/`'s Highlights (PEEKM-3, Decided
     10-25); a highlight the message has still opens in the box and is kept. */
  it('keeps a highlight the message has, and offers no highlighter', async () => {
    const { editor, onHighlightChange, onBodyChange } = await openEditor({ highlightType: 'concern' })
    expect(nodeTypes(editor)).toContain('highlightTag')
    expect(screen.queryByRole('button', { name: 'Highlight' })).toBeNull()
    await type(editor, ' Later.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onBodyChange).toHaveBeenCalledWith('The brief, as promised. Later.')
    expect(onHighlightChange).not.toHaveBeenCalled()
  })

  it('opens a resolved message with its resolution, and keeps it without writing it again', async () => {
    const { editor, onResolvedChange, onBodyChange } = await openEditor({ isResolved: true, resolvedBy: 'You', resolutionMessage: 'Shipped' })
    expect(nodeTypes(editor)).toContain('resolutionBlock')
    await act(() => void editor.chain().focus('start').insertContent('Now: ').run())
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onBodyChange).toHaveBeenCalledWith('Now: The brief, as promised.')
    expect(onResolvedChange).not.toHaveBeenCalled()
  })

  it('reopens the conversation when the resolution is taken out of the box', async () => {
    const { editor, onResolvedChange } = await openEditor({ isResolved: true, resolvedBy: 'You', resolutionMessage: 'Shipped' })
    await act(() => {
      const json = editor.getJSON()
      editor.commands.setContent({ ...json, content: (json.content ?? []).filter((node) => node.type !== 'resolutionBlock') })
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onResolvedChange).toHaveBeenCalledWith(false, undefined, undefined)
  })
})
