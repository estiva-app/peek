// @vitest-environment jsdom
/**
 * An app link in Peek's message box — OPT-19 (Miky, 14 Oct). It reads as its
 * chip, pasted or typed, and the message keeps the URL; Ctrl+Z gives the URL
 * back; a block link, a URL no app claims and a URL over selected words stay
 * links. Pasted through `view.pasteText`, ProseMirror's own paste path, with
 * Peek's link mark (its autolink and paste rule) in the editor.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { LinkChips, ReferenceNode } from '@estiva-app/ui/editor'
import { peekStarterKit } from './editorKit'
import { serializeTiptapToText } from '@/lib/textParsing'

const ISSUE_URL = 'https://ship.estiva.app/issue/live-widget-probe-marker-b389d20f-b741-4ba8-a28f-97cac351c4c9'
const ISSUE_URI = 'nostr:naddr1example'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function setup() {
  editor = new Editor({
    extensions: [peekStarterKit, ReferenceNode, LinkChips.configure({ referenceOf: (url) => (url === ISSUE_URL ? ISSUE_URI : undefined), ask: null })],
    content: '<p></p>',
  })
  return editor
}

function paste(e: Editor, text: string) {
  const clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [] }
  e.view.pasteText(text, { clipboardData, preventDefault() {} } as unknown as ClipboardEvent)
}

const chips = (e: Editor) => {
  const found: string[] = []
  e.state.doc.descendants((node) => {
    if (node.type.name === 'reference') found.push(String(node.attrs.href))
  })
  return found
}

describe('an app link in the message box (OPT-19)', () => {
  it('a pasted one becomes its chip, and the message keeps the URL', () => {
    const e = setup()
    e.commands.insertContent('see ')
    paste(e, ISSUE_URL)
    expect(chips(e)).toEqual([ISSUE_URL])
    e.commands.insertContent(' today')
    expect(serializeTiptapToText(e)).toBe(`see ${ISSUE_URL} today`)
  })

  it('Ctrl+Z gives the pasted URL back', () => {
    const e = setup()
    paste(e, ISSUE_URL)
    expect(chips(e)).toHaveLength(1)
    e.commands.undo()
    expect(chips(e)).toHaveLength(0)
    expect(serializeTiptapToText(e)).toContain(ISSUE_URL)
  })

  it('a typed one becomes its chip once the space after it is typed', () => {
    const e = setup()
    for (const ch of `see ${ISSUE_URL}`) e.commands.insertContent(ch)
    expect(chips(e)).toHaveLength(0)
    // The space is what autolinks it, and what moves the caret off it.
    e.view.dispatch(e.state.tr.insertText(' '))
    expect(chips(e)).toEqual([ISSUE_URL])
  })

  it('a block link and a URL no app claims stay links', () => {
    const e = setup()
    paste(e, `${ISSUE_URL}#block-8373a025427f`)
    e.commands.insertContent(' ')
    paste(e, 'https://example.com/x')
    expect(chips(e)).toEqual([])
  })

  it('a URL pasted over selected words is a link on them, not a chip', () => {
    const e = setup()
    e.commands.insertContent('read the plan first')
    e.commands.setTextSelection({ from: 6, to: 14 })
    paste(e, ISSUE_URL)
    expect(chips(e)).toEqual([])
    expect(serializeTiptapToText(e)).toBe(`read [the plan](${ISSUE_URL}) first`)
  })
})
