/**
 * The Send button is a button for the keyboard too (UIG-14, C5).
 *
 * It sends on the mouse's way down, with the default prevented, so a click
 * never takes focus out of the editor. That left the keyboard with nothing:
 * Enter or Space on the focused button fires a click, and nothing listened to
 * one. The click now sends when no pointer is behind it (`detail` 0), and a
 * mouse click — which has already sent on its way down — still sends once.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ComposeBox, type SendPayload } from './ComposeBox'
import { createDraftStore, draftKeys } from '@/lib/drafts'

// jsdom has no rects on text nodes, and ProseMirror asks for them when a draft
// replaces the document (see ComposeBox.drafts.test.tsx).
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

/** A composer holding `text` (through a draft — jsdom cannot type into Tiptap), and its Send button. */
async function composerWith(text: string) {
  const onSend = vi.fn<(payload: SendPayload) => void>()
  const drafts = createDraftStore(memoryStorage())
  const key = draftKeys.container('topic-1')
  drafts.write(key, text)
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox draftKey={key} drafts={drafts} onSend={onSend} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  await screen.findByText(text)
  const send = screen.getByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  /*
    The editor focuses itself once it is mounted (`autofocus`), on a timer. Let
    that land first: if it landed during the key press, Enter would reach the
    editor — which sends on Enter too — and the test would prove nothing about
    the button.
  */
  const editor = document.querySelector('.ProseMirror') as HTMLElement
  await waitFor(() => expect(editor).toHaveFocus())
  return { onSend, send }
}

describe('ComposeBox — the Send button', () => {
  it('sends on Enter when it has focus', async () => {
    const user = userEvent.setup()
    const { onSend, send } = await composerWith('by the keyboard')
    send.focus()
    expect(send).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].text).toBe('by the keyboard')
  })

  it('sends on Space when it has focus', async () => {
    const user = userEvent.setup()
    const { onSend, send } = await composerWith('by the space bar')
    send.focus()
    expect(send).toHaveFocus()
    await user.keyboard(' ')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].text).toBe('by the space bar')
  })

  it('sends once for a mouse click, on the way down, as before', async () => {
    const { onSend, send } = await composerWith('by the mouse')
    fireEvent.mouseDown(send)
    expect(onSend).toHaveBeenCalledTimes(1)
    // The click that ends the same press carries the pointer's count, and adds nothing.
    fireEvent.click(send, { detail: 1 })
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
