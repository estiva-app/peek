// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { undo } from '@tiptap/pm/history'
import { peekStarterKit } from './editorKit'
import { ObjectMention } from './mention'
import { PastedUrl, chipUriOf, loneUrl, type ResolvePastedUrl } from './pastedUrl'
import { serializeTiptapToText } from '@/lib/textParsing'

/**
 * A pasted app link becomes its chip in the composer ("The composer resolves a
 * URL as you paste it", Widgets).
 *
 * Every paste here goes through `view.pasteText` — ProseMirror's own paste
 * path, with the editor's `handlePaste` props and the Link extension's paste
 * rules — not a command that inserts the result. A composer test that skipped
 * the paste passed while production failed (UIG-40's wrap).
 */

const PUBKEY = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE = `30851:${PUBKEY}:b389d20f-b741-4ba8-a28f-97cac351c4c9`
const ISSUE_URL = 'https://ship.estiva.app/issue/live-widget-probe-marker-b389d20f-b741-4ba8-a28f-97cac351c4c9'
const ISSUE_URI = chipUriOf({ address: ISSUE })!

let editor: Editor | undefined

afterEach(() => editor?.destroy())

/** An editor whose lookup answers when `answer` is called. */
function setup(found: Awaited<ReturnType<ResolvePastedUrl>>) {
  let answer!: () => void
  const asked: string[] = []
  const resolve: ResolvePastedUrl = (url) => {
    asked.push(url)
    return new Promise((done) => (answer = () => done(found)))
  }
  editor = new Editor({ extensions: [peekStarterKit, ObjectMention, PastedUrl.configure({ resolve })], content: '<p></p>' })
  return { editor, asked, answer: async () => { answer(); await new Promise((r) => setTimeout(r, 0)) } }
}

/** A plain-text paste, as a browser hands it over; jsdom has no `ClipboardEvent`. */
function paste(e: Editor, text: string) {
  const clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [] }
  e.view.pasteText(text, { clipboardData, preventDefault() {} } as unknown as ClipboardEvent)
}

const chips = (e: Editor) => {
  const out: string[] = []
  e.state.doc.descendants((n) => void (n.type.name === 'objectMention' && out.push(n.attrs.uri)))
  return out
}

describe('a pasted app link becomes its chip', () => {
  it('pasted alone: a link at once, the chip once the lookup answers, and the chip is what is sent', async () => {
    const { editor, asked, answer } = setup({ address: ISSUE })
    paste(editor, ISSUE_URL)
    expect(asked).toEqual([ISSUE_URL])
    expect(editor.getHTML()).toContain(`href="${ISSUE_URL}"`)
    await answer()
    expect(chips(editor)).toEqual([ISSUE_URI])
    expect(editor.state.doc.textContent).not.toContain('ship.estiva.app')
    expect(serializeTiptapToText(editor)).toBe(ISSUE_URI)
  })

  it('pasted mid-sentence: the chip sits among the words', async () => {
    const { editor, answer } = setup({ address: ISSUE })
    editor.commands.insertContent('see  please')
    editor.commands.setTextSelection(5)
    paste(editor, ISSUE_URL)
    await answer()
    expect(serializeTiptapToText(editor)).toBe(`see ${ISSUE_URI} please`)
  })

  it('a message link becomes an nevent chip', async () => {
    const id = 'c070bf7ce4433b83ac5988352720fccd2f6527fcd956aca356b010831d1e6742'
    const { editor, answer } = setup({ eventId: id })
    paste(editor, `https://peek.estiva.app/message/${id}`)
    await answer()
    expect(chips(editor)).toEqual([chipUriOf({ eventId: id })])
    expect(chips(editor)[0]).toMatch(/^nostr:nevent1/)
  })

  it('Ctrl+Z after the swap gives the link back', async () => {
    const { editor, answer } = setup({ address: ISSUE })
    paste(editor, ISSUE_URL)
    await answer()
    undo(editor.state, editor.view.dispatch)
    expect(chips(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe(ISSUE_URL)
  })
})

describe('what stays a link', () => {
  it('a URL no app claims', async () => {
    const { editor, answer } = setup(null)
    paste(editor, 'https://example.com/some/page')
    await answer()
    expect(chips(editor)).toEqual([])
    expect(editor.getHTML()).toContain('href="https://example.com/some/page"')
  })

  it('a link to one block (COM-2): its part card needs the URL', async () => {
    const { editor, answer } = setup({ address: ISSUE, block: '0123456789ab' })
    paste(editor, `${ISSUE_URL}#block-0123456789ab`)
    await answer()
    expect(chips(editor)).toEqual([])
    expect(serializeTiptapToText(editor)).toBe(`${ISSUE_URL}#block-0123456789ab`)
  })

  it('a URL pasted over selected words links those words, and is not looked up', () => {
    const { editor, asked } = setup({ address: ISSUE })
    editor.commands.insertContent('these words')
    editor.commands.selectAll()
    paste(editor, ISSUE_URL)
    expect(asked).toEqual([])
    expect(editor.state.doc.textContent).toBe('these words')
    expect(editor.getHTML()).toContain(`href="${ISSUE_URL}"`)
  })

  it('a copied passage keeps its links as written (Miky, 13 Oct)', () => {
    const { editor, asked } = setup({ address: ISSUE })
    paste(editor, `Look at ${ISSUE_URL} today`)
    expect(asked).toEqual([])
    expect(chips(editor)).toEqual([])
  })

  it('typed over before the lookup answers: nothing is replaced', async () => {
    const { editor, answer } = setup({ address: ISSUE })
    paste(editor, ISSUE_URL)
    editor.commands.setTextSelection({ from: 1, to: 1 + ISSUE_URL.length })
    editor.commands.insertContent('never mind')
    await answer()
    expect(chips(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe('never mind')
  })

  it('a failed lookup leaves the link', async () => {
    editor = new Editor({
      extensions: [peekStarterKit, ObjectMention, PastedUrl.configure({ resolve: () => Promise.reject(new Error('relay down')) })],
      content: '<p></p>',
    })
    paste(editor, ISSUE_URL)
    await new Promise((r) => setTimeout(r, 0))
    expect(chips(editor)).toEqual([])
    expect(editor.state.doc.textContent).toBe(ISSUE_URL)
  })
})

describe('loneUrl', () => {
  it('takes one URL, trimmed, and nothing else', () => {
    expect(loneUrl(`  ${ISSUE_URL}\n`)).toBe(ISSUE_URL)
    expect(loneUrl(`see ${ISSUE_URL}`)).toBeNull()
    expect(loneUrl('nostr:naddr1abc')).toBeNull()
    expect(loneUrl('ship.estiva.app/issue/x')).toBeNull()
  })
})
