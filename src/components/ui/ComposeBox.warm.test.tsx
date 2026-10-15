/**
 * A composer drawn with the editor built ahead while the page was idle
 * (4ef41d41) works as one that built its own: it looks the same, focuses
 * itself, sends on Enter and keeps what is typed as its draft. The spare is
 * built before the composer exists, so each of those has to be handed over.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ComposeBox, type SendPayload } from './ComposeBox'
import { createDraftStore, draftKeys } from '@/lib/drafts'
import { keepWarmEditor } from '@/extensions/warmEditor'
import { peekEditorExtensions } from '@/extensions/peekEditor'

// jsdom has no rects on text nodes, and ProseMirror asks for them (see ComposeBox.drafts.test.tsx).
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

// jsdom has no idle callbacks: these are run by hand, so a test knows when the spare is built and when it was taken.
const idle: (() => void)[] = []
beforeAll(() => {
  window.requestIdleCallback = ((callback: IdleRequestCallback) => idle.push(() => callback({ didTimeout: false, timeRemaining: () => 50 }))) as typeof window.requestIdleCallback
})
afterAll(() => {
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback
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

/** A composer drawn once a spare editor is ready, which it must take: the next spare is asked for only then. */
async function warmComposer(draft?: string) {
  keepWarmEditor(peekEditorExtensions)
  // Settled — its own timers run — as a spare built while the page was idle is long before anyone opens a composer.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  for (const run of idle.splice(0)) run()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  const onSend = vi.fn<(payload: SendPayload) => void>()
  const drafts = createDraftStore(memoryStorage())
  const key = draftKeys.container('topic-warm')
  if (draft) drafts.write(key, draft)
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox draftKey={key} drafts={drafts} onSend={onSend} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  expect(idle).toHaveLength(1)
  const element = document.querySelector('.ProseMirror') as HTMLElement & { editor?: Editor }
  return { onSend, drafts, key, element }
}

describe('ComposeBox — an editor built ahead', () => {
  it('draws with the composer’s own look and focuses itself', async () => {
    const { element } = await warmComposer()
    expect(element).toHaveAttribute('contenteditable', 'true')
    expect(element).toHaveClass('outline-none')
    await waitFor(() => expect(element).toHaveFocus())
  })

  it('sends on Enter', async () => {
    const { onSend, element } = await warmComposer('built ahead')
    await screen.findByText('built ahead')
    fireEvent.keyDown(element, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0].text).toBe('built ahead')
  })

  it('keeps what is typed as the draft', async () => {
    const { drafts, key, element } = await warmComposer()
    element.editor!.commands.insertContent('typed into the spare')
    expect(drafts.readDraft(key)?.text).toBe('typed into the spare')
  })
})
