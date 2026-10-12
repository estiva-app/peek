/**
 * An edit the relay refused — OPT-8.
 *
 * The edit is drawn as it is saved, and a refusal takes it out of the held
 * conversation, so the card is handed its old `body` again. What was saved is
 * not lost: its edit box reopens holding it (Miky, 9 Oct) — at once when the
 * card is on screen, or when it is next drawn when the person had moved on.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { putBackEdit, takeRefusedEdit } from '@/lib/refusedEdits'
import { ConversationCard } from './ConversationCard'
import { ReplyCard } from './ReplyCard'

beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
  Element.prototype.scrollIntoView ??= () => {}
})

const ID = 'e'.repeat(64)
afterEach(() => takeRefusedEdit(ID))

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>
    <DebugProvider>
      <PeekDataProvider>{node}</PeekDataProvider>
    </DebugProvider>
  </MemoryRouter>
)

const editorIn = (container: HTMLElement) =>
  waitFor(() => {
    const el = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    if (!el?.editor) throw new Error('no editor yet')
    return el.editor
  })

describe('a refused edit', () => {
  it('reopens the message’s edit box holding what was saved', async () => {
    const { container } = render(wrap(<ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />))
    expect(container.querySelector('.ProseMirror')).toBeNull()
    act(() => putBackEdit(ID, 'the new text'))
    expect((await editorIn(container)).getText()).toBe('the new text')
  })

  it('reopens it when the card is drawn later, if the person had moved on', async () => {
    putBackEdit(ID, 'the new text')
    const { container } = render(wrap(<ReplyCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />))
    expect((await editorIn(container)).getText()).toBe('the new text')
  })

  it('reopens one box when the message is drawn twice — in its list and atop its thread', async () => {
    const { container } = render(
      wrap(
        <>
          <ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />
          <ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />
        </>,
      ),
    )
    act(() => putBackEdit(ID, 'the new text'))
    await editorIn(container)
    await new Promise((done) => setTimeout(done, 50))
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1)
  })

  it('negative control: another message’s refused edit opens nothing here', async () => {
    const { container } = render(wrap(<ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={'f'.repeat(64)} onBodyChange={() => {}} />))
    act(() => putBackEdit(ID, 'the new text'))
    await new Promise((done) => setTimeout(done, 50))
    expect(container.querySelector('.ProseMirror')).toBeNull()
  })
})
