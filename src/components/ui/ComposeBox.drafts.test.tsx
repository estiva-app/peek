/**
 * The composer keeps and restores a draft — CON-10, Peek's half.
 *
 * The claim that needs a test here is not "text comes back" but that it comes
 * back **through the marker text**: a draft is stored as what would be sent
 * (SPEC §13.2), never as the Tiptap document, because that doc is shaped by
 * this app's schema at this version and a release that changes a node would
 * make older drafts unloadable.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ComposeBox, type SendPayload } from './ComposeBox'
import { createDraftStore, draftKeys } from '@/lib/drafts'

/*
  jsdom implements neither `getClientRects` nor `getBoundingClientRect` on text
  nodes, and ProseMirror calls them from `scrollToSelection` whenever the
  document is replaced — which is exactly what restoring a draft does. Without
  this the tests still pass and leave an unhandled error behind, and an
  unhandled error nobody explains is where a real one goes to hide.
*/
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
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

const show = (props: Partial<React.ComponentProps<typeof ComposeBox>>) =>
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox {...props} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )

describe('ComposeBox drafts', () => {
  it('restores a stored draft into the editor', async () => {
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    drafts.write(key, 'half a thought')
    show({ draftKey: key, drafts })
    expect(await screen.findByText('half a thought')).toBeTruthy()
  })

  /*
    Restored through `textToTiptapContent`, the parser a pasted message goes
    through — so a heading comes back as a heading rather than as its marker
    characters. Storing the editor's own JSON would have made this trivially
    true and would have coupled every stored draft to the current schema.
  */
  it('restores structure, not the marker characters', async () => {
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    drafts.write(key, '# A heading')
    const { container } = show({ draftKey: key, drafts })
    await screen.findByText('A heading')
    expect(container.querySelector('h1')).not.toBeNull()
    // The '#' was the marker, not the text.
    expect(container.textContent).not.toContain('# A heading')
  })

  /* PEE-7's first symptom: the destination changing must change the text. */
  it('swaps the text when the destination changes', async () => {
    const drafts = createDraftStore(memoryStorage())
    drafts.write(draftKeys.container('topic-1'), 'meant for one')
    drafts.write(draftKeys.container('topic-2'), 'meant for two')
    const { rerender } = show({ draftKey: draftKeys.container('topic-1'), drafts })
    await screen.findByText('meant for one')
    rerender(
      <MemoryRouter>
        <DebugProvider>
          <PeekDataProvider>
            <ComposeBox draftKey={draftKeys.container('topic-2')} drafts={drafts} />
          </PeekDataProvider>
        </DebugProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('meant for two')).toBeTruthy()
    expect(screen.queryByText('meant for one')).toBeNull()
  })

  it('starts empty for a destination with no draft', async () => {
    const drafts = createDraftStore(memoryStorage())
    drafts.write(draftKeys.container('elsewhere'), 'half a thought')
    // The editor is a contenteditable, not an <input>, so it carries no
    // textbox role here — the ProseMirror node is the surface.
    const { container } = show({ draftKey: draftKeys.container('fresh'), drafts })
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
    expect(container.textContent).not.toContain('half a thought')
  })

  /* No key means no stable destination — the huddle creator, which has no
     huddle yet. Nothing is kept rather than kept under a guessed key. */
  it('keeps nothing when it has no key', async () => {
    const storage = memoryStorage()
    const { container } = show({ drafts: createDraftStore(storage) })
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
    expect(storage.length).toBe(0)
  })
})

/**
 * A refused send does not lose what was typed — CON-10's last clause.
 *
 * This was the one part of the ticket Peek did not honour: `onSend` returned
 * nothing and the editor emptied on Enter regardless, so a send that never
 * reached Convex took the text with it. Ship kept its draft because `act`
 * reports the outcome; Peek had no outcome to report.
 *
 * Peek clears and restores rather than waiting, because the message appears in
 * the list optimistically the instant Enter is pressed — holding the text in the
 * composer as well would show it twice.
 */
describe('ComposeBox — a send that did not land', () => {
  const press = async (container: HTMLElement) => {
    const editor = await waitFor(() => {
      const el = container.querySelector('.ProseMirror')
      if (!el) throw new Error('no editor')
      return el
    })
    fireEvent.keyDown(editor, { key: 'Enter' })
  }

  it('puts the text back in the draft store when onSend resolves false', async () => {
    const storage = memoryStorage()
    const drafts = createDraftStore(storage)
    const key = draftKeys.container('topic-1')
    drafts.write(key, 'the message that did not send')
    const { container } = show({ draftKey: key, drafts, onSend: async () => false })
    await screen.findByText('the message that did not send')

    await press(container)
    await waitFor(() => expect(drafts.read(key)).toBe('the message that did not send'))
  })

  it('  …and back into the editor, since it was left empty', async () => {
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    drafts.write(key, 'the message that did not send')
    const { container } = show({ draftKey: key, drafts, onSend: async () => false })
    await screen.findByText('the message that did not send')

    await press(container)
    expect(await screen.findByText('the message that did not send')).toBeTruthy()
  })

  /* The ordinary path, and the one a caller that knows nothing about this
     contract still gets: `void` means sent. */
  it('forgets the draft when onSend says nothing at all', async () => {
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    drafts.write(key, 'this one goes')
    const { container } = show({ draftKey: key, drafts, onSend: () => {} })
    await screen.findByText('this one goes')

    await press(container)
    await waitFor(() => expect(drafts.read(key)).toBeUndefined())
  })

  /*
    CON-31. The marker text of an urgent mention with a key is the same
    `nostr:npub…` as an ordinary one — the urgency is a tag — so a draft kept
    as text alone came back as an ordinary mention and was sent without it.
  */
  it('keeps an urgent mention urgent: typed, left, restored and sent', async () => {
    const ADA = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    const first = show({ draftKey: key, drafts })
    const typed = await waitFor(() => {
      const el = first.container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
      if (!el?.editor) throw new Error('no editor yet')
      return el.editor
    })
    typed.commands.insertContent([{ type: 'urgentMention', attrs: { id: 'ada', label: 'Ada', pubkey: ADA } }, { type: 'text', text: ' please sign' }])
    await waitFor(() => expect(drafts.readDraft(key)?.urgent).toEqual([ADA]))
    first.unmount()

    const onSend = vi.fn()
    const { container } = show({ draftKey: key, drafts, onSend })
    await screen.findByText(/please sign/)
    expect(container.querySelector('[data-urgent-mention]')).not.toBeNull()
    await press(container)
    expect((onSend.mock.calls[0][0] as SendPayload).urgent).toEqual([ADA])
  })

  it('forgets it on an explicit true, too', async () => {
    const drafts = createDraftStore(memoryStorage())
    const key = draftKeys.container('topic-1')
    drafts.write(key, 'this one goes')
    const { container } = show({ draftKey: key, drafts, onSend: async () => true })
    await screen.findByText('this one goes')

    await press(container)
    await waitFor(() => expect(drafts.read(key)).toBeUndefined())
  })
})
