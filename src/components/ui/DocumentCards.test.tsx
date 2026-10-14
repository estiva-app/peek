/**
 * A chip's card in another app's description (SPEC §13.3, Widgets; Miky 14 Oct:
 * Peek's panel draws the chosen card and offers the choice, as Ship does). The
 * chip selected, the toolbar offers None, Compact and Detailed, and the choice
 * is saved on the chip itself.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { BlockDocumentField } from './BlockDocumentField'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects = rects
    proto.getBoundingClientRect = empty
  }
})

type EditorBox = HTMLElement & { editor: Editor }
const ready = async () => {
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Description' }) as EditorBox).editor?.isInitialized).toBe(true))
  return screen.getByRole('textbox', { name: 'Description' }) as EditorBox
}

const NADDR =
  'nostr:naddr1qqjxzde5xfjnvdee943kzwrr956rswr995uxgd3s95unsvekvd3nsvtzv3jnyqg4dp68gup69uhkcmmrv9kxsmmnwsarxvpsxqpzpvankwem8vankwem8vankwem8vankwem8vankwem8vankwem8vanqvzqqqrcsvczkget'
const doc = (attrs: Record<string, unknown>) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', id: 'p1', content: [{ type: 'text', text: NADDR, marks: [{ type: 'reference', attrs: { uri: NADDR, ...attrs } }] }] }] })

describe('a chip\'s card in the panel', () => {
  it('draws the reference as its chip, not its URI, with the card its writer chose after the line', async () => {
    render(<BlockDocumentField value={doc({ embed: 'compact' })} format="blocks" label="Description" onCommit={() => true} cards />)
    const box = await ready()
    await waitFor(() => expect(box.querySelector('[data-reference-cards] [data-card="compact"]')).not.toBeNull())
    expect(box.textContent).not.toContain(NADDR)
  })

  it('opens the chip\'s menu on a click, and saves the card chosen there on the chip', async () => {
    const onCommit = vi.fn<(value: string, format?: string) => boolean>(() => true)
    render(<BlockDocumentField value={doc({})} format="blocks" label="Description" onCommit={onCommit} cards />)
    const box = await ready()
    expect(box.querySelector('[data-reference-cards]')).toBeNull()
    act(() => box.editor.commands.focus())
    fireEvent.click(box.querySelector('[data-node-view-wrapper]')!)
    expect((await screen.findByRole('menuitemradio', { name: 'None' }, { timeout: 3000 })).getAttribute('aria-checked')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('menuitemradio', { name: 'Detailed' }))
    await waitFor(() => expect(box.querySelector('[data-reference-cards] [data-card="detailed"]')).not.toBeNull())
    fireEvent.blur(box)
    await waitFor(() => expect(onCommit).toHaveBeenCalled())
    const saved = JSON.parse(onCommit.mock.calls.at(-1)![0])
    expect(saved.content[0].content[0].marks).toEqual([{ type: 'reference', attrs: { uri: NADDR, embed: 'detailed' } }])
  })
})
