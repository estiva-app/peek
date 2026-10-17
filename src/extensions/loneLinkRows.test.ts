// @vitest-environment jsdom
/**
 * A line that is only a link draws as its row while it is written (4136f999;
 * Peek's prototype *Widgets 2/In Peek, In the message box*), by the reader's
 * rule: a sentence, a quote line, a Folder and a link still being answered
 * stay chips or text.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { ReferenceNode } from '@estiva-app/ui/editor'
import { addressToPointer, encodeNaddr } from '@estiva-app/protocol'
import { peekStarterKit } from './editorKit'
import { loneLinkRows } from './loneLinkRows'

const SHIP = 'a'.repeat(64)
const ISSUE = `nostr:${encodeNaddr(addressToPointer(`30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`))}`
const FOLDER = `nostr:${encodeNaddr(addressToPointer(`39000:${SHIP}:c0b27d90-d5b9-40e7-8078-865ab36a421c`))}`
const URL = 'https://ship.estiva.app/issue/plan-f0b27d90-d5b9-40e7-8078-865ab36a421c'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

const chip = (uri: string | null): JSONContent => ({ type: 'reference', attrs: { href: URL, uri } })
const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const text = (value: string): JSONContent => ({ type: 'text', text: value })

/** How many chips draw as rows in a document of these blocks. */
function rowsIn(...blocks: JSONContent[]): number {
  editor = new Editor({ extensions: [peekStarterKit, ReferenceNode], content: { type: 'doc', content: blocks } })
  return loneLinkRows(editor.state.doc).find().length
}

describe('a lone link in the message box', () => {
  it('draws its row alone on a line, spaces around it too', () => {
    expect(rowsIn(line(chip(ISSUE)))).toBe(1)
    expect(rowsIn(line(text('Words on the line above.')), line(text(' '), chip(ISSUE), text(' ')))).toBe(1)
  })

  it('draws its row alone on a bullet line', () => {
    expect(rowsIn({ type: 'bulletList', content: [{ type: 'listItem', content: [line(chip(ISSUE))] }] })).toBe(1)
  })

  it('stays a chip in a sentence, beside another link, or in a quote', () => {
    expect(rowsIn(line(text('see '), chip(ISSUE), text(' today')))).toBe(0)
    expect(rowsIn(line(chip(ISSUE), text(' '), chip(ISSUE)))).toBe(0)
    expect(rowsIn({ type: 'blockquote', content: [line(chip(ISSUE))] })).toBe(0)
  })

  it('stays a chip for a Folder, and the URL for a link not answered yet', () => {
    expect(rowsIn(line(chip(FOLDER)))).toBe(0)
    expect(rowsIn(line(chip(null)))).toBe(0)
  })
})
