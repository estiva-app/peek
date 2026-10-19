/**
 * A link to one block in a description reads as its file's chip, and the chip
 * opens that block (WBM-11; Miky, 19 Oct: "the file's chip everywhere,
 * messages and descriptions alike, and clicking it opens the block").
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addrToNaddr } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const UUID = 'a0b27d90-d5b9-40e7-8078-865ab36a421c'
const PAGE = `30851:${SHIP}:${UUID}`
const FILE_LINK = `https://ship.estiva.app/issue/plan-${UUID}`
const BLOCK_LINK = `${FILE_LINK}#block-p1`
const naddr = addrToNaddr(PAGE, [])
const object = { ref: PAGE, address: PAGE, kind: 30851, appName: 'Ship', noun: 'issue', openUrl: `https://ship.estiva.app/o/${PAGE}`, slots: { title: { value: 'Plan the launch' } } }

vi.mock('@/api', () => ({
  useLinkResolver: () => (url: string) => (url.startsWith(FILE_LINK) ? PAGE : undefined),
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((r) => [r, r.replace(/^nostr:/, '') === naddr ? object : null])),
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

describe('a link to one block in a description', () => {
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

  it('a link to the whole file opens where the file opens, as before', () => {
    const chip = chipOf(`see ${FILE_LINK} here`)
    expect(chip?.closest('a')?.getAttribute('href') ?? chip?.getAttribute('href')).toBe(`https://ship.estiva.app/o/${PAGE}`)
  })
})
