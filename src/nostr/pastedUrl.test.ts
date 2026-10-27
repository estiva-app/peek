/**
 * A pasted app URL becomes the object it names — RFC 0.5 §7.5, PRO-15, and
 * since PEEKM-7 through the viewer's one link reader (interop's `linkReader`).
 *
 * The mechanism has nothing app-specific in it: read every published manifest,
 * match the link against the shapes they declare, then one `#d` query. What
 * these pin is the part a consumer gets wrong — that a URL nobody claims must
 * stay a plain link, that matching a *host* is what stops any site's URL
 * rendering as somebody's object, and that Peek's reader reads as the viewer
 * and starts afresh for another one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileAddressAsViewer, forgetUrlShapes, linkReaderAsViewer, linkTagsAsViewer, resolveObjectAsViewer } from './foreign'

const UUID = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
const AUTHOR = 'f'.repeat(64)
const TOKEN = { accessToken: 't', pubkey: 'a'.repeat(64), expiresAt: Date.now() + 60_000 } as never

/** What a pasted link names, as the viewer's link reader answers it: an address or an event id, or null. */
const valueOf = async (url: string, token = TOKEN) => (await linkReaderAsViewer('https://relay', token).answerOf(url)).value

const manifest = {
  id: 'm1',
  kind: 31990,
  pubkey: AUTHOR,
  created_at: 1,
  content: '{}',
  sig: '',
  tags: [
    ['d', 'estiva-ship'],
    // A manifest declares `urls` only on the origin it serves, its `web` (SPEC §7.7).
    ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>', '30851'],
    ['urls', 'https://ship.estiva.app/issue/<slug>-<d>#block-<block>', '30851'],
    ['urls', 'https://ship.estiva.app/#/issue/<d>', '30851'],
  ],
}
const EVENT = 'c1d2'.repeat(16)
const peekManifest = {
  ...manifest,
  id: 'm2',
  tags: [
    ['d', 'estiva-peek'],
    ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', '30840'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', '1111'],
    ['urls', 'https://peek.estiva.app/message/<id>', '9'],
  ],
}
const leafManifest = {
  ...manifest,
  id: 'm3',
  tags: [
    ['d', 'estiva-leaf'],
    ['web', 'https://leaf.estiva.app/f/<bech32>', 'naddr'],
    ['urls', 'https://leaf.estiva.app/document/<slug>-<d>#block-<block>', '30842'],
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
    if (kinds?.includes(31990)) return { ok: true, events: [manifest, peekManifest, leafManifest] }
    const d = (filters[0]?.['#d'] as string[] | undefined)?.[0]
    return { ok: true, events: d === UUID ? [issue] : [] }
  })
})

describe('what a pasted link names', () => {
  it('turns a pasted URL into the address of the object it names', async () => {
    // The author comes from the relay, not the URL — §7.4 drops the pubkey, so
    // this is the step that cannot be a pure function.
    expect(await valueOf(`https://ship.estiva.app/issue/billing-entry-${UUID}`)).toBe(`30851:${AUTHOR}:${UUID}`)
  })

  it('names an event by its id and asks the relay nothing more', async () => {
    // A message link and a thread link carry the whole identity (FOL-38); the
    // resolver's `ids` query is the one that learns whether it exists.
    expect(await valueOf(`https://peek.estiva.app/message/${EVENT}`)).toBe(EVENT)
    expect(await valueOf(`https://peek.estiva.app/topic/design-${UUID}?thread=${EVENT}`)).toBe(EVENT)
    expect(queryRelay).toHaveBeenCalledTimes(1) // the manifests, and nothing else
  })

  it('resolves a link published before Ship moved to paths', async () => {
    expect(await valueOf(`https://ship.estiva.app/#/issue/${UUID}`)).toBe(`30851:${AUTHOR}:${UUID}`)
  })

  it('leaves a URL no manifest claims alone, and asks the relay nothing about it', async () => {
    // §7.5: it is a link, and nothing should pretend otherwise. The call count
    // is the point — an ordinary link in a message must not cost a query.
    expect(await valueOf('https://example.com/blog/post')).toBeNull()
    expect(queryRelay).toHaveBeenCalledTimes(1) // the manifests, and nothing else
  })

  it('refuses another host wearing the same path', async () => {
    // The amendment §7.2 needed. Without it, any site's URL renders as a Ship
    // issue inside somebody's conversation.
    expect(await valueOf(`https://evil.example.com/issue/x-${UUID}`)).toBeNull()
  })

  it('names the issue from its path on Leaf’s or Peek’s host, so the message is a mention on it (LTX-6)', async () => {
    // A file's path is the same on every app's host (SPEC §7.7): Miky copies Leaf's address for a Ship issue.
    expect(await valueOf(`https://leaf.estiva.app/issue/billing-entry-${UUID}`)).toBe(`30851:${AUTHOR}:${UUID}`)
    const reader = linkReaderAsViewer('https://relay', TOKEN)
    const url = `https://peek.estiva.app/issue/billing-entry-${UUID}#block-p1`
    expect(await reader.answerOf(url)).toEqual({ value: `30851:${AUTHOR}:${UUID}`, block: { address: `30851:${AUTHOR}:${UUID}`, block: 'p1' } })
  })

  it('a swapped path two apps read as different kinds is looked up under both, and only those', async () => {
    // A wiki app reads `/issue/` as its own kind too; a third kind holding the same `d` is not what the link names.
    const wiki = { ...manifest, id: 'm4', tags: [['d', 'wiki'], ['web', 'https://wiki.example/o/<bech32>', 'naddr'], ['urls', 'https://wiki.example/issue/<slug>-<d>', '30023']] }
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      const kinds = filters[0]?.kinds as number[] | undefined
      if (kinds?.includes(31990)) return { ok: true, events: [manifest, peekManifest, leafManifest, wiki] }
      const held = [issue, { ...issue, id: 'e5', kind: 30818, pubkey: 'e'.repeat(64) }]
      return { ok: true, events: held.filter((event) => !kinds || kinds.includes(event.kind)) }
    })
    expect(await valueOf(`https://leaf.estiva.app/issue/x-${UUID}`)).toBe(`30851:${AUTHOR}:${UUID}`)
  })

  it('names nothing when the object named does not exist, or for a block of a file the reader cannot read', async () => {
    const gone = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    expect(await valueOf(`https://ship.estiva.app/issue/x-${gone}`)).toBeNull()
    expect(await valueOf(`https://ship.estiva.app/issue/plan-${gone}#block-p1`)).toBeNull()
  })

  /*
    §13.6.2, one author for the identity: anybody can publish the same
    (kind, d), so a d two authors hold names nothing — else whichever the
    relay answered first would put its card or its mention under a link to
    the other's file.
  */
  // A relay holding `held`: it answers by kind and stops at the filter's limit, as buzz does.
  const relayHolding = (held: (typeof issue)[]) =>
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      const kinds = filters[0]?.kinds as number[] | undefined
      if (kinds?.includes(31990)) return { ok: true, events: [manifest, peekManifest] }
      const limit = (filters[0]?.limit as number | undefined) ?? Infinity
      return { ok: true, events: held.filter((event) => !kinds || kinds.includes(event.kind)).slice(0, limit) }
    })

  it('names nothing when two authors hold the `d`: a member publishing the same identity cannot take the mention', async () => {
    relayHolding([{ ...issue, id: 'e2', pubkey: 'e'.repeat(64) }, issue])
    expect(await valueOf(`https://ship.estiva.app/issue/plan-${UUID}`)).toBeNull()
  })

  it('names nothing when only another kind holds the d the link names', async () => {
    relayHolding([{ ...issue, id: 'e3', kind: 30023, pubkey: 'e'.repeat(64) }])
    expect(await valueOf(`https://ship.estiva.app/issue/plan-${UUID}`)).toBeNull()
  })

  it('a refused read rejects, so the next ask gets the answer (4136f999)', async () => {
    vi.useFakeTimers()
    try {
      let refuse = true
      queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
        if ((filters[0]?.kinds as number[] | undefined)?.includes(31990)) return { ok: true, events: [manifest, peekManifest] }
        return refuse ? { ok: false, reason: 'rate-limited' } : { ok: true, events: [issue] }
      })
      const url = `https://ship.estiva.app/issue/x-${UUID}`
      await expect(valueOf(url)).rejects.toThrow()
      refuse = false
      expect(await valueOf(url)).toBe(`30851:${AUTHOR}:${UUID}`)
    } finally {
      vi.useRealTimers()
    }
  })

  describe('when the first manifest read comes back empty (a relay still starting, a read that raced sign-in)', () => {
    let published: unknown[]
    beforeEach(() => {
      vi.useFakeTimers()
      published = []
      queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
        if ((filters[0]?.kinds as number[] | undefined)?.includes(31990)) return { ok: true, events: published }
        const d = (filters[0]?.['#d'] as string[] | undefined)?.[0]
        return { ok: true, events: d === UUID ? [issue] : [] }
      })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('the link draws as a plain link meanwhile, not as an error', async () => {
      await expect(resolveObjectAsViewer(`https://ship.estiva.app/issue/plan-${UUID}`, 'https://relay', TOKEN)).resolves.toBeNull()
    })

    it('the next ask names the object once the relay has the manifests, with no reload', async () => {
      const url = `https://ship.estiva.app/issue/plan-${UUID}`
      await expect(valueOf(url)).rejects.toThrow()
      published = [manifest]
      await expect(valueOf(url)).resolves.toBe(`30851:${AUTHOR}:${UUID}`)
    })
  })

  it('asks again as another viewer: one sign-in’s answers are not the next one’s', async () => {
    const url = `https://ship.estiva.app/issue/plan-${UUID}`
    expect(await valueOf(url)).toBe(`30851:${AUTHOR}:${UUID}`)
    // The second viewer cannot read the issue.
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      if ((filters[0]?.kinds as number[] | undefined)?.includes(31990)) return { ok: true, events: [manifest] }
      return { ok: true, events: [] }
    })
    const other = { accessToken: 'u', pubkey: 'b'.repeat(64), expiresAt: Date.now() + 60_000 } as never
    expect(await valueOf(url, other)).toBeNull()
    expect(queryRelay.mock.calls.at(-1)?.[3]).toBe('b'.repeat(64))
  })
})

describe('the tags a message’s words earn for its links', () => {
  it('indexes an object as `a` and an event as `q`, never as `e`, and nothing for a link no app claims', async () => {
    // On a kind:1111 a lowercase `e` is NIP-22's parent; a root carrying one
    // would read as a reply to what it merely mentioned.
    const tags = await linkTagsAsViewer(
      `https://ship.estiva.app/issue/billing-${UUID} and https://peek.estiva.app/message/${EVENT} and https://example.com/blog/post`,
      { file: '30840:own:file' },
      'https://relay',
      TOKEN,
    )
    expect(tags).toEqual([
      ['a', `30851:${AUTHOR}:${UUID}`],
      ['q', EVENT],
    ])
  })

  it('leaves out the file the comment is on, and says each reference once', async () => {
    const tags = await linkTagsAsViewer(
      `https://ship.estiva.app/issue/a-${UUID} https://ship.estiva.app/issue/b-${UUID}`,
      { file: `30851:${AUTHOR}:${UUID}` },
      'https://relay',
      TOKEN,
    )
    expect(tags).toEqual([])
  })
})

/*
  The page `/<word>/<slug>-<d>` opens (LTX-6 security review): with a file's
  path on every app's host, more links land here, so a member who publishes the
  same `(kind, d)` after the author must not take the page — two holders open
  nothing, as the pasted-link readers above answer.
*/
describe('fileAddressAsViewer', () => {
  it('opens the one author who holds the `d`', async () => {
    expect(await fileAddressAsViewer('issue', UUID, 'https://relay', TOKEN)).toBe(`30851:${AUTHOR}:${UUID}`)
  })

  it('opens nothing when a second author holds the same `d`', async () => {
    const copy = { ...issue, id: 'e2', pubkey: 'b'.repeat(64), created_at: 3 }
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      const kinds = filters[0]?.kinds as number[] | undefined
      if (kinds?.includes(31990)) return { ok: true, events: [manifest, peekManifest, leafManifest] }
      // Newest first, as the relay answers: the copy would win a `limit: 1`.
      return { ok: true, events: [copy, issue].slice(0, Number(filters[0]?.limit ?? 2)) }
    })
    expect(await fileAddressAsViewer('issue', UUID, 'https://relay', TOKEN)).toBeNull()
  })
})
