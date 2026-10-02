/**
 * What the composer *sends* for a mention — RIC-11, second attempt.
 *
 * `textParsing.references.test.ts` proves the serializer writes a topic as
 * `nostr:naddr…` and a message as `nostr:nevent…`. It proved that about the
 * edit path only: the composer had a serializer of its own, the first pointer
 * mention typed on production went out as `[Feedback on Ship]` with the
 * message node dropped, and no test noticed because none went through
 * `ComposeBox`. This one does — nodes in the editor, Enter, and the text the
 * `onSend` payload carries — so the two writers can never again be one.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ComposeBox, type SendPayload } from './ComposeBox'

/* Same reason as ComposeBox.drafts.test.tsx: jsdom has neither on text nodes
   and ProseMirror calls both whenever the document changes. */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

const RELAY = 'ab'.repeat(32)
const UUID = '0212db6d-bcbf-40d0-890e-f4f056db2f5d'
const ADDRESS = `39000:${RELAY}:${UUID}`
const EVENT = 'cd'.repeat(32)
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`

/** The composer, and its editor once Tiptap has mounted it (`dom.editor`). */
async function compose(onSend: (payload: SendPayload) => void) {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox onSend={onSend} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const dom = await waitFor(() => {
    const el = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    if (!el?.editor) throw new Error('no editor yet')
    return el
  })
  return { dom, editor: dom.editor as Editor }
}

const send = (dom: HTMLElement) => fireEvent.keyDown(dom, { key: 'Enter' })

describe('ComposeBox sends a mention as a pointer (RIC-11)', () => {
  it('a topic with an address goes out as nostr:naddr…, never as its title', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([
      { type: 'text', text: 'see ' },
      { type: 'topicMention', attrs: { id: 't1', label: 'Feedback on Ship', isResolved: false, address: ADDRESS } },
      { type: 'text', text: ' first' },
    ])
    send(dom)
    expect(onSend).toHaveBeenCalledTimes(1)
    const { text } = onSend.mock.calls[0][0] as SendPayload
    expect(text).toBe(`see nostr:${addrToNaddr(ADDRESS, [])} first`)
    expect(text).not.toContain('Feedback on Ship')
  })

  it('a message goes out as the nostr:nevent… it was picked as, not dropped', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([
      { type: 'text', text: 'as in ' },
      { type: 'messageMention', attrs: { id: EVENT, label: 'Ada', snippet: 'Green.', uri: NEVENT } },
      { type: 'text', text: ' yesterday' },
    ])
    send(dom)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect((onSend.mock.calls[0][0] as SendPayload).text).toBe(`as in ${NEVENT} yesterday`)
  })

  it('a topic Peek cannot address still goes out in the bracket form', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([
      { type: 'topicMention', attrs: { id: 't2', label: 'Office layout', isResolved: false, address: null } },
      { type: 'text', text: 'today' },
    ])
    send(dom)
    expect((onSend.mock.calls[0][0] as SendPayload).text).toBe('[Office layout] today')
  })
})

describe("ComposeBox sends another app's object as its address (UIG-40)", () => {
  const ISSUE = `nostr:${addrToNaddr(`30851:${RELAY}:${UUID}`, [])}`

  it('the chip goes out as the nostr:naddr… it holds, exactly', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([
      { type: 'text', text: 'Filed it: ' },
      { type: 'objectMention', attrs: { uri: ISSUE } },
      { type: 'text', text: ' ' },
    ])
    // The sent message's chip, not a link while it is being written.
    const chip = dom.querySelector('[data-reference]')
    expect(chip).not.toBeNull()
    expect(chip?.closest('a')).toBeNull()
    send(dom)
    expect((onSend.mock.calls[0][0] as SendPayload).text).toBe(`Filed it: ${ISSUE}`)
  })

  // A pasted address becoming the chip is proved in Chrome, on the ComposeBox
  // story: jsdom has no clipboard, and Tiptap's simulated paste fails inside
  // Tiptap without one.
})

describe('ComposeBox sends an urgent mention with its pubkey beside the text (CON-17)', () => {
  const ADA = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
  const urgentAda = { type: 'urgentMention', attrs: { id: 'ada', label: 'Ada', pubkey: ADA } }

  it('on Enter, the text is a plain mention and `urgent` names the person', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([urgentAda, { type: 'text', text: ' now' }])
    send(dom)
    const payload = onSend.mock.calls[0][0] as SendPayload
    expect(payload.text).not.toContain('!@')
    expect(payload.urgent).toEqual([ADA])
  })

  it('a plain mention carries no urgency', async () => {
    const onSend = vi.fn()
    const { dom, editor } = await compose(onSend)
    editor.commands.insertContent([{ type: 'mention', attrs: { id: 'ada', label: 'Ada', pubkey: ADA } }, { type: 'text', text: ' fyi' }])
    send(dom)
    expect((onSend.mock.calls[0][0] as SendPayload).urgent).toBeUndefined()
  })
})
