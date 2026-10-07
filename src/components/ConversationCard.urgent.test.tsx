/**
 * An urgent mention, after it is sent — CON-24.
 *
 * The text of an urgent mention is the same `nostr:npub…` as an ordinary one;
 * the urgency is the event's `["urgent", <pubkey>]` tag (SPEC §13.1), which
 * reaches the card as `urgentMentions`. The edit box loads the message with
 * those chips urgent, and offers no new urgent pick: an edit (kind:40003)
 * carries no tags, so one could never be sent (Miky, kickoff, 2026-10-07).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Editor } from '@tiptap/react'
import { encodeNpub } from '@estiva-app/protocol'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'

// A sent chip draws its tone only for somebody the directory can name; Ada is not in the demo cast.
vi.mock('@/api/mentions', async (original) => {
  const actual = await original<typeof import('@/api/mentions')>()
  return {
    ...actual,
    personByPubkey: (pubkey: string) =>
      pubkey === 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46' ? { id: 'ada', name: 'Ada Lovelace', role: 'Engineer' } : actual.personByPubkey(pubkey),
  }
})

beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
  Element.prototype.scrollIntoView ??= () => {}
})

const ADA = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const BODY = `ask nostr:${encodeNpub(ADA)} about it`

function card(props: Partial<React.ComponentProps<typeof ConversationCard>> = {}) {
  const onBodyChange = vi.fn()
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationCard authorName="You" timestamp="10:24" body={BODY} onBodyChange={onBodyChange} {...props} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return { container, onBodyChange }
}

async function openEditor(props: Partial<React.ComponentProps<typeof ConversationCard>> = {}) {
  const { container, onBodyChange } = card(props)
  fireEvent.mouseEnter(container.firstElementChild as Element)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByText('Edit message'))
  const dom = await waitFor(() => {
    const el = container.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
    if (!el?.editor) throw new Error('no editor yet')
    return el
  })
  return { dom, editor: dom.editor as Editor, onBodyChange }
}

const type = (editor: Editor, text: string) => act(() => void editor.chain().focus().insertContent(text).run())
const nodeTypes = (editor: Editor) => {
  const out: string[] = []
  editor.state.doc.descendants((node) => void out.push(node.type.name))
  return out
}

describe('an urgent mention in a sent message', () => {
  it('draws its chip urgent when the event names the person urgently', () => {
    const { container } = card({ urgentMentions: [ADA] })
    expect(container.querySelector(`[data-mention="${ADA}"]`)?.className).toContain('bg-warning-muted')
  })

  it('draws the same text as an ordinary mention without the tag', () => {
    const { container } = card()
    const chip = container.querySelector(`[data-mention="${ADA}"]`)
    expect(chip).not.toBeNull()
    expect(chip?.className).not.toContain('bg-warning-muted')
  })
})

describe('an urgent mention in the edit box', () => {
  it('comes back urgent, and Save keeps the text it was sent with', async () => {
    const { dom, editor, onBodyChange } = await openEditor({ urgentMentions: [ADA] })
    expect(nodeTypes(editor)).toContain('urgentMention')
    expect(dom.querySelector('[data-urgent-mention]')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onBodyChange).toHaveBeenCalledWith(BODY)
  })

  it('stays an ordinary mention when the message named nobody urgently', async () => {
    const { editor } = await openEditor()
    expect(nodeTypes(editor)).not.toContain('urgentMention')
  })

  it('is not offered by !@', async () => {
    const { editor } = await openEditor()
    await type(editor, ' !@')
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.queryByRole('listbox', { name: 'Urgent mention' })).toBeNull()
  })

  it('is not offered by /', async () => {
    const { editor } = await openEditor()
    await type(editor, ' /')
    const listbox = await screen.findByRole('listbox')
    expect(listbox.textContent).toContain('Mention')
    expect(listbox.textContent).not.toContain('Urgent')
  })
})
