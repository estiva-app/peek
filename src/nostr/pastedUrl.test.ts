/**
 * A pasted app URL becomes the object it names — RFC 0.5 §7.5, PRO-15.
 *
 * The mechanism has nothing app-specific in it: read every published manifest,
 * match the link against the shapes they declare, then one `#d` query. What
 * these pin is the part a consumer gets wrong — that a URL nobody claims must
 * stay a plain link, and that matching a *host* is what stops any site's URL
 * rendering as somebody's object.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { referenceFromUrlAsViewer, forgetUrlShapes, urlReferenceTagsAsViewer } from './foreign'

const UUID = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const AUTHOR = 'f'.repeat(64)
const TOKEN = { accessToken: 't', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 60_000 } as never

const manifest = {
  id: 'm1',
  kind: 31990,
  pubkey: AUTHOR,
  created_at: 1,
  content: '{}',
  sig: '',
  tags: [
    ['d', 'estiva-ship'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>', '30851'],
    ['urls', 'https://ship.estiva.app/#/issue/<d>', '30851'],
  ],
}
const EVENT = 'c1d2'.repeat(16)
const peekManifest = {
  ...manifest,
  id: 'm2',
  tags: [
    ['d', 'estiva-peek'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', '1111'],
    ['urls', 'https://peek.estiva.app/message/<id>', '9'],
  ],
}

const issue = { id: 'e1', kind: 30851, pubkey: AUTHOR, created_at: 2, content: '', sig: '', tags: [['d', UUID]] }

const queryRelay = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

beforeEach(() => {
  forgetUrlShapes()
  queryRelay.mockReset()
  // `queryRelay` answers `{ ok, events }`, not a bare array — `viewerQuery`
  // unwraps it and throws a RelayReadError when `ok` is false.
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
    const kinds = filters[0]?.kinds as number[] | undefined
    if (kinds?.includes(31990)) return { ok: true, events: [manifest, peekManifest] }
    const d = (filters[0]?.['#d'] as string[] | undefined)?.[0]
    return { ok: true, events: d === UUID ? [issue] : [] }
  })
})

describe('referenceFromUrlAsViewer', () => {
  it('turns a pasted URL into the address of the object it names', async () => {
    // The author comes from the relay, not the URL — §7.4 drops the pubkey, so
    // this is the step that cannot be a pure function.
    const address = await referenceFromUrlAsViewer(
      `https://ship.estiva.app/issue/billing-entry-${UUID}`,
      'https://relay',
      TOKEN,
    )
    expect(address).toEqual({ address: `30851:${AUTHOR}:${UUID}` })
  })

  it('names an event by its id and asks the relay nothing more', async () => {
    // A message link and a thread link carry the whole identity (FOL-38); the
    // resolver's `ids` query is the one that learns whether it exists.
    expect(await referenceFromUrlAsViewer(`https://peek.estiva.app/message/${EVENT}`, 'https://relay', TOKEN)).toEqual({
      eventId: EVENT,
    })
    expect(
      await referenceFromUrlAsViewer(`https://peek.estiva.app/topic/design-${UUID}?thread=${EVENT}`, 'https://relay', TOKEN),
    ).toEqual({ eventId: EVENT })
    expect(queryRelay).toHaveBeenCalledTimes(1) // the manifests, and nothing else
  })

  it('resolves a link published before Ship moved to paths', async () => {
    expect(await referenceFromUrlAsViewer(`https://ship.estiva.app/#/issue/${UUID}`, 'https://relay', TOKEN)).toEqual({
      address: `30851:${AUTHOR}:${UUID}`,
    })
  })

  it('leaves a URL no manifest claims alone, and asks the relay nothing about it', async () => {
    // §7.5: it is a link, and nothing should pretend otherwise. The call count
    // is the point — an ordinary link in a message must not cost a query.
    expect(await referenceFromUrlAsViewer('https://example.com/blog/post', 'https://relay', TOKEN)).toBe(null)
    expect(queryRelay).toHaveBeenCalledTimes(1) // the manifests, and nothing else
  })

  it('refuses another host wearing the same path', async () => {
    // The amendment §7.2 needed. Without it, any site's URL renders as a Ship
    // issue inside somebody's conversation.
    expect(await referenceFromUrlAsViewer(`https://evil.example.com/issue/x-${UUID}`, 'https://relay', TOKEN)).toBe(null)
  })

  it('returns null when the object named does not exist', async () => {
    const gone = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(await referenceFromUrlAsViewer(`https://ship.estiva.app/issue/x-${gone}`, 'https://relay', TOKEN)).toBe(null)
  })

  it('names nothing when two authors hold the `d`: a member publishing the same identity cannot take the mention', async () => {
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      if ((filters[0]?.kinds as number[] | undefined)?.includes(31990)) return { ok: true, events: [manifest, peekManifest] }
      return { ok: true, events: [issue, { ...issue, id: 'e2', pubkey: 'c'.repeat(64) }] }
    })
    expect(await referenceFromUrlAsViewer(`https://ship.estiva.app/issue/x-${UUID}`, 'https://relay', TOKEN)).toBe(null)
  })

  it('reads the published shapes once for the whole session', async () => {
    for (let i = 0; i < 3; i++) {
      await referenceFromUrlAsViewer(`https://ship.estiva.app/issue/a-${UUID}`, 'https://relay', TOKEN)
    }
    const manifestReads = queryRelay.mock.calls.filter((c) => {
      const kinds = (c[1] as Record<string, unknown>[])[0]?.kinds as number[] | undefined
      return kinds?.includes(31990) ?? false
    })
    expect(manifestReads).toHaveLength(1)
  })
})

describe('urlReferenceTagsAsViewer', () => {
  it('indexes an object as `a` and an event as `q`, never as `e`', async () => {
    // On a kind:1111 a lowercase `e` is NIP-22's parent; a root carrying one
    // would read as a reply to what it merely mentioned.
    const tags = await urlReferenceTagsAsViewer(
      [
        `https://ship.estiva.app/issue/billing-${UUID}`,
        `https://peek.estiva.app/message/${EVENT}`,
        'https://example.com/blog/post',
      ],
      '30840:own:file',
      'https://relay',
      TOKEN,
    )
    expect(tags).toEqual([
      ['a', `30851:${AUTHOR}:${UUID}`],
      ['q', EVENT],
    ])
  })

  it('leaves out the file the comment is on, and says each reference once', async () => {
    const tags = await urlReferenceTagsAsViewer(
      [`https://ship.estiva.app/issue/a-${UUID}`, `https://ship.estiva.app/issue/b-${UUID}`],
      `30851:${AUTHOR}:${UUID}`,
      'https://relay',
      TOKEN,
    )
    expect(tags).toEqual([])
  })
})
