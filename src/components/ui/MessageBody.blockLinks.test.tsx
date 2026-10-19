/**
 * A link to one block of a file reads as that file (WBM-11; Miky, 19 Oct: "yes,
 * that's the whole point"): in a sentence it is the file's chip where the URL
 * was, and the chip opens the block; alone on its line it draws nothing while
 * its `part` shows the block under the message (C26); with no part for it (an
 * older message, another app's) it is the file's row. A link nothing answered
 * stays the URL as written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { addrToNaddr, markerTextToBlockDocument } from '@estiva-app/protocol'
import type { PartView } from '@/api'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const UUID = 'a0b27d90-d5b9-40e7-8078-865ab36a421c'
const PAGE = `30851:${SHIP}:${UUID}`
const BLOCK_LINK = `https://ship.estiva.app/issue/plan-${UUID}#block-p1`
const UNREAD_LINK = `https://ship.estiva.app/issue/secret-${'b'.repeat(8)}-0000-4000-8000-000000000000#block-p2`
const naddr = addrToNaddr(PAGE, [])

const object = {
  ref: PAGE,
  address: PAGE,
  eventId: 'e'.repeat(64),
  kind: 30851,
  widget: 'row',
  appName: 'Ship',
  noun: 'issue',
  openUrl: `https://ship.estiva.app/o/${PAGE}`,
  slots: { title: { value: 'Plan the launch' } },
  meta: [],
  comments: [],
  actions: [],
}
let answers: Record<string, string> = {}

vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  hasRelay: true,
  isFromCopy: () => false,
  // What the app's one resolver answers for each link (§7.7): a block link, its file.
  useLinkResolver: () => (url: string) => answers[url],
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((r) => [r, r.replace(/^nostr:/, '') === naddr ? object : null])),
  useHeldObject: () => ({ object: 'loading', reload: async () => {}, gone: false }),
  useForeignObjects: () => ({ applyAction: async () => ({ ok: true }) }),
  useWorkspaceDirectory: () => ({}),
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  usePart: (): PartView => ({ state: 'resolved', block: markerTextToBlockDocument('Ship it on Friday').content[0], object: object as never, link: BLOCK_LINK }),
}))
vi.mock('@/api/mentions', () => ({ personByPubkey: () => undefined, subscribeMentions: () => () => {}, mentionsVersion: () => 0 }))

import { MessageBody } from './MessageBody'

const PART = [{ address: PAGE, block: 'p1' }]
const show = (body: string, parts?: { address: string; block: string }[]) => render(<MessageBody body={body} parts={parts} />).container
const part = (c: HTMLElement) => c.querySelector('[data-part]')
const rows = (c: HTMLElement) => [...c.querySelectorAll('[data-link-row]')].map((row) => row.textContent)

beforeEach(() => {
  answers = { [BLOCK_LINK]: PAGE }
})

describe('a link to one block reads as its file', () => {
  it('in a sentence is the file’s chip where the URL was, the block live under the message', () => {
    const c = show(`see ${BLOCK_LINK} here`, PART)
    expect(c.querySelector('p')?.textContent).toBe('see Plan the launch here')
    expect(c.textContent).not.toContain(BLOCK_LINK)
    expect(part(c)?.textContent).toContain('Ship it on Friday')
  })

  it('opens the block, not the top of its file, from its chip', () => {
    const c = show(`see ${BLOCK_LINK} here`, PART)
    const chip = [...c.querySelectorAll('p a')].find((a) => a.textContent?.includes('Plan the launch'))
    expect(chip?.getAttribute('href')).toBe(BLOCK_LINK)
  })

  it('alone on its line draws nothing in its place: the block under the message stands for it', () => {
    const c = show(BLOCK_LINK, PART)
    expect(rows(c)).toEqual([])
    expect(c.textContent).not.toContain(BLOCK_LINK)
    expect(part(c)?.textContent).toContain('Ship it on Friday')
    // No chip either: everything the message draws is the part.
    expect(c.textContent).toBe(part(c)?.textContent)
  })

  it('alone on its line with no part for it (an older message) is the file’s row, opening the block', () => {
    const c = show(BLOCK_LINK)
    expect(rows(c)).toEqual(['Plan the launch'])
    expect(c.querySelector('[data-link-row] a')?.getAttribute('href')).toBe(BLOCK_LINK)
  })

  it('stays the URL as written when nothing answered for it (a file the reader cannot read, or gone)', () => {
    const c = show(`see ${UNREAD_LINK} here`)
    expect(c.textContent).toContain(UNREAD_LINK)
    expect(c.textContent).not.toContain('Plan the launch')
  })
})
