/**
 * Peek's comment box (PEEKM-3): what Peek hands the package's `CommentBox`,
 * and what it sends back out. The box's own behaviour — keys, drafts, files,
 * putting refused words back — is the package's and tested there; these hold
 * what only Peek wires: the text and the urgent keys a send carries, Resolve
 * and the Highlights riding beside the text rather than in it, the launcher
 * writing into the box last used, and a refusal said under the box.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { addrToNaddr, encodeNpub } from '@estiva-app/protocol'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { createDraftStore, draftKeys } from '@/lib/drafts'
import { insertReferenceIntoActiveComposer } from '@/lib/composerRegistry'
import { insertHighlightTag } from '@/extensions/highlight'
import { ConversationBox, type SendAnswer, type SendPayload } from './ConversationBox'

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
async function boxWith(text: string, answer: SendAnswer = { accepted: true }) {
  const onSend = vi.fn<(payload: SendPayload) => Promise<SendAnswer>>(async () => answer)
  const drafts = createDraftStore(memoryStorage())
  const key = draftKeys.container('topic-1')
  drafts.write(key, text)
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationBox draftKey={key} drafts={drafts} onSend={onSend} contextLabel="#Mobile rewrite" />
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
  return { onSend, send, editor: dom.editor! }
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
    // As `/` → Conclusion and `-> ` write them.
    insertHighlightTag(editor, 'conclusion')
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'resolutionBlock', content: [{ type: 'text', text: 'agreed in the call' }] })
    await user.click(send)
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    const payload = onSend.mock.calls[0][0]
    expect(payload.text).toBe('Shipping Thursday')
    expect(payload.resolution).toEqual({ message: 'agreed in the call' })
    expect(payload.highlightType).toBe('conclusion')
  })

  it('sends what the command launcher wrote into the box as the address it names', async () => {
    const user = userEvent.setup()
    const { onSend, send } = await boxWith('Filed it —')
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
})
