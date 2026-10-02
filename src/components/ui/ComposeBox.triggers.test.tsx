/**
 * The composer's `@`, `!@`, `[` and `/`, through Peek's own wiring (CON-27).
 *
 * The triggers are the package's (`@estiva-app/ui/editor`) and what a pick
 * writes is `@estiva-app/conversation`'s; this proves Peek still hands them its
 * people, its messages and its rows, and that a pick reaches `onSend` as the
 * same text it did before the move. Each test types the key, picks with Enter
 * and sends with Enter — the person's path, not inserted nodes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { encodeNevent } from '@estiva-app/protocol'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { registerActiveConversation, unregisterActiveConversation, type ConversationSnapshot } from '@/lib/conversationRegistry'
import { ComposeBox, type SendPayload } from './ComposeBox'

// jsdom lays nothing out: ProseMirror asks for rects, the highlighted row scrolls itself into view.
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => unregisterActiveConversation())

const EVENT = 'cd'.repeat(32)

async function compose(onSend: (payload: SendPayload) => void) {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox onSend={onSend} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const dom = await waitFor(() => {
    const el = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    if (!el?.editor) throw new Error('no editor yet')
    return el
  })
  return { dom, editor: dom.editor as Editor }
}

const type = (editor: Editor, text: string) => act(() => void editor.chain().focus().insertContent(text).run())
const enter = (dom: HTMLElement) => act(() => void fireEvent.keyDown(dom, { key: 'Enter' }))
const sleep = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const rows = (name: string) => within(screen.getByRole('listbox', { name })).getAllByRole('option').map((o) => o.textContent?.replace('↩ Enter', ''))

describe('the composer’s triggers come from the packages (CON-27)', () => {
  it('@ lists people and a pick is sent as the mention it always was', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    await type(editor, '@')
    const people = rows('People')
    expect(people.length).toBeGreaterThan(0)
    expect(people.length).toBeLessThanOrEqual(6)
    await enter(dom)
    expect(screen.queryByRole('listbox')).toBeNull()
    const node = editor.getJSON().content?.[0].content?.[0]
    expect(node?.type).toBe('mention')
    await type(editor, 'hi')
    await sleep(150) // the Enter that picked must not also send; this one is a new press
    await enter(dom)
    const { text } = onSend.mock.calls[0][0] as SendPayload
    // Peek's demo people have no key, so this is the by-name form `mentionText` keeps for them.
    expect(text).toBe(`@${node?.attrs?.label} hi`)
  })

  it('!@ opens the urgent list and sends the old !@Name for a person with no key', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    await type(editor, '!@')
    expect(rows('Urgent mention').length).toBeGreaterThan(0)
    await enter(dom)
    const node = editor.getJSON().content?.[0].content?.[0]
    expect(node?.type).toBe('urgentMention')
    await sleep(150)
    await enter(dom)
    const payload = onSend.mock.calls[0][0] as SendPayload
    expect(payload.text).toBe(`!@${node?.attrs?.label} `.trimEnd())
    expect(payload.urgent).toBeUndefined()
  })

  it('[ lists the messages on screen and sends the nostr:nevent the chip was picked as', async () => {
    registerActiveConversation({
      references: [],
      messages: [{ id: 'm1', author: 'Ada', timestamp: '9:41 AM', body: 'Build **#4821** failed.', eventId: EVENT }],
    } as unknown as ConversationSnapshot)
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    await type(editor, '[')
    expect(rows('Topics and messages')).toEqual(['Ada: Build #4821 failed.'])
    await enter(dom)
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({ type: 'messageMention', attrs: { id: EVENT, label: 'Ada', snippet: 'Build #4821 failed.' } })
    await sleep(150)
    await enter(dom)
    expect((onSend.mock.calls[0][0] as SendPayload).text).toBe(`nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`)
  })

  it('/ opens Format, Shortcuts and Highlights, and a shortcut row opens its own list', async () => {
    const { dom, editor } = await compose(vi.fn())
    await type(editor, '/')
    expect(rows('Commands')).toEqual([
      'Text', 'Heading#', 'Subheading##', 'Quote>', 'Code`', 'Bulleted list-', 'Numbered list1.',
      'Mention@', 'Urgent!@', 'Reference[', 'Resolve->',
      'Insight', 'Concern', 'Conclusion', 'Question', 'Summary',
    ])
    await type(editor, 'mention')
    await enter(dom)
    await sleep(50) // the row types `@` a frame later
    expect(screen.getByRole('listbox', { name: 'People' })).toBeTruthy()
  })
})
