// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { peekStarterKit } from '@/extensions/editorKit'
import { FORMATS, MARKS, applyFormat, toggleMark, shortcutLabel, currentLink, applyLink, normalizeHref, type FormatId } from './composerFormats'

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

describe('toggleMark — the selection toolbar', () => {
  for (const mark of MARKS) {
    it(`${mark.id} toggles on and off`, () => {
      toggleMark(editor, mark.id)
      expect(editor.isActive(mark.id)).toBe(true)
      toggleMark(editor, mark.id)
      expect(editor.isActive(mark.id)).toBe(false)
    })
  }

  it('covers exactly bold, italic and underline', () => {
    expect(MARKS.map((m) => m.id)).toEqual(['bold', 'italic', 'underline'])
  })

  it('marks it names are all in the composer schema', () => {
    for (const mark of MARKS) {
      expect(Object.keys(editor.schema.marks), mark.id).toContain(mark.id)
    }
  })
})

describe('shortcutLabel', () => {
  it('says Cmd on Apple platforms', () => {
    expect(shortcutLabel('Mod-B', true)).toBe('Cmd+B')
    expect(shortcutLabel('Mod-Shift-B', true)).toBe('Cmd+Shift+B')
  })

  it('says Ctrl everywhere else', () => {
    expect(shortcutLabel('Mod-B', false)).toBe('Ctrl+B')
    expect(shortcutLabel('Mod-Shift-B', false)).toBe('Ctrl+Shift+B')
  })

  it('upper-cases a single-character key so Ctrl+b never reaches a tooltip', () => {
    expect(shortcutLabel('Mod-b', false)).toBe('Ctrl+B')
  })
})

describe('links — the toolbar field (PEE-19)', () => {
  it('the schema has the link mark, so there is something to set', () => {
    expect(editor.schema.marks.link).toBeDefined()
  })

  describe('normalizeHref — what typing in the field becomes', () => {
    const cases: Array<[string, string | null]> = [
      ['https://peek.estiva.app/topic/widgets', 'https://peek.estiva.app/topic/widgets'],
      ['http://example.com', 'http://example.com'],
      ['mailto:jan@estiva.app', 'mailto:jan@estiva.app'],
      ['google.com', 'https://google.com'],
      ['  www.google.com/a?b=c  ', 'https://www.google.com/a?b=c'],
      ['localhost:5173/topic', 'https://localhost:5173/topic'],
      ['javascript:alert(1)', null],
      ['ftp://files.example.com', null],
      ['two words', null],
      ['', null],
      ['   ', null],
    ]
    it.each(cases)('%j → %j', (raw, href) => {
      expect(normalizeHref(raw)).toBe(href)
    })
  })

  describe('applyLink — over "widgets topic" in "read the widgets topic first"', () => {
    /** The one linked run in the document, or null. */
    const linkOf = (): { text: string; href: string } | null => {
      let found: { text: string; href: string } | null = null
      editor.state.doc.descendants((node) => {
        const link = node.marks.find((m) => m.type.name === 'link')
        if (node.isText && link) found = { text: node.text ?? '', href: link.attrs.href as string }
      })
      return found
    }

    beforeEach(() => {
      editor.commands.setContent('<p>read the widgets topic first</p>')
      editor.commands.setTextSelection({ from: 10, to: 23 })
    })

    it('an address links the selected words, completing a bare host', () => {
      expect(applyLink(editor, 'google.com')).toBe(true)
      expect(linkOf()).toEqual({ text: 'widgets topic', href: 'https://google.com' })
      expect(currentLink(editor)).toBe('https://google.com')
    })

    it('an empty field removes the link', () => {
      applyLink(editor, 'https://google.com')
      expect(applyLink(editor, '')).toBe(true)
      expect(linkOf()).toBeNull()
      expect(currentLink(editor)).toBe('')
    })

    it('a scheme a reader may not follow is refused, and nothing changes', () => {
      expect(applyLink(editor, 'javascript:alert(1)')).toBe(false)
      expect(linkOf()).toBeNull()
    })

    it('the caret inside a link re-addresses the whole link', () => {
      applyLink(editor, 'https://google.com')
      editor.commands.setTextSelection(15)
      expect(currentLink(editor)).toBe('https://google.com')
      expect(applyLink(editor, 'https://example.com')).toBe(true)
      expect(linkOf()).toEqual({ text: 'widgets topic', href: 'https://example.com' })
    })
  })
})

describe('a link ends where its words end (Katerina, 2026-09-07)', () => {
  it('typing at the end of a link is plain text, not more link', () => {
    editor.commands.setContent('<p>read the widgets topic first</p>')
    editor.commands.setTextSelection({ from: 10, to: 23 })
    applyLink(editor, 'https://google.com')
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
