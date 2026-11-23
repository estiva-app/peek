/**
 * Text for a message box that is about to open (KIN-2): an answer goes into the
 * conversation it is about, so it waits for that conversation's box and never
 * lands in the one that happens to be on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { insertTextIntoComposer, insertTextWhenComposerOpens, registerActiveComposer, unregisterComposer } from './composerRegistry'

/** A message box that records what is put in it. */
function box() {
  const written: unknown[] = []
  const chain = { focus: () => chain, unsetAllMarks: () => chain, insertContent: (c: unknown) => (written.push(c), chain), run: () => true }
  const editor = { isDestroyed: false, isFocused: false, chain: () => chain } as unknown as Editor
  return { editor, written }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('insertTextWhenComposerOpens', () => {
  it('writes into the labelled box when it opens, and not into the one on screen before', async () => {
    const onScreen = box()
    registerActiveComposer({ editor: onScreen.editor, label: 'Launch plan' })
    const placed = insertTextWhenComposerOpens('Build failures', 'It broke after the bump.')
    const opened = box()
    registerActiveComposer({ editor: opened.editor, label: 'Build failures' })
    expect(await placed).toBe(true)
    expect(opened.written).toEqual([[{ type: 'text', text: 'It broke after the bump.' }]])
    expect(onScreen.written).toEqual([])
    unregisterComposer(opened.editor)
  })

  it('ignores a box with another label, and the box that was already on screen under the same label', async () => {
    const onScreen = box()
    registerActiveComposer({ editor: onScreen.editor, label: 'Build failures' })
    const placed = insertTextWhenComposerOpens('Build failures', 'It broke after the bump.')
    // The same box says it is active again (a focus), and a different conversation's box opens.
    registerActiveComposer({ editor: onScreen.editor, label: 'Build failures' })
    const other = box()
    registerActiveComposer({ editor: other.editor, label: 'Launch plan' })
    await vi.advanceTimersByTimeAsync(8000)
    expect(await placed).toBe(false)
    expect(onScreen.written).toEqual([])
    expect(other.written).toEqual([])
    unregisterComposer(other.editor)
  })

  it('answers false and writes nothing when no such box opens in time, even if one opens later', async () => {
    const placed = insertTextWhenComposerOpens('Build failures', 'It broke after the bump.', () => true, 5000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await placed).toBe(false)
    const late = box()
    registerActiveComposer({ editor: late.editor, label: 'Build failures' })
    expect(late.written).toEqual([])
    unregisterComposer(late.editor)
  })

  it('writes nothing when the person has left the page by the time the box opens', async () => {
    let onThePage = true
    const placed = insertTextWhenComposerOpens('Weekly notes', 'It broke after the bump.', () => onThePage)
    onThePage = false
    // Another conversation with the same name opens its box.
    const sameName = box()
    registerActiveComposer({ editor: sameName.editor, label: 'Weekly notes' })
    expect(await placed).toBe(false)
    expect(sameName.written).toEqual([])
    unregisterComposer(sameName.editor)
  })
})

describe('insertTextIntoComposer', () => {
  it('writes into the conversation’s own box while a thread’s reply box has the cursor', () => {
    const main = box()
    const thread = box()
    registerActiveComposer({ editor: main.editor, label: 'Release talk' })
    registerActiveComposer({ editor: thread.editor, label: 'Reply in thread' })
    expect(insertTextIntoComposer('Release talk', 'It broke after the bump.')).toBe(true)
    expect(main.written).toEqual([[{ type: 'text', text: 'It broke after the bump.' }]])
    expect(thread.written).toEqual([])
    unregisterComposer(main.editor)
    unregisterComposer(thread.editor)
  })

  it('answers false and writes nothing once that box has gone', () => {
    const main = box()
    const other = box()
    registerActiveComposer({ editor: main.editor, label: 'Release talk' })
    registerActiveComposer({ editor: other.editor, label: 'Reply in thread' })
    unregisterComposer(main.editor)
    expect(insertTextIntoComposer('Release talk', 'It broke after the bump.')).toBe(false)
    expect(other.written).toEqual([])
    unregisterComposer(other.editor)
  })
})
