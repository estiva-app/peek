import { describe, it, expect, vi, beforeAll } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BlockDocumentField } from './BlockDocumentField'

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on text
   nodes, and ProseMirror calls them on every document change. */
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () =>
    ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})

type EditorBox = HTMLElement & { editor: Editor }
/* The editor is made a tick after the first render. */
const ready = async () => {
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Description' }) as EditorBox).editor?.isInitialized).toBe(true))
  return screen.getByRole('textbox', { name: 'Description' }) as EditorBox
}

/*
  Tab on a list item put it in a list inside the item above, and the save
  dropped that list, text and all (MAN-13). §13.3 now keeps the list flat and
  marks the item's depth. The whole of what a person does in Edit description:
  Tab, leave, open it again.
*/
describe('a list item indented with Tab', () => {
  type Saved = { content: { content: { id: string; attrs?: { indent?: number }; content: { text: string }[] }[] }[] }

  it('is saved with its text and its depth, and opens indented again', async () => {
    const onCommit = vi.fn<(value: string, format?: string) => boolean>(() => true)
    const { unmount } = render(<BlockDocumentField value={'- intro\n- after'} format="marker" label="Description" onCommit={onCommit} />)
    const box = await ready()
    act(() => void box.editor.commands.focus('end'))
    await act(() => void fireEvent.keyDown(box, { key: 'Tab' }))
    fireEvent.blur(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalled())

    const [value, format] = onCommit.mock.calls.at(-1)!
    expect(format).toBe('estiva-blocks-1')
    const items = (JSON.parse(value) as Saved).content[0].content
    expect(items.map((item) => [item.content[0]?.text, item.attrs?.indent])).toEqual([
      ['intro', undefined],
      ['after', 1],
    ])

    unmount()
    render(<BlockDocumentField value={value} format="blocks" label="Description" onCommit={vi.fn(() => true)} />)
    const reopened = await ready()
    expect(reopened.querySelector('li > ul > li')).toHaveTextContent('after')
    expect(reopened.querySelector('li > ul > li')?.getAttribute('data-block-id')).toBe(items[1].id)
  })
})
