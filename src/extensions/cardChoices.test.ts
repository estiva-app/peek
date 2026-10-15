// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'
import { peekStarterKit } from './editorKit'
import { MessageMention, ObjectMention } from './mention'
import { LinkChips, ReferenceNode } from '@estiva-app/ui/editor'
import { addressToPointer, encodeNaddr, encodeNevent } from '@estiva-app/protocol'
import { CardChoices, cardOf, cardOfDecorations, cardsToEdit, cardsToSend, knownLinks, loadCards, referenceAtSelection, setCard, type LinkCardValue } from './cardChoices'
import { serializeTiptapToText } from '@/lib/textParsing'

/**
 * Which card each reference gets, as the message box holds it (OPT-17,
 * SPEC §13.6.2). A paste goes through `view.pasteText`, ProseMirror's own
 * paste path, as a person's paste does: a test that inserted the result
 * passed while production failed (UIG-40's wrap).
 */

const PUBKEY = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE = `30851:${PUBKEY}:b389d20f-b741-4ba8-a28f-97cac351c4c9`
const PROJECT = `30850:${PUBKEY}:ccd30c24-549a-44d0-922d-00f75d84a65e`
const ISSUE_URL = 'https://ship.estiva.app/issue/live-widget-probe-marker-b389d20f-b741-4ba8-a28f-97cac351c4c9'
const naddr = (address: string) => `nostr:${encodeNaddr(addressToPointer(address))}`
const ISSUE_URI = naddr(ISSUE)
const PROJECT_URI = naddr(PROJECT)
const MESSAGE = 'c070bf7ce4433b83ac5988352720fccd2f6527fcd956aca356b010831d1e6742'
const MESSAGE_URI = `nostr:${encodeNevent({ id: MESSAGE, relays: [] })}`

let editor: Editor | undefined
afterEach(() => editor?.destroy())

const settle = () => new Promise((r) => setTimeout(r, 0))

/** An editor whose pasted links resolve to `ISSUE_URL`'s issue, and whose link lookups answer `links`. */
function setup(links: Record<string, string | null> = { [ISSUE_URL]: ISSUE }) {
  const asked: string[] = []
  const cardValue: LinkCardValue = async (url) => {
    asked.push(url)
    return links[url] ?? null
  }
  editor = new Editor({
    extensions: [
      peekStarterKit,
      ObjectMention,
      MessageMention,
      // The composer's URL chip (OPT-19): a pasted app URL becomes it, and is sent as the URL.
      ReferenceNode,
      LinkChips.configure({ referenceOf: (url) => (url === ISSUE_URL ? ISSUE_URI : undefined), ask: null }),
      CardChoices.configure({ cardValue }),
    ],
    content: '<p></p>',
  })
  return { editor, asked }
}

const at = (ed: Editor) => referenceAtSelection(ed.state, knownLinks(ed))

/** A plain-text paste, as a browser hands it over; jsdom has no `ClipboardEvent` . */
function paste(e: Editor, text: string) {
  const clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [] }
  e.view.pasteText(text, { clipboardData, preventDefault() {} } as unknown as ClipboardEvent)
}

describe('a pasted chip', () => {
  it('is offered a card right after the paste, at none, and sends the one chosen', async () => {
    const { editor } = setup()
    editor.commands.insertContent('see ')
    paste(editor, ISSUE_URL)
    await settle()
    // The caret sits after the chip the paste became.
    expect(at(editor)).toMatchObject({ value: ISSUE, kind: 'chip' })
    expect(cardOf(editor, ISSUE)).toBe('none')
    expect(cardsToSend(editor)).toEqual([])

    setCard(editor, ISSUE, 'detailed')
    expect(cardsToSend(editor)).toEqual([{ value: ISSUE, layout: 'detailed' }])
    // The text is untouched: the choice is a tag, never the body.
    expect(serializeTiptapToText(editor)).toBe(`see ${ISSUE_URL}`)
  })

  it('puts its card on the chip for the view to draw its marker, and nothing at none', async () => {
    const { editor } = setup()
    paste(editor, ISSUE_URL)
    await settle()
    // What the chip's node view is handed: the decorations on the chip. (React views do not draw in a bare `Editor`.)
    const marked = () => {
      const chip = editor.state.doc.firstChild!.firstChild!
      expect(chip.type.name).toBe('reference')
      const decorations = editor.state.plugins.flatMap((plugin) => {
        const set = plugin.props.decorations?.call(plugin, editor.state) as DecorationSet | null | undefined
        return set instanceof DecorationSet ? set.find(1, 1 + chip.nodeSize) : []
      })
      return cardOfDecorations(decorations)
    }
    expect(marked()).toBe('none')
    setCard(editor, ISSUE, 'compact')
    expect(marked()).toBe('compact')
    setCard(editor, ISSUE, 'none')
    expect(marked()).toBe('none')
  })
})

describe('a chip from [', () => {
  it('a messageMention for a file or a message offers one, and two chips for one value share it', () => {
    const { editor } = setup()
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'messageMention', attrs: { uri: PROJECT_URI, label: 'Widgets' } },
          { type: 'text', text: ' and ' },
          { type: 'messageMention', attrs: { uri: MESSAGE_URI, label: 'Miky', snippet: 'hello' } },
          { type: 'text', text: ' again ' },
          { type: 'messageMention', attrs: { uri: PROJECT_URI, label: 'Widgets' } },
        ],
      }],
    })
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1)))
    expect(at(editor)).toMatchObject({ value: PROJECT, kind: 'chip' })
    // Where a `[` pick leaves the caret: after the space it adds behind the chip.
    editor.commands.setTextSelection(3)
    expect(at(editor)).toMatchObject({ value: PROJECT, kind: 'chip' })
    editor.commands.setTextSelection(4)
    expect(at(editor)).toBeNull()
    setCard(editor, PROJECT, 'compact')
    setCard(editor, MESSAGE, 'detailed')
    // One per value, in the order the body first names them (§13.6.2).
    expect(cardsToSend(editor)).toEqual([
      { value: PROJECT, layout: 'compact' },
      { value: MESSAGE, layout: 'detailed' },
    ])
  })
})

describe('a link on words', () => {
  it('is offered a card only once its URL is known to name something', async () => {
    const { editor, asked } = setup()
    editor.commands.insertContent('the plan is these words')
    const end = editor.state.doc.content.size - 1
    editor.commands.setTextSelection({ from: end - 'these words'.length, to: end })
    paste(editor, ISSUE_URL)
    expect(serializeTiptapToText(editor)).toBe(`the plan is [these words](${ISSUE_URL})`)
    await settle()
    expect(asked).toEqual([ISSUE_URL])
    editor.commands.setTextSelection(end - 3)
    expect(at(editor)).toMatchObject({ value: ISSUE, kind: 'link' })
    setCard(editor, ISSUE, 'detailed')
    expect(cardsToSend(editor)).toEqual([{ value: ISSUE, layout: 'detailed' }])
  })

  it('a link no app claims, or a block link, is offered nothing', async () => {
    const { editor } = setup({ [ISSUE_URL]: ISSUE })
    editor.commands.setContent(`<p><a href="https://example.com/page">a page</a> and <a href="${ISSUE_URL}#block-0123456789ab">one block</a></p>`)
    await settle()
    editor.commands.setTextSelection(3)
    expect(at(editor)).toBeNull()
    editor.commands.setTextSelection(14)
    expect(at(editor)).toBeNull()
  })
})

describe('an edit', () => {
  const body = () => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'objectMention', attrs: { uri: ISSUE_URI } }] }],
  })

  it('loads the cards the message carries, and sends nothing when they did not change', () => {
    const { editor } = setup()
    editor.commands.setContent(body())
    loadCards(editor, [{ value: ISSUE, layout: 'detailed' }])
    expect(cardOf(editor, ISSUE)).toBe('detailed')
    // An edit carrying no `embed` leaves the set as it was (§6.8).
    expect(cardsToEdit(editor, [{ value: ISSUE, layout: 'detailed' }])).toBeUndefined()
  })

  it('Detailed to Compact replaces the set', () => {
    const { editor } = setup()
    editor.commands.setContent(body())
    loadCards(editor, [{ value: ISSUE, layout: 'detailed' }])
    setCard(editor, ISSUE, 'compact')
    expect(cardsToEdit(editor, [{ value: ISSUE, layout: 'detailed' }])).toEqual([{ value: ISSUE, layout: 'compact' }])
  })

  it('taking the last card away writes none for it, so the chip stays and the card goes', () => {
    const { editor } = setup()
    editor.commands.setContent(body())
    loadCards(editor, [{ value: ISSUE, layout: 'detailed' }])
    setCard(editor, ISSUE, 'none')
    expect(cardsToEdit(editor, [{ value: ISSUE, layout: 'detailed' }])).toEqual([{ value: ISSUE, layout: 'none' }])
  })

  it('a card first chosen in an edit is sent; a value the body no longer names is not', () => {
    const { editor } = setup()
    editor.commands.setContent(body())
    loadCards(editor, [{ value: PROJECT, layout: 'compact' }])
    setCard(editor, ISSUE, 'detailed')
    // The project was taken out of the text: §13.6.2 forbids an `embed` for it.
    expect(cardsToEdit(editor, [{ value: PROJECT, layout: 'compact' }])).toEqual([{ value: ISSUE, layout: 'detailed' }])
  })
})
