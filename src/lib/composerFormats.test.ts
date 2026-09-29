// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { peekStarterKit } from '@/extensions/editorKit'
import { FORMATS, applyFormat, type FormatId } from './composerFormats'

/**
 * The `/` menu's Format section and the selection toolbar — PEE-18.
 *
 * These run the real commands against the real editor configuration
 * (`peekStarterKit`), so a format the composer does not actually support fails
 * here rather than in somebody's message.
 */

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: [peekStarterKit], content: '<p></p>' })
})

afterEach(() => {
  editor.destroy()
})

/** The node the caret currently sits in, plus its level for a heading. */
function blockOf(e: Editor): string {
  if (e.isActive('heading', { level: 1 })) return 'heading-1'
  if (e.isActive('heading', { level: 2 })) return 'heading-2'
  if (e.isActive('blockquote')) return 'blockquote'
  if (e.isActive('bulletList')) return 'bulletList'
  if (e.isActive('orderedList')) return 'orderedList'
  if (e.isActive('paragraph')) return 'paragraph'
  return 'unknown'
}

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

describe('applyFormat — the block formats', () => {
  const cases: Array<[FormatId, string]> = [
    ['paragraph', 'paragraph'],
    ['heading', 'heading-1'],
    ['subheading', 'heading-2'],
    ['quote', 'blockquote'],
    ['bulletList', 'bulletList'],
    ['orderedList', 'orderedList'],
  ]

  for (const [id, expected] of cases) {
    it(`${id} puts the caret in a ${expected}`, () => {
      applyFormat(editor, id)
      expect(blockOf(editor)).toBe(expected)
    })
  }

  it('code arms the code mark rather than changing the block', () => {
    applyFormat(editor, 'code')
    expect(editor.isActive('code')).toBe(true)
    expect(blockOf(editor)).toBe('paragraph')
  })

  it('Text returns a heading to body text', () => {
    applyFormat(editor, 'heading')
    expect(blockOf(editor)).toBe('heading-1')
    applyFormat(editor, 'paragraph')
    expect(blockOf(editor)).toBe('paragraph')
  })

  it('Text returns a quote to body text', () => {
    applyFormat(editor, 'quote')
    expect(blockOf(editor)).toBe('blockquote')
    applyFormat(editor, 'paragraph')
    expect(blockOf(editor)).toBe('paragraph')
  })

  it('what you type after choosing a format lands inside it', () => {
    applyFormat(editor, 'heading')
    editor.commands.insertContent('Release notes')
    expect(editor.getHTML()).toContain('<h1>Release notes</h1>')
  })
})

describe('the triggers the menu advertises', () => {
  /**
   * The point of this block. The menu shows `#` beside Heading, so typing `#`
   * had better produce a heading — these tests type the trigger through the
   * view so the extension's own input rule decides, rather than pinning a
   * string somebody believed was right.
   */
  const typed: Array<[string, string, string]> = [
    ['# ', 'heading-1', 'Heading'],
    ['## ', 'heading-2', 'Subheading'],
    ['> ', 'blockquote', 'Quote'],
    ['- ', 'bulletList', 'Bulleted list'],
    ['1. ', 'orderedList', 'Numbered list'],
  ]

  for (const [keys, expected, label] of typed) {
    it(`typing "${keys.trim()}" gives a ${expected}, which is what ${label} advertises`, () => {
      type(editor, keys)
      expect(blockOf(editor)).toBe(expected)
    })
  }

  it('typing `code` between backticks makes it code', () => {
    type(editor, '`fix`')
    expect(editor.getHTML()).toContain('<code>fix</code>')
  })

  it('every advertised trigger is the one that fires', () => {
    const advertised = Object.fromEntries(FORMATS.map((f) => [f.id, f.trigger]))
    expect(advertised).toEqual({
      paragraph: undefined,
      heading: '#',
      subheading: '##',
      quote: '>',
      bulletList: '-',
      orderedList: '1.',
      code: '`',
    })
  })

  it('Text advertises nothing, because no input rule returns a block to a paragraph', () => {
    expect(FORMATS.find((f) => f.id === 'paragraph')?.trigger).toBeUndefined()
  })

  it('does not offer a task list, which the composer cannot serialise', () => {
    expect(FORMATS.map((f) => f.id)).not.toContain('taskList')
  })
})

/* toggleMark, shortcutLabel and the link field's own tests moved into estiva-ui
   with the selection toolbar (UIG-31): `SelectionToolbar.test.ts` there. */

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
