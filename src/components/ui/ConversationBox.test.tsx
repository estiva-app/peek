/**
 * Peek's comment box (PEEKM-3): what Peek hands the package's `CommentBox`,
 * and what it sends back out. The box's own behaviour — keys, drafts, files,
 * putting refused words back — is the package's and tested there; these hold
 * what only Peek wires: the text and the urgent keys a send carries, Resolve
 * and the Highlights riding beside the text rather than in it, the launcher
 * writing into the box last used, and a refusal said under the box.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import type { ForeignObject } from '@estiva-app/interop'
import { addrToNaddr, encodeNpub, valueOfReference, type Embed } from '@estiva-app/protocol'
import { PeekDataProvider } from '@/api'
import { RECORDED_SHIP_ISSUE as recorded } from '@/api/fixtures'
import { DebugProvider } from '@/lib/debug'
import { createDraftStore, draftKeys } from '@/lib/drafts'
import { insertReferenceIntoActiveComposer } from '@/lib/composerRegistry'
import { insertHighlightTag } from '@/extensions/highlight'
import { ConversationBox, EditBox, type EditSaved, type SendAnswer, type SendPayload } from './ConversationBox'
import { PEEK_INSERT_ROWS } from './SlashMenu'

// jsdom has no rects on text nodes, and ProseMirror asks for them when a draft fills the document.
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
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

const ADA = 'ad'.repeat(32)
const ISSUE = `30851:${'b3'.repeat(32)}:launcher-issue`

/** A box opening with `text` as its draft (jsdom cannot type into the editor), and its editor and Send button. */
async function boxWith(text: string, answer: SendAnswer = { accepted: true }, resolvedObjects?: Record<string, ForeignObject>) {
  const onSend = vi.fn<(payload: SendPayload, away: () => boolean) => Promise<SendAnswer>>(async () => answer)
  const drafts = createDraftStore(memoryStorage())
  const key = draftKeys.container('topic-1')
  drafts.write(key, text)
  const { unmount } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationBox draftKey={key} drafts={drafts} onSend={onSend} contextLabel="#Mobile rewrite" resolvedObjects={resolvedObjects} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const dom = (await waitFor(() => {
    const found = document.querySelector('.ProseMirror')
    expect(found).not.toBeNull()
    return found
  })) as HTMLElement & { editor?: Editor }
  const send = screen.getByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  return { onSend, send, editor: dom.editor!, dom, unmount }
}

describe('ConversationBox — what a send carries', () => {
  it('sends a mention as the person’s key, and an urgent one’s key as urgent', async () => {
    const user = userEvent.setup()
    const npub = encodeNpub(ADA)
    const { onSend, send, editor } = await boxWith('please look')
    // As `!@` → Ada writes it.
    editor.commands.insertContentAt(1, [{ type: 'urgentMention', attrs: { id: ADA, label: 'Ada', pubkey: ADA } }, { type: 'text', text: ' ' }])
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const payload = onSend.mock.calls[0][0]
    expect(payload.text).toBe(`nostr:${npub} please look`)
    expect(payload.urgent).toEqual([ADA])
  })

  it('sends a resolution and a highlight beside the text, not in it', async () => {
    const user = userEvent.setup()
    const { onSend, send, editor } = await boxWith('Shipping Thursday')
    // As `-> ` writes the resolution; the tag as a draft from before PEEKM-3 holds it (`/` offers no Highlights now).
    insertHighlightTag(editor, 'conclusion')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'resolutionBlock', content: [{ type: 'text', text: 'agreed in the call' }] })
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const payload = onSend.mock.calls[0][0]
    expect(payload.text).toBe('Shipping Thursday')
    expect(payload.resolution).toEqual({ message: 'agreed in the call' })
    expect(payload.highlightType).toBe('conclusion')
  })

  it('sends `/` Resolve as a resolution, not as the characters `->` in the text', async () => {
    const user = userEvent.setup()
    const { onSend, send, editor } = await boxWith('Shipping Thursday')
    // A fresh line, then the row a person picks from `/`.
    editor.chain().focus('end').splitBlock().run()
    PEEK_INSERT_ROWS.find((row) => row.row.label === 'Resolve')!.run(editor)
    await waitFor(() => expect(editor.getText()).toMatch(/->|→/))
    editor.commands.insertContent('agreed in the call')
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const payload = onSend.mock.calls[0][0]
    expect(payload.text).toBe('Shipping Thursday')
    expect(payload.resolution).toEqual({ message: 'agreed in the call' })
  })

  it('sends what the command launcher wrote into the box as the address it names', async () => {
    const user = userEvent.setup()
    const { onSend, send, editor } = await boxWith('Filed it —')
    // The caret after the words, as a person's is once they have typed them; the draft's arrival otherwise races autofocus.
    editor.commands.focus('end')
    expect(insertReferenceIntoActiveComposer(addrToNaddr(ISSUE, []))).toBe(true)
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0][0].text).toMatch(new RegExp(`^Filed it — ?nostr:${addrToNaddr(ISSUE, [])}`))
  })

  it('says a refusal under the box, with the words back in it', async () => {
    const user = userEvent.setup()
    const { send } = await boxWith('Can we move it to Friday?', { accepted: false, reason: 'blocked: not a member' })
    await user.click(send)
    expect(await screen.findByText(/blocked: not a member/)).toBeInTheDocument()
    expect(screen.getByText('Can we move it to Friday?')).toBeInTheDocument()
  })

  it('tells the send when the person has left the box, so a refusal arriving then is said in a note, not under a box nobody sees', async () => {
    const user = userEvent.setup()
    const { onSend, send, unmount } = await boxWith('Can we move it to Friday?')
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const away = onSend.mock.calls[0][1]
    expect(away?.()).toBe(false)
    // Moving to another topic takes the box away before the relay has answered.
    unmount()
    expect(away?.()).toBe(true)
  })
})

describe('ConversationBox — a link while it is written', () => {
  const resolved = { [recorded.naddr]: recorded.object as unknown as ForeignObject }

  it('draws a link alone on its line as the kit’s chip, its key and title, not as its row', async () => {
    const { dom } = await boxWith(`Words on the line above.
nostr:${recorded.naddr}`, undefined, resolved)
    const chip = await within(dom).findByRole('link', { name: /A project description does not resolve/ })
    expect(chip).toHaveTextContent('RIC-9')
    // A row says what it is under its title ("RIC-9 · Issue"); a chip does not.
    expect(within(dom).queryByText(/RIC-9 · /)).toBeNull()
  })

  it('does not follow the chip when it is clicked while writing', async () => {
    const { dom } = await boxWith(`Filed it: nostr:${recorded.naddr} `, undefined, resolved)
    const chip = await within(dom).findByRole('link', { name: /A project description does not resolve/ })
    // `fireEvent` answers false when the click's default was prevented.
    expect(fireEvent.click(chip)).toBe(false)
  })
})

describe('EditBox — the message’s card', () => {
  const resolved = { [recorded.naddr]: recorded.object as unknown as ForeignObject }
  const value = valueOfReference(`nostr:${recorded.naddr}`)!
  const body = `Tracked in nostr:${recorded.naddr} for now.`

  async function editing(embeds: Embed[]) {
    const onSave = vi.fn<(saved: EditSaved) => void>()
    render(
      <MemoryRouter>
        <DebugProvider>
          <PeekDataProvider>
            <EditBox message={{ body, embeds }} onSave={onSave} onCancel={() => {}} resolvedObjects={resolved} />
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(document.querySelector('.ProseMirror')).not.toBeNull())
    return onSave
  }

  it('shows the card the message has, and ✕ there saves the message with it taken off', async () => {
    const user = userEvent.setup()
    const onSave = await editing([{ value, layout: 'detailed' }])
    const under = await waitFor(() => {
      const found = document.querySelector('[data-box-under]')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(within(under).getByText(/A project description does not resolve/)).toBeInTheDocument()
    await user.click(within(under).getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].embeds).toEqual([{ value, layout: 'none' }])
  })

  it('leaves the message’s card as it is when the edit keeps it', async () => {
    const user = userEvent.setup()
    const onSave = await editing([{ value, layout: 'detailed' }])
    await waitFor(() => expect(document.querySelector('[data-box-under]')).not.toBeNull())
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].embeds).toBeUndefined()
  })

  it('never shows a card taken off before', async () => {
    await editing([{ value, layout: 'none' }])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument())
    expect(document.querySelector('[data-box-under]')).toBeNull()
  })
})
