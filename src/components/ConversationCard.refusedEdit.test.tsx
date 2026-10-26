/**
 * An edit the relay refused — OPT-8, PEEKM-4.
 *
 * The edit is drawn as it is saved, and a refusal takes it out of the held
 * conversation, so the card is handed its old `body` again. What was saved is
 * not lost: its edit box reopens holding it, files included, with why under it
 * and no toast (Miky, 9 Oct; PEEKM-4) — at once when the card is on screen, or
 * when it is next drawn when the person had moved on, and then a note says so.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { putBackEdit, takeRefusedEdit, type RefusedEdit } from '@/lib/refusedEdits'
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

const REFUSED: RefusedEdit = { text: 'the new text', reason: 'the relay did not take it' }
const LINE = 'Not saved: the relay did not take it. Your changes are still in the box.'

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
  it('reopens the message’s edit box holding what was saved, with why under it', async () => {
    const { container } = render(wrap(<ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />))
    expect(container.querySelector('.ProseMirror')).toBeNull()
    let onScreen = false
    act(() => void (onScreen = putBackEdit(ID, REFUSED)))
    expect((await editorIn(container)).getText()).toBe('the new text')
    expect(screen.getByText(LINE)).toBeTruthy()
    // On screen, so the conversation shows no note.
    expect(onScreen).toBe(true)
  })

  it('reopens with the files that save carried', async () => {
    const { container } = render(wrap(<ReplyCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />))
    const file = { name: 'plan.pdf', contentType: 'application/pdf', size: 1200, sha256: 'a'.repeat(64), mediaUrl: 'https://relay.example/a' }
    act(() => void putBackEdit(ID, { ...REFUSED, files: [file] }))
    await editorIn(container)
    expect(screen.getByText('plan.pdf')).toBeTruthy()
  })

  it('reopens it when the card is drawn later, if the person had moved on — and says then that nobody saw it', async () => {
    expect(putBackEdit(ID, REFUSED)).toBe(false)
    const { container } = render(wrap(<ReplyCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} onBodyChange={() => {}} />))
    expect((await editorIn(container)).getText()).toBe('the new text')
    expect(screen.getByText(LINE)).toBeTruthy()
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
    act(() => void putBackEdit(ID, REFUSED))
    await editorIn(container)
    await act(async () => {})
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1)
  })

  /* An archived file's messages take no edit (Decided 2026-10-20): the box stays shut, and the note says what was lost. */
  it('opens no box on a read-only card, and lets the note say it instead', async () => {
    const { container } = render(
      wrap(
        <>
          <ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} readOnly onBodyChange={() => {}} />
          <ReplyCard authorName="You" timestamp="10:24" body="the old text" messageId={ID} readOnly onBodyChange={() => {}} />
        </>,
      ),
    )
    let onScreen = true
    act(() => void (onScreen = putBackEdit(ID, REFUSED)))
    await act(async () => {})
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(onScreen).toBe(false)
  })

  it('negative control: another message’s refused edit opens nothing here', async () => {
    const { container } = render(wrap(<ConversationCard authorName="You" timestamp="10:24" body="the old text" messageId={'f'.repeat(64)} onBodyChange={() => {}} />))
    act(() => void putBackEdit(ID, REFUSED))
    await act(async () => {})
    expect(container.querySelector('.ProseMirror')).toBeNull()
  })
})
