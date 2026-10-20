/**
 * A pasted block link becomes a `part` (SPEC §13.6.1, COM-2), and an empty
 * read tells deleted from not-yours-to-see.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { absenceAsViewer, forgetUrlShapes, urlReferenceTagsAsViewer } from './foreign'

const UUID = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const AUTHOR = 'f'.repeat(64)
const STRANGER = 'e'.repeat(64)
const ADDRESS = `30851:${AUTHOR}:${UUID}`
const TOKEN = { accessToken: 't', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 60_000 } as never

const manifest = (urls: string) => ({
  id: 'm1',
  kind: 31990,
  pubkey: AUTHOR,
  created_at: 1,
  content: '{}',
  sig: '',
  tags: [['d', 'estiva-ship'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'], ['urls', urls, '30851']],
})
const issue = { id: 'e1', kind: 30851, pubkey: AUTHOR, created_at: 2, content: '', sig: '', tags: [['d', UUID]] }
const deletion = (pubkey: string, tags: string[][]) => ({ id: 'x', kind: 5, pubkey, created_at: 3, content: '', sig: '', tags })

const queryRelay = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

let declared = 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>'
let deletions: unknown[] = []

beforeEach(() => {
  forgetUrlShapes()
  declared = 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>'
  deletions = []
  queryRelay.mockReset()
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
    const kinds = filters[0]?.kinds as number[] | undefined
    if (kinds?.includes(31990)) return { ok: true, events: [manifest(declared)] }
    if (kinds?.includes(5)) return { ok: true, events: deletions }
    const d = (filters[0]?.['#d'] as string[] | undefined)?.[0]
    return { ok: true, events: d === UUID ? [issue] : [] }
  })
})

const link = (block: string) => `https://ship.estiva.app/issue/plan-${UUID}#block-${block}`

describe('a pasted block link', () => {
  it('earns a part beside the a', async () => {
    const tags = await urlReferenceTagsAsViewer([link('8373a025427f')], '', 'https://relay', TOKEN)
    expect(tags).toEqual([
      ['a', ADDRESS],
      ['part', ADDRESS, '8373a025427f'],
    ])
  })

  it('earns only the a while the app declares no block in its links', async () => {
    declared = 'https://ship.estiva.app/issue/<slug>-<d>'
    const tags = await urlReferenceTagsAsViewer([link('8373a025427f')], '', 'https://relay', TOKEN)
    expect(tags).toEqual([['a', ADDRESS]])
  })

  it('writes one part per object, the first link’s', async () => {
    const tags = await urlReferenceTagsAsViewer([link('aaa'), link('bbb')], '', 'https://relay', TOKEN)
    expect(tags.filter((t) => t[0] === 'part')).toEqual([['part', ADDRESS, 'aaa']])
  })

  it('earns nothing for a block of the file the comment is on: the link is its chip only', async () => {
    const tags = await urlReferenceTagsAsViewer([link('aaa')], ADDRESS, 'https://relay', TOKEN)
    expect(tags).toEqual([])
  })
})

describe('an object that did not come back', () => {
  it('is deleted when its author deleted it by address', async () => {
    deletions = [deletion(AUTHOR, [['a', ADDRESS]])]
    expect(await absenceAsViewer(ADDRESS, 'https://relay', TOKEN)).toBe('deleted')
  })

  it('is not available when nothing says it was deleted', async () => {
    expect(await absenceAsViewer(ADDRESS, 'https://relay', TOKEN)).toBe('unreadable')
  })

  it('is not made "deleted" by a stranger riding an unchecked a', async () => {
    deletions = [deletion(STRANGER, [['a', `30851:${STRANGER}:mine`], ['a', ADDRESS]])]
    expect(await absenceAsViewer(ADDRESS, 'https://relay', TOKEN)).toBe('unreadable')
  })
})
