/**
 * Cards showing one block share one poll, and none reads while the relay has
 * asked clients to pause (COM-2 security review: per-card polling).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const resolve = vi.hoisted(() => vi.fn())
const paused = vi.hoisted(() => ({ ms: 0 }))
vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://estiva.example', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'a'.repeat(64) }) }))
vi.mock('@/nostr/relayBudget', () => ({ relayBudget: { pausedForMs: () => paused.ms } }))
vi.mock('@/nostr/foreign', () => ({
  resolveObjectAsViewer: resolve,
  absenceAsViewer: async () => 'unreadable',
  blockLinkAsViewer: async () => undefined,
}))

import { usePart } from './part'

const ADDRESS = `30851:${'f'.repeat(64)}:b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5`
function Probe() {
  return <span>{usePart({ address: ADDRESS, block: 'p1' }).state}</span>
}

afterEach(() => {
  resolve.mockReset()
  paused.ms = 0
})

describe('usePart', () => {
  it('reads once for two cards on the same block', async () => {
    resolve.mockResolvedValue(null)
    const { getAllByText } = render(
      <>
        <Probe />
        <Probe />
      </>,
    )
    await waitFor(() => expect(getAllByText('unreadable')).toHaveLength(2))
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('does not read while the relay has asked for a pause', async () => {
    paused.ms = 5_000
    const { unmount } = render(<Probe />)
    await new Promise((r) => setTimeout(r, 20))
    expect(resolve).not.toHaveBeenCalled()
    unmount()
  })
})

/**
 * A comment's anchor is a run of blocks and the words at its ends (§13.6,
 * LEAF-7), read against the page as it is now — the states the production
 * probe saw, here through Peek's own read.
 */
describe('usePart, for a comment anchored to a selection', () => {
  const p = (id: string, text: string) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })
  const page = (...content: unknown[]) => ({ slots: { title: { value: 'Plan' }, body: { value: JSON.stringify({ type: 'doc', content }), format: 'blocks' } } })
  const FIRST = page(p('p1', 'We ship on Friday.'), p('p2', 'QA signs off.'), p('p3', 'Then we announce it.'))
  // "ship on Fr" … "Then we" — mid-paragraph to mid-paragraph.
  const PASSAGE = [['block', 'p1', 'p2', 'p3'], ['quote', 'ship on Friday.', 'Then we']]

  function Anchored({ tags }: { tags: string[][] }) {
    const view = usePart({ address: ADDRESS, block: tags[0][1], anchorTags: tags })
    const blocks = 'block' in view ? (view.run ?? [view.block]).map((b) => b.id).join(',') : ''
    const quote = view.state === 'reworded' ? view.quote.start : ''
    return <span data-view>{[view.state, blocks, quote].filter(Boolean).join(' ')}</span>
  }
  /** What the card was given once the read came back. */
  async function readOf(tags: string[][]) {
    const { container } = render(<Anchored tags={tags} />)
    const text = () => container.querySelector('[data-view]')?.textContent
    await waitFor(() => expect(text()).not.toBe('loading'))
    return text()
  }

  it('reads every block of a passage, a paragraph inserted in the middle included', async () => {
    resolve.mockResolvedValue(page(p('p1', 'We ship on Friday.'), p('p2', 'QA sign off.'), p('px', 'Inserted.'), p('p3', 'Then we announce it.')))
    expect(await readOf(PASSAGE)).toBe('resolved p1,p2,px,p3')
  })

  it('reads as reworded, with what the commenter quoted, once the words it starts with change', async () => {
    resolve.mockResolvedValue(page(p('p1', 'We ship next week.'), p('p2', 'QA signs off.'), p('p3', 'Then we announce it.')))
    expect(await readOf(PASSAGE)).toBe('reworded p1,p2,p3 ship on Friday.')
  })

  it('keeps two whole paragraphs found after their words change, since it quoted none', async () => {
    resolve.mockResolvedValue(page(p('p1', 'Rewritten.'), p('p2', 'Also rewritten.'), p('p3', 'Then we announce it.')))
    expect(await readOf([['block', 'p1', 'p2']])).toBe('resolved p1,p2')
  })

  it('reads as detached once every block of the run is gone', async () => {
    resolve.mockResolvedValue(page(p('q1', 'A different page now.')))
    expect(await readOf(PASSAGE)).toBe('detached')
  })

  it('finds a few words inside one paragraph', async () => {
    resolve.mockResolvedValue(FIRST)
    expect(await readOf([['block', 'p2'], ['quote', 'signs off']])).toBe('resolved p2')
  })
})
