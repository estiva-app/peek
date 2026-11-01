// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { peekStarterKit } from './editorKit'

/**
 * Peek's own rules in its editor kit, run against the real configuration. The
 * link rule's test lived in `composerFormats.test.ts` until that file's last
 * caller went; the rule itself is still every Peek box's (`peekStarterKit`).
 */

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: [peekStarterKit], content: '<p></p>' })
})

afterEach(() => {
  editor.destroy()
})

/**
 * Type text through the view the way a person does, so input rules fire.
 * `insertContent` bypasses them — it is a document edit, not typing.
 */
function type(e: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = e.state.selection
    // The fifth argument is ProseMirror's `deflt` — the transaction the rule
    // falls back to when it does not match.
    const handled = e.view.someProp('handleTextInput', (f) =>
      f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)),
    )
    if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to))
  }
}

describe('a link ends where its words end (Katerina, 2026-09-07)', () => {
  it('typing at the end of a link is plain text, not more link', () => {
    editor.commands.setContent('<p>read the widgets topic first</p>')
    editor.commands.setTextSelection({ from: 10, to: 23 })
    // The link mark this editor kit configures — what the toolbar's field sets.
    editor.commands.setLink({ href: 'https://google.com' })
    editor.commands.setTextSelection(23)
    type(editor, 'X')
    const linked: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'link')) linked.push(node.text ?? '')
    })
    expect(linked).toEqual(['widgets topic'])
    expect(editor.state.doc.textContent).toBe('read the widgets topicX first')
  })
})
