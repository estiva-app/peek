/**
 * A link to one block in a description reads as its file's chip, and the chip
 * opens that block (WBM-11; Miky, 19 Oct: "the file's chip everywhere,
 * messages and descriptions alike, and clicking it opens the block").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addrToNaddr } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const UUID = 'a0b27d90-d5b9-40e7-8078-865ab36a421c'
const PAGE = `30851:${SHIP}:${UUID}`
const FILE_LINK = `https://ship.estiva.app/issue/plan-${UUID}`
const BLOCK_LINK = `${FILE_LINK}#block-p1`
const OLD_LINK = `https://ship.estiva.app/#/issue/${UUID}`
const naddr = addrToNaddr(PAGE, [])
const held = vi.hoisted(() => ({ object: undefined as unknown }))
const object = { ref: PAGE, address: PAGE, kind: 30851, appName: 'Ship', noun: 'issue', openUrl: `https://ship.estiva.app/o/${PAGE}`, slots: { title: { value: 'Plan the launch' } }, meta: [], actions: [] }

vi.mock('@/api', () => ({
  useLinkResolver: () => (url: string) => (url.startsWith(FILE_LINK) || url === OLD_LINK ? PAGE : undefined),
  // `held.object`: the file as it came back — undefined while it loads, null when it is gone or cannot be read.
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((r) => [r, r.replace(/^nostr:/, '') === naddr ? held.object : null])),
}))
vi.mock('@/api/mentions', () => ({ personByPubkey: () => undefined, subscribeMentions: () => () => {}, mentionsVersion: () => 0 }))

import { ForeignBody } from './ForeignBody'

const chipOf = (body: string, format: 'marker' | 'blocks' = 'marker') => {
  const { container } = render(
    <MemoryRouter>
      <ForeignBody slot={{ value: body, format }} />
    </MemoryRouter>,
  )
  return container.querySelector('[data-reference="object"]')
}

beforeEach(() => {
  held.object = object
})

describe('a link to one block in a description', () => {
  it('stays the URL as written, a link, while its file loads and once it is gone — never an empty chip', () => {
    for (const state of [undefined, null]) {
      held.object = state
      const { container, unmount } = render(
        <MemoryRouter>
          <ForeignBody slot={{ value: `see ${BLOCK_LINK} here`, format: 'marker' }} />
        </MemoryRouter>,
      )
      expect(container.querySelector('[data-reference]')).toBeNull()
      expect(container.querySelector('a')?.getAttribute('href')).toBe(BLOCK_LINK)
      unmount()
    }
  })

  it('is its file’s chip, opening the block', () => {
    const chip = chipOf(`see ${BLOCK_LINK} here`)
    expect(chip?.textContent).toContain('Plan the launch')
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(BLOCK_LINK)
  })

  it('is its file’s chip in a block document too, written as the URL chip the editor saves', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', id: 'b1', content: [{ type: 'text', text: BLOCK_LINK, marks: [{ type: 'link', attrs: { href: BLOCK_LINK } }] }] }],
    })
    const chip = chipOf(doc, 'blocks')
    expect(chip?.textContent).toContain('Plan the launch')
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(BLOCK_LINK)
  })

  it('a stored reference whose words are another site’s URL opens where its file opens, not those words (security review)', () => {
    const evil = 'https://evil.example/login#block-1'
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', id: 'b1', content: [{ type: 'text', text: evil, marks: [{ type: 'reference', attrs: { uri: `nostr:${naddr}` } }] }] }],
    })
    const chip = chipOf(doc, 'blocks')
    expect(chip?.textContent).toContain('Plan the launch')
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(`https://ship.estiva.app/o/${PAGE}`)
  })

  it('a stored reference alone on its line, whose words are another URL, is its file’s row opening where its file opens (security review)', () => {
    const other = `https://ship.estiva.app/issue/other-b1b27d90-d5b9-40e7-8078-865ab36a421c#block-9`
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', id: 'b1', content: [{ type: 'text', text: other, marks: [{ type: 'reference', attrs: { uri: `nostr:${naddr}` } }] }] }],
    })
    const { container } = render(
      <MemoryRouter>
        <ForeignBody slot={{ value: doc, format: 'blocks' }} cards />
      </MemoryRouter>,
    )
    const row = container.querySelector('[data-link-row]')
    expect(row?.textContent).toContain('Plan the launch')
    expect(row?.querySelector('a')?.getAttribute('href') ?? row?.closest('a')?.getAttribute('href')).toBe(`https://ship.estiva.app/o/${PAGE}`)
  })

  // A click opens the address as written, in the app it names (LTX-6), block or not.
  it('a link to the whole file opens as written', () => {
    const chip = chipOf(`see ${FILE_LINK} here`)
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(FILE_LINK)
  })

  it('an old `#/issue/…` link opens as written, where Ship still serves it', () => {
    const chip = chipOf(`see ${OLD_LINK} here`)
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(OLD_LINK)
  })
})
