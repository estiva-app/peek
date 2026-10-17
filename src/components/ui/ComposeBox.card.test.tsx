/**
 * The message box adds one file's card under itself, removed with ✕
 * (4136f999; record a-link-on-words-counts-toward-the-card). What it sends is
 * asserted on what Send hands the conversation, which writes it as the
 * message's `embed` tags (`composeComment`).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addressToPointer, encodeNaddr } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { createDraftStore, draftKeys } from '@/lib/drafts'
import { ComposeBox, type SendPayload } from './ComposeBox'

// jsdom has no rects on text nodes, and ProseMirror asks for them (ComposeBox.send.test.tsx).
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

const SHIP = 'a'.repeat(64)
const ISSUE = `30851:${SHIP}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
const OTHER = `30851:${SHIP}:e0b27d90-d5b9-40e7-8078-865ab36a421c`
const FOLDER = `39000:${SHIP}:c0b27d90-d5b9-40e7-8078-865ab36a421c`
const ref = (address: string) => `nostr:${encodeNaddr(addressToPointer(address))}`
/** What the relay would answer for each file, handed in through the box's seam: no relay in a test. */
const object = (address: string, title: string) =>
  ({ ref: address, address, eventId: 'e'.repeat(64), kind: 30851, widget: 'row', slots: { title: { value: title } }, meta: [], comments: [], actions: [] }) as unknown as ForeignObject
const RESOLVED = { [ref(ISSUE)]: object(ISSUE, 'The plan'), [ref(OTHER)]: object(OTHER, 'The other one') }

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

/** A box holding `text` (through a draft — jsdom cannot type into Tiptap), on `here`'s conversation. */
async function boxWith(text: string, here?: string) {
  const onSend = vi.fn<(payload: SendPayload) => void>()
  const drafts = createDraftStore(memoryStorage())
  const key = draftKeys.container('topic-1')
  drafts.write(key, text)
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox draftKey={key} drafts={drafts} onSend={onSend} here={here} resolvedObjects={RESOLVED} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const send = screen.getByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  return { onSend, send, container }
}

const sent = (onSend: ReturnType<typeof vi.fn<(payload: SendPayload) => void>>) => onSend.mock.calls[0]?.[0]

describe('ComposeBox — one file’s card under the box', () => {
  it('linking one issue shows its card under the box, and Send writes it detailed', async () => {
    const { onSend, send, container } = await boxWith(`the plan ${ref(ISSUE)} for now`)
    await waitFor(() => expect(container.querySelector('[data-box-under]')?.textContent).toContain('The plan'))
    fireEvent.mouseDown(send)
    expect(sent(onSend)?.embeds).toEqual([{ value: ISSUE, layout: 'detailed' }])
  })

  it('✕ before sending sends no card', async () => {
    const { onSend, send, container } = await boxWith(`the plan ${ref(ISSUE)} for now`)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }))
    await waitFor(() => expect(container.querySelector('[data-box-under]')).toBeNull())
    fireEvent.mouseDown(send)
    expect(sent(onSend)?.embeds).toBeUndefined()
  })

  it('an issue beside a Folder keeps its card; two issues get none', async () => {
    const first = await boxWith(`${ref(ISSUE)} in ${ref(FOLDER)}`)
    fireEvent.mouseDown(first.send)
    expect(sent(first.onSend)?.embeds).toEqual([{ value: ISSUE, layout: 'detailed' }])
    first.container.remove()

    const second = await boxWith(`${ref(ISSUE)} and ${ref(OTHER)}`)
    expect(second.container.querySelector('[data-box-under]')).toBeNull()
    fireEvent.mouseDown(second.send)
    expect(sent(second.onSend)?.embeds).toBeUndefined()
  })

  it('the issue whose conversation this is gets no card', async () => {
    const { onSend, send, container } = await boxWith(`about ${ref(ISSUE)}`, ISSUE)
    expect(container.querySelector('[data-box-under]')).toBeNull()
    fireEvent.mouseDown(send)
    expect(sent(onSend)?.embeds).toBeUndefined()
  })

  it('a lone link draws its row in the box, and there is no Card button', async () => {
    const { container } = await boxWith(`Words on the line above.\n${ref(ISSUE)}`)
    await waitFor(() => expect(container.querySelector('.ProseMirror [data-box-row]')?.textContent).toContain('The plan'))
    expect(await screen.findByRole('button', { name: 'Remove card' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Card' })).toBeNull()
  })
})
