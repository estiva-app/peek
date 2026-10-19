/**
 * Cards showing one block share one poll, and none reads while the relay has
 * asked clients to pause (COM-2 security review: per-card polling).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const resolve = vi.hoisted(() => vi.fn())
const paused = vi.hoisted(() => ({ ms: 0 }))
vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://estiva.example', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'a'.repeat(64) }), storedToken: () => ({ accessToken: 't', pubkey: 'a'.repeat(64) }) }))
vi.mock('@/nostr/relayBudget', () => ({ relayBudget: { pausedForMs: () => paused.ms } }))
vi.mock('@/nostr/foreign', () => ({
  resolveObjectAsViewer: resolve,
  absenceAsViewer: async () => 'unreadable',
  blockLinkAsViewer: (...args: unknown[]) => blockLink(...args),
}))
const blockLink = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<string | undefined>>(async () => undefined))

import { blockUrlOf, urlPatternsOf } from '@estiva-app/interop'
import { openLinkOf, usePart } from './part'

const D = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const ADDRESS = `30851:${'f'.repeat(64)}:${D}`
function Probe() {
  return <span>{usePart({ address: ADDRESS, block: 'p1' }).state}</span>
}

afterEach(() => {
  resolve.mockReset()
  blockLink.mockReset()
  blockLink.mockResolvedValue(undefined)
  paused.ms = 0
})

/**
 * Open in on a card follows the block link only when it is `https:` and on
 * the object's own host (PEE-51): the shapes it is built from are any member's
 * `kind:31990`, so one can be planted ahead of the owning app's.
 */
describe('Open in, when another member planted a manifest shape', () => {
  const OPEN = 'https://ship.estiva.app/o/naddr1x'
  const SHIP = ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851']
  /** The block link interop builds when the planted shape is read before Ship's. */
  const plantedLink = (pattern: string) =>
    blockUrlOf(urlPatternsOf({ tags: [['urls', pattern, '30851'], SHIP] }), { kind: 30851, d: D, title: 'Plan', block: 'p1' })

  it('takes the block link the owning app declares, on the object host', () => {
    const link = blockUrlOf(urlPatternsOf({ tags: [SHIP] }), { kind: 30851, d: D, title: 'Plan', block: 'p1' })
    expect(link).toBe(`https://ship.estiva.app/issue/plan-${D}#block-p1`)
    expect(openLinkOf(link, OPEN)).toBe(link)
  })

  it('opens the object instead of a planted javascript: shape', () => {
    const link = plantedLink('javascript:alert(document.cookie)//<slug>-<d>#block-<block>')
    expect(link).toMatch(/^javascript:/)
    expect(openLinkOf(link, OPEN)).toBe(OPEN)
  })

  it('opens the object instead of a planted shape on another host', () => {
    const link = plantedLink('https://evil.example/issue/<slug>-<d>#block-<block>')
    expect(link).toBe(`https://evil.example/issue/plan-${D}#block-p1`)
    expect(openLinkOf(link, OPEN)).toBe(OPEN)
  })

  it('opens the object instead of a plain http: block link on the same host name', () => {
    expect(openLinkOf(`http://ship.estiva.app/issue/plan-${D}#block-p1`, OPEN)).toBe(OPEN)
  })

  it('has no link at all when the object link is not https either', () => {
    expect(openLinkOf('javascript:alert(1)', 'javascript:alert(2)')).toBeUndefined()
    expect(openLinkOf('https://ship.estiva.app/issue/x#block-p1', undefined)).toBeUndefined()
  })

  it('gives the card the object link when the block link read back is on another host', async () => {
    resolve.mockResolvedValue({ openUrl: OPEN, slots: { title: { value: 'Planted host' }, body: { value: 'Hello', format: 'marker' } } })
    blockLink.mockResolvedValue('https://evil.example/issue/x#block-p1')
    function Link() {
      const view = usePart({ address: ADDRESS, block: 'p1' })
      return <span data-link>{'link' in view ? view.link : view.state}</span>
    }
    const { container } = render(<Link />)
    await waitFor(() => expect(container.querySelector('[data-link]')?.textContent).toBe(OPEN))
  })
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
