/**
 * A file's conversation as Peek's own view reads and writes it — FOL-31.
 *
 * The read folds three relay answers — threads by `#e`, the raw events for
 * their tags, and the decorations `@estiva-app/conversation` folds (edits, reactions,
 * resolutions) — into one shape the view draws from. The writes are the
 * kinds the rest of the suite already agrees on: `1111` for a comment and a
 * reply, `40003` for an edit, `7` for a reaction, `9101` for a resolution,
 * `5` to take any of them back. Each is pinned here by its tags, because a
 * wrong tag publishes for ever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeNaddr, encodeNpub } from '@estiva-app/protocol'
import { boxLinksOf, embedsToSend, messageReference } from '@estiva-app/conversation'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async () => ({ ok: true as const })),
  signViaEstivaId: vi.fn(async (event: Record<string, unknown>) => ({ ...event, id: 'signed'.padEnd(64, '0'), sig: '' })),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import {
  CHANNEL_PAGE,
  PUBLISH_ATTEMPTS,
  attachmentsOf,
  channelConversationAsViewer,
  commentAsViewer,
  deleteEventAsViewer,
  publishConfirmed,
  editCommentAsViewer,
  fileConversationAsViewer,
  fileThreadsAsViewer,
  partsAndAnchorOf,
  reactAsViewer,
  resolveAsViewer,
  type ConversationContainer,
} from './fileConversation'
import { forgetUrlShapes } from './foreign'

const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const MIKY = 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const BARE_FILE = 30840
const COMMENT = 1111
const ADDRESS = `${BARE_FILE}:${CATH}:estiva-suits-updates`
const container: ConversationContainer = { kind: 'file', address: ADDRESS, h: FOLDER }
/** Another bare file, in another Folder — what a comment here can name (CON-11). */
const OTHER_FOLDER = '7a1c2d3e-4f05-4bebd-5b1b-6e4f479d3e6b'
const OTHER = `${BARE_FILE}:${CATH}:roadmap`
const OTHER_NADDR = `nostr:${encodeNaddr({ kind: BARE_FILE, pubkey: CATH, identifier: 'roadmap', relays: [] })}`
const OWN_NADDR = `nostr:${encodeNaddr({ kind: BARE_FILE, pubkey: CATH, identifier: 'estiva-suits-updates', relays: [] })}`
const token = { accessToken: 't', pubkey: MIKY } as never

interface TestEvent {
  id: string
  sig: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

let seq = 0
const event = (partial: Partial<TestEvent> & { kind: number }): TestEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: CATH,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

/** The bare file's built-in manifest, as interop's `BARE_FILE_MANIFEST_ADDRESS` resolves it. */
const manifest = event({
  kind: 31990,
  tags: [['d', 'bare-file'], ['k', String(BARE_FILE)]],
  content: JSON.stringify({
    name: 'File',
    projections: { [BARE_FILE]: { widget: 'card', slots: { title: { tag: 'title' } } } },
    actions: [
      {
        id: 'comment',
        label: 'Comment',
        appliesTo: String(BARE_FILE),
        emits: { kind: COMMENT, scope: 'address' },
        input: { type: 'string' },
      },
    ],
  }),
})
const file = event({ kind: BARE_FILE, tags: [['d', 'estiva-suits-updates'], ['title', 'Estiva Suits Updates'], ['h', FOLDER]] })
/* A file a person links to by URL rather than by pointer (FOL-38): its `d` is
   a uuid, as every linkable file's is, and Peek's manifest says what the link
   looks like. */
const LINKED_D = '4f9d2c1e-7b3a-4e5f-9a1b-2c3d4e5f6a7b'
const linked = event({ kind: BARE_FILE, tags: [['d', LINKED_D], ['title', 'Linked'], ['h', FOLDER]] })
const peekManifest = event({
  kind: 31990,
  tags: [
    ['d', 'estiva-peek'],
    ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>', String(BARE_FILE)],
    ['urls', 'https://peek.estiva.app/topic/<slug>-<d>?thread=<id>', String(COMMENT)],
    ['urls', 'https://peek.estiva.app/message/<id>', '9'],
  ],
  content: JSON.stringify({ name: 'Peek', projections: {} }),
})

const root = event({
  kind: COMMENT,
  content: 'First',
  tags: [['A', ADDRESS], ['K', String(BARE_FILE)], ['P', CATH], ['a', ADDRESS], ['k', String(BARE_FILE)], ['p', CATH], ['h', FOLDER]],
})
const withPicture = event({
  kind: COMMENT,
  content: 'See attached',
  tags: [
    ['a', ADDRESS],
    ['h', FOLDER],
    ['imeta', 'url https://relay.test/media/abc', 'm image/png', 'x abc123', 'size 2048', 'thumb https://relay.test/media/abc/thumb', 'filename shot.png'],
    ['a', `30851:${CATH}:some-issue`],
  ],
})
/** A root on the other file whose body names this one: this file's `#a` returns it, and it is not a comment here. */
const mentionFromElsewhere = event({
  kind: COMMENT,
  content: `Compare with ${OWN_NADDR}`,
  tags: [['A', OTHER], ['K', String(BARE_FILE)], ['P', CATH], ['a', OTHER], ['k', String(BARE_FILE)], ['p', CATH], ['h', OTHER_FOLDER], ['a', ADDRESS]],
})
/** A topic message naming this file: the `#a` read returns it, its `a` is a mention (SPEC §6.4, CON-14). */
const topicMessageNamingThis = event({
  kind: 9,
  content: `Let's talk about ${OWN_NADDR}`,
  tags: [['h', OTHER_FOLDER], ['a', ADDRESS]],
})
/** A topic message anchored to this file before REW-10 — a comment only where the owner declares kind:9 (§7.3 `alsoRead`), which the projection has already checked. */
const legacyTopicComment = event({ kind: 9, content: 'Anchored the old way', tags: [['h', FOLDER], ['a', ADDRESS]] })
const reply = event({
  kind: COMMENT,
  content: 'Agreed',
  pubkey: MIKY,
  tags: [['A', ADDRESS], ['e', root.id], ['k', String(COMMENT)], ['p', CATH], ['h', FOLDER]],
})
const edit = event({ kind: 40003, pubkey: CATH, content: 'First, corrected', tags: [['h', FOLDER], ['e', root.id]] })
const reaction = event({ kind: 7, pubkey: MIKY, content: '👍', tags: [['e', root.id]] })
const resolved = event({
  kind: 9101,
  pubkey: MIKY,
  content: 'done',
  tags: [['h', FOLDER], ['e', root.id], ['t', 'resolution'], ['action', 'resolved'], ['e', reply.id, '', 'support']],
})

function relayOver(world: TestEvent[]) {
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: world.filter((e) =>
      filters.some((f) => {
        if (f.ids && !(f.ids as string[]).includes(e.id)) return false
        if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
        for (const [key, want] of Object.entries(f)) {
          if (!key.startsWith('#')) continue
          const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
          if (!(want as string[]).some((v) => held.includes(v))) return false
        }
        return true
      }),
    ),
  }))
}

const signed = () => signViaEstivaId.mock.calls[0][0] as { kind: number; tags: string[][]; content: string }

beforeEach(() => {
  publishSigned.mockClear()
  signViaEstivaId.mockClear()
  forgetUrlShapes()
  queryRelay.mockImplementation(
    relayOver([manifest, peekManifest, file, linked, root, withPicture, mentionFromElsewhere, topicMessageNamingThis, legacyTopicComment, reply, edit, reaction, resolved]),
  )
})

describe('fileConversationAsViewer reads the whole conversation below the roots', () => {
  it('returns the roots in the order asked, their replies, and their tags', async () => {
    const found = await fileConversationAsViewer(container, [withPicture.id, root.id], 'https://relay.test', token)
    expect(found.roots.map((r) => r.id)).toEqual([withPicture.id, root.id])
    expect(found.replies[root.id]?.map((r) => r.body)).toEqual(['Agreed'])
    expect(found.roots[0].files).toMatchObject([
      {
        name: 'shot.png',
        contentType: 'image/png',
        size: 2048,
        sha256: 'abc123',
        mediaUrl: 'https://relay.test/media/abc',
        thumbUrl: 'https://relay.test/media/abc/thumb',
      },
    ])
    // The file's own address is the container, not a reference.
    expect(found.roots[0].references).toEqual([`30851:${CATH}:some-issue`])
  })

  it('carries what was done to each root and reply: the edit, the reactions, the resolution', async () => {
    const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
    const d = found.decorations.byId[root.id]
    // The edit folded for the body, the mark and the files (`@estiva-app/conversation`, CON-5).
    expect(d.edit).toEqual({ body: 'First, corrected', edited: true, editedAt: edit.created_at * 1000, editedBy: CATH })
    expect(d.reactions).toEqual([{ id: reaction.id, target: root.id, emoji: '👍', by: MIKY, at: reaction.created_at }])
    expect(d.resolutions).toEqual([
      { id: resolved.id, action: 'resolved', by: MIKY, at: resolved.created_at, message: 'done', supportingEventId: reply.id },
    ])
    // A reply is a target too, so a reaction on it would be found.
    expect(found.decorations.byId[reply.id]).toEqual({ reactions: [], resolutions: [] })
    expect(found.decorations).toMatchObject({ reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false })
  })

  it('drops a root that is a comment on another file naming this one — that is Activity, not the conversation', async () => {
    const found = await fileConversationAsViewer(container, [root.id, mentionFromElsewhere.id], 'https://relay.test', token)
    expect(found.roots.map((r) => r.id)).toEqual([root.id])
  })

  it('drops a topic message whose body names this file, and keeps a kind:9 the owner declares, anchored the pre-REW-10 way (CON-14, §7.3)', async () => {
    const found = await fileConversationAsViewer(
      container,
      [root.id, topicMessageNamingThis.id, legacyTopicComment.id],
      'https://relay.test',
      token,
    )
    expect(found.roots.map((r) => r.id)).toEqual([root.id, legacyTopicComment.id])
  })

  it('drops a root the relay no longer returns — a deleted comment is gone, not blank', async () => {
    const found = await fileConversationAsViewer(container, [root.id, 'f'.repeat(64)], 'https://relay.test', token)
    expect(found.roots.map((r) => r.id)).toEqual([root.id])
  })

  describe('a deleted comment whose replies stay (PER-24)', () => {
    const GONE = 'd'.repeat(64)
    const orphan = (content: string, at: number) =>
      event({
        kind: COMMENT,
        content,
        pubkey: MIKY,
        created_at: at,
        tags: [['A', ADDRESS], ['K', String(BARE_FILE)], ['P', CATH], ['e', GONE], ['k', String(COMMENT)], ['p', CATH], ['h', FOLDER]],
      })
    const later = orphan('Still here', 1_800_000_200)
    const earlier = orphan('Me too', 1_800_000_100)
    const world = [manifest, peekManifest, file, linked, root, withPicture, reply, edit, reaction, resolved, later, earlier]

    it('draws them under a stand-in for the deleted root, dated by its first reply', async () => {
      queryRelay.mockImplementation(relayOver(world))
      const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
      const standIn = found.roots.find((r) => r.id === GONE)
      expect(standIn).toMatchObject({ deleted: true, author: '', body: '', createdAt: earlier.created_at })
      expect(found.replies[GONE]?.map((r) => r.body)).toEqual(['Me too', 'Still here'])
      // Nothing is asked about the stand-in itself; its replies are targets as usual.
      expect(found.decorations.byId[GONE]).toBeUndefined()
      expect(found.decorations.byId[later.id]).toEqual({ reactions: [], resolutions: [] })
    })

    it('draws them when the deleted comment was the file’s only one', async () => {
      queryRelay.mockImplementation(relayOver(world))
      const found = await fileConversationAsViewer(container, [], 'https://relay.test', token)
      expect(found.roots.map((r) => r.id)).toEqual([GONE])
    })

    it('draws them on the re-read right after the delete, while the roots asked about still name it', async () => {
      queryRelay.mockImplementation(relayOver(world))
      const found = await fileConversationAsViewer(container, [root.id, GONE], 'https://relay.test', token)
      expect(found.roots.map((r) => r.id)).toEqual([root.id, GONE])
      expect(found.roots[1].deleted).toBe(true)
      expect(found.replies[GONE]?.map((r) => r.body)).toEqual(['Me too', 'Still here'])
    })

    it('still draws the conversation when the read for them is refused', async () => {
      const relay = relayOver(world)
      queryRelay.mockImplementation(async (url: string, filters: Record<string, unknown>[]) =>
        filters.some((f) => '#A' in f) ? { ok: false as const, reason: 'rate-limited: slow down' } : relay(url, filters),
      )
      const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
      expect(found.roots.map((r) => r.id)).toEqual([root.id])
      expect(found.replies[root.id]?.map((r) => r.body)).toEqual(['Agreed'])
    })

    it('takes the parent SPEC §6.4 names — never a mention-marked e, which quotes (CON-5)', async () => {
      const quoting = event({ kind: COMMENT, content: 'Quote and parent', tags: [['A', ADDRESS], ['e', 'c'.repeat(64), '', 'mention'], ['e', GONE], ['h', FOLDER]] })
      queryRelay.mockImplementation(relayOver([...world.filter((e) => e !== later && e !== earlier), quoting]))
      const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
      expect(found.roots.map((r) => r.id)).toEqual([root.id, GONE])
      expect(found.replies[GONE]?.map((r) => r.id)).toEqual([quoting.id])
    })

    it('with several unmarked e, the parent is the first — a quote goes in q or a mention-marked e (SPEC §6.4)', async () => {
      const QUOTED = 'c'.repeat(64)
      const unmarked = event({ kind: COMMENT, content: 'Two e', tags: [['A', ADDRESS], ['e', QUOTED], ['e', GONE], ['h', FOLDER]] })
      queryRelay.mockImplementation(relayOver([...world.filter((e) => e !== later && e !== earlier), unmarked]))
      const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
      expect(found.replies[QUOTED]?.map((r) => r.id)).toEqual([unmarked.id])
      expect(found.replies[GONE]).toBeUndefined()
    })

    it('leaves alone a reply whose parent the relay still holds', async () => {
      const toHeld = event({ kind: COMMENT, content: 'On a root not asked about', tags: [['A', ADDRESS], ['e', withPicture.id], ['h', FOLDER]] })
      queryRelay.mockImplementation(relayOver([...world.filter((e) => e !== later && e !== earlier), toHeld]))
      const found = await fileConversationAsViewer(container, [root.id], 'https://relay.test', token)
      expect(found.roots.map((r) => r.id)).toEqual([root.id])
    })

    // The read-only panes, used where the viewer cannot comment, read the same way (PEE-40).
    it('the read-only panes’ thread read finds them too', async () => {
      queryRelay.mockImplementation(relayOver(world))
      const found = await fileThreadsAsViewer(ADDRESS, [root.id], 'https://relay.test', token)
      expect(found.deleted).toEqual([{ id: GONE, createdAt: earlier.created_at }])
      expect(found.replies[GONE]?.map((r) => r.body)).toEqual(['Me too', 'Still here'])
      expect(found.replies[root.id]?.map((r) => r.body)).toEqual(['Agreed'])
      expect(Object.keys(found.roots)).toEqual([root.id])
    })

    it('the read-only panes keep their threads when the read for them is refused', async () => {
      const relay = relayOver(world)
      queryRelay.mockImplementation(async (url: string, filters: Record<string, unknown>[]) =>
        filters.some((f) => '#A' in f) ? { ok: false as const, reason: 'rate-limited: slow down' } : relay(url, filters),
      )
      const found = await fileThreadsAsViewer(ADDRESS, [root.id], 'https://relay.test', token)
      expect(found.deleted).toEqual([])
      expect(found.replies[root.id]?.map((r) => r.body)).toEqual(['Agreed'])
    })
  })

  it('reports a refused read as a failure, never as an empty conversation', async () => {
    queryRelay.mockImplementation(async () => ({ ok: false as const, reason: 'restricted: relay_membership_required' }))
    await expect(fileConversationAsViewer(container, [root.id], 'https://relay.test', token)).rejects.toMatchObject({
      kind: 'not_a_member',
    })
  })
})

describe('commentAsViewer publishes the owner’s comment with the composer’s whole payload', () => {
  it('a root comment: kind 1111 on the file, its attachment as imeta, its mention as p', async () => {
    const body = `Looks good nostr:${encodeNpub(CATH)}`
    const result = await commentAsViewer(
      {
        container,
        body,
        files: [{ name: 'shot.png', contentType: 'image/png', size: 2048, sha256: 'abc123', mediaUrl: 'https://relay.test/media/abc' }],
      },
      'https://relay.test',
      token,
    )
    expect(result).toEqual({ ok: true, id: 'signed'.padEnd(64, '0') })
    const published = signed()
    expect(published.kind).toBe(COMMENT)
    expect(published.content).toBe(body)
    expect(published.tags).toContainEqual(['a', ADDRESS])
    expect(published.tags).toContainEqual(['h', FOLDER])
    expect(published.tags).toContainEqual(['p', CATH])
    const imeta = published.tags.find((t) => t[0] === 'imeta')
    expect(imeta).toContain('url https://relay.test/media/abc')
    expect(imeta).toContain('x abc123')
    expect(imeta).toContain('filename shot.png')
  })

  it('an urgent mention on a comment carries an urgent tag only for a person the body names (CON-17)', async () => {
    // MIKY's chip was deleted before sending: the composer still lists him, the text does not.
    await commentAsViewer({ container, body: `Now please nostr:${encodeNpub(CATH)}`, urgent: [CATH, MIKY, CATH] }, 'https://relay.test', token)
    const tags = signed().tags
    expect(tags.filter((t) => t[0] === 'urgent')).toEqual([['urgent', CATH]])
    expect(tags).toContainEqual(['p', CATH])
  })

  it('the box’s one file goes out as its detailed embed, and the file the conversation is on gets none (4136f999)', async () => {
    const body = `See ${OTHER_NADDR}, unlike ${OWN_NADDR}`
    const links = boxLinksOf(body, { resolveLink: () => undefined, blockOf: () => undefined, here: ADDRESS })
    await commentAsViewer({ container, body, embeds: embedsToSend(links, new Set()) }, 'https://relay.test', token)
    expect(signed().tags.filter((t) => t[0] === 'embed')).toEqual([['embed', OTHER, 'detailed']])
  })

  it('a pasted link to another block of the page it is on writes no part, and a block of another page does (COMM-8)', async () => {
    const SECOND_D = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
    const second = event({ kind: BARE_FILE, tags: [['d', SECOND_D], ['title', 'Second'], ['h', FOLDER]] })
    const blocks = event({
      kind: 31990,
      tags: [['d', 'estiva-peek'], ['web', 'https://peek.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://peek.estiva.app/topic/<slug>-<d>#block-<block>', String(BARE_FILE)]],
      content: JSON.stringify({ name: 'Peek', projections: {} }),
    })
    queryRelay.mockImplementation(relayOver([manifest, blocks, file, linked, second]))
    const page = `${BARE_FILE}:${CATH}:${LINKED_D}`
    await commentAsViewer(
      {
        container: { kind: 'file', address: page, h: FOLDER },
        body: `Like https://peek.estiva.app/topic/linked-${LINKED_D}#block-own1 and https://peek.estiva.app/topic/second-${SECOND_D}#block-b2`,
      },
      'https://relay.test',
      token,
    )
    expect(signed().tags.filter((t) => t[0] === 'part')).toEqual([['part', `${BARE_FILE}:${CATH}:${SECOND_D}`, 'b2']])
  })

  it('a root that names another file carries its address as a, and never its own file twice (CON-11)', async () => {
    await commentAsViewer({ container, body: `See ${OTHER_NADDR}, unlike ${OWN_NADDR}` }, 'https://relay.test', token)
    expect(signed().tags.filter((t) => t[0] === 'a')).toEqual([['a', ADDRESS], ['a', OTHER]])
  })

  it('a pasted app URL is indexed too: an object as a, an event as q (FOL-38)', async () => {
    // A URL is prose until it is sent, so the index is written here, from the
    // same relay read the widget will make. `q`, not `e`: on a kind:1111 the
    // lowercase `e` is the parent, and a root carrying one would file itself
    // as a reply to what it merely mentioned.
    const thread = 'd'.repeat(64)
    await commentAsViewer(
      {
        container,
        body:
          `Compare https://peek.estiva.app/topic/linked-${LINKED_D} with ` +
          `https://peek.estiva.app/topic/x-${LINKED_D}?thread=${thread} and https://example.com/not-ours`,
      },
      'https://relay.test',
      token,
    )
    const tags = signed().tags
    expect(tags.filter((t) => t[0] === 'a')).toEqual([['a', ADDRESS], ['a', `${BARE_FILE}:${CATH}:${LINKED_D}`]])
    expect(tags.filter((t) => t[0] === 'q')).toEqual([['q', thread]])
    expect(tags.filter((t) => t[0] === 'e')).toEqual([])
  })

  it('a [ pick earns the same q as a pasted link to that message, and the two are one tag (CON-25)', async () => {
    const thread = 'd'.repeat(64)
    await commentAsViewer(
      { container, body: `${messageReference(thread, 1111)} — https://peek.estiva.app/topic/x-${LINKED_D}?thread=${thread}` },
      'https://relay.test',
      token,
    )
    expect(signed().tags.filter((t) => t[0] === 'q')).toEqual([['q', thread]])
  })

  it('a pointer and its link to the same file are one a tag', async () => {
    const linkedNaddr = `nostr:${encodeNaddr({ kind: BARE_FILE, pubkey: CATH, identifier: LINKED_D, relays: [] })}`
    await commentAsViewer(
      { container, body: `${linkedNaddr} — https://peek.estiva.app/topic/linked-${LINKED_D}` },
      'https://relay.test',
      token,
    )
    expect(signed().tags.filter((t) => t[0] === 'a')).toEqual([['a', ADDRESS], ['a', `${BARE_FILE}:${CATH}:${LINKED_D}`]])
  })

  it('a reply that names another file carries its address as a, beside the parent trio', async () => {
    const parent = { id: root.id, author: CATH, body: 'First', createdAt: root.created_at, kind: COMMENT }
    await commentAsViewer({ container, body: `Also ${OTHER_NADDR}`, parent }, 'https://relay.test', token)
    const tags = signed().tags
    expect(tags).toContainEqual(['A', ADDRESS])
    expect(tags).toContainEqual(['e', root.id])
    expect(tags.filter((t) => t[0] === 'a')).toEqual([['a', OTHER]])
  })

  it('a file the relay does not hold is not named — an imeta at no blob is refused with the event', async () => {
    await commentAsViewer(
      { container, body: 'no blob', files: [{ name: 'lost.png', contentType: 'image/png', size: 1 }] },
      'https://relay.test',
      token,
    )
    expect(signed().tags.some((t) => t[0] === 'imeta')).toBe(false)
  })

  it('a reply: the lowercase trio names the parent and no lowercase a remains', async () => {
    const parent = { id: root.id, author: CATH, body: 'First', createdAt: root.created_at, kind: COMMENT }
    await commentAsViewer({ container, body: 'Agreed.', parent }, 'https://relay.test', token)
    const published = signed()
    expect(published.tags).toContainEqual(['A', ADDRESS])
    expect(published.tags).toContainEqual(['e', root.id])
    expect(published.tags).toContainEqual(['k', String(COMMENT)])
    expect(published.tags).toContainEqual(['p', CATH])
    expect(published.tags.some((t) => t[0] === 'a')).toBe(false)
    expect(published.tags).toContainEqual(['h', FOLDER])
  })

  it('a reply to a comment on blocks copies its block and quote, so the thread keeps its place once the comment is deleted (§13.6)', async () => {
    const place = [['block', 'p1', 'p2'], ['quote', 'the words', '0', '9']]
    const parent = { id: root.id, author: CATH, body: 'First', createdAt: root.created_at, kind: COMMENT, place }
    await commentAsViewer({ container, body: 'Agreed.', parent }, 'https://relay.test', token)
    const tags = signed().tags
    expect(tags).toContainEqual(['block', 'p1', 'p2'])
    expect(tags).toContainEqual(['quote', 'the words', '0', '9'])
  })

  it('reports the relay’s refusal in its words', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'blocked: not a member' } as never)
    const result = await commentAsViewer({ container, body: 'x' }, 'https://relay.test', token)
    expect(result).toEqual({ ok: false, reason: 'blocked: not a member' })
  })
})

describe('the decorations are written as the suite agrees them', () => {
  it('an edit is a kind:40003 naming the comment and the Folder', async () => {
    await editCommentAsViewer({ container, targetEventId: root.id, body: 'First, corrected', files: [] }, 'https://relay.test', token)
    const published = signed()
    expect(published.kind).toBe(40003)
    expect(published.content).toBe('First, corrected')
    expect(published.tags).toContainEqual(['e', root.id])
    expect(published.tags).toContainEqual(['h', FOLDER])
  })

  it('a reaction is a kind:7 with the emoji as content', async () => {
    await reactAsViewer({ targetEventId: root.id, emoji: '🎉' }, 'https://relay.test', token)
    const published = signed()
    expect(published.kind).toBe(7)
    expect(published.content).toBe('🎉')
    expect(published.tags).toContainEqual(['e', root.id])
  })

  it('a resolution is a kind:9101 t=resolution with its action, rationale and the reply that carried it', async () => {
    await resolveAsViewer(
      { container, targetEventId: root.id, action: 'resolved', message: 'shipped', supportingEventId: reply.id },
      'https://relay.test',
      token,
    )
    const published = signed()
    expect(published.kind).toBe(9101)
    expect(published.content).toBe('shipped')
    expect(published.tags).toContainEqual(['t', 'resolution'])
    expect(published.tags).toContainEqual(['action', 'resolved'])
    expect(published.tags).toContainEqual(['h', FOLDER])
    expect(published.tags).toContainEqual(['e', root.id])
    expect(published.tags).toContainEqual(['e', reply.id, '', 'support'])
  })

  it('a deletion is a kind:5 naming the event, whichever kind it was', async () => {
    await deleteEventAsViewer(reaction.id, 'https://relay.test', token)
    const published = signed()
    expect(published.kind).toBe(5)
    expect(published.tags).toContainEqual(['e', reaction.id])
  })
})

/*
  REM-1 — a DM is a channel container: its `kind:9` messages, read by `#h` and
  written with `buildMessage`, threaded by `@estiva-app/conversation` (CON-5).
  The rules themselves — which tag is a comment, how edits and reactions fold —
  are the package's, with its conformance tests (C10–C16); this file tests
  Peek's reads and writes around them.
*/
describe('a channel conversation (REM-1)', () => {
  const DM = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'
  const dmContainer: ConversationContainer = { kind: 'channel', h: DM }
  const hello = event({ kind: 9, pubkey: MIKY, content: 'Hello', tags: [['h', DM]] })
  const picture = event({
    kind: 9,
    content: 'Here it is',
    tags: [['h', DM], ['imeta', 'url https://relay.test/media/def', 'm image/jpeg', 'x def456', 'size 4096', 'filename photo.jpg']],
  })
  const answer = event({ kind: 9, content: 'Hi!', tags: [['h', DM], ['e', hello.id, '', 'reply']] })
  /** A reply to a reply: filed under its thread's root, the `root`-marked `e` (SPEC §6.4, CON-5). */
  const nested = event({ kind: 9, pubkey: MIKY, content: 'deep', tags: [['h', DM], ['e', hello.id, '', 'root'], ['e', answer.id, '', 'reply']] })
  /** Another channel's message: `#h` is the whole membership of the read. */
  const elsewhere = event({ kind: 9, content: 'not here', tags: [['h', FOLDER]] })
  const helloEdited = event({ kind: 40003, pubkey: MIKY, content: 'Hello there', tags: [['h', DM], ['e', hello.id]] })
  const liked = event({ kind: 7, content: '❤️', tags: [['e', answer.id]] })
  const done = event({ kind: 9101, content: '', tags: [['h', DM], ['e', hello.id], ['t', 'resolution'], ['action', 'resolved']] })

  beforeEach(() => {
    queryRelay.mockClear()
    queryRelay.mockImplementation(relayOver([hello, picture, answer, nested, elsewhere, helloEdited, liked, done]))
  })

  it('reads the messages by #h, puts each reply under its thread, and folds what was done to them', async () => {
    const found = await channelConversationAsViewer(DM, 'https://relay.test', token)
    expect(found.roots.map((r) => r.body)).toEqual(['Hello', 'Here it is'])
    expect(found.replies[hello.id]?.map((r) => r.body)).toEqual(['Hi!', 'deep'])
    expect(Object.keys(found.replies)).toEqual([hello.id])
    expect(found.roots[1].files).toMatchObject([
      { name: 'photo.jpg', contentType: 'image/jpeg', size: 4096, sha256: 'def456', mediaUrl: 'https://relay.test/media/def' },
    ])
    expect(found.decorations.byId[hello.id].edit?.body).toBe('Hello there')
    expect(found.decorations.byId[answer.id].reactions.map((r) => r.emoji)).toEqual(['❤️'])
    expect(found.decorations.byId[hello.id].resolutions.map((r) => r.action)).toEqual(['resolved'])
    // A kind list on every `#h` read: a kindless one is refused outright.
    const first = queryRelay.mock.calls[0][1] as Record<string, unknown>[]
    expect(first).toEqual([{ kinds: [9], '#h': [DM], limit: CHANNEL_PAGE }])
  })

  it('reads the cards a message asks for, and an edit that chooses again replaces them (SPEC §13.6.2)', async () => {
    const issue = `30851:${CATH}:f0b27d90`
    const asks = event({ kind: 9, pubkey: MIKY, content: 'see it', tags: [['h', DM], ['embed', issue, 'detailed']] })
    const keeps = event({ kind: 9, pubkey: MIKY, content: 'and this', tags: [['h', DM], ['embed', issue, 'compact']] })
    const removed = event({ kind: 40003, pubkey: MIKY, content: 'see it', tags: [['h', DM], ['e', asks.id], ['embed', issue, 'none']] })
    // An edit with no `embed` leaves the set as it was.
    const reworded = event({ kind: 40003, pubkey: MIKY, content: 'and that', tags: [['h', DM], ['e', keeps.id]] })
    queryRelay.mockImplementation(relayOver([asks, keeps, removed, reworded]))
    const found = await channelConversationAsViewer(DM, 'https://relay.test', token)
    expect(found.roots.map((r) => r.embeds)).toEqual([[{ value: issue, layout: 'detailed' }], [{ value: issue, layout: 'compact' }]])
    expect(found.editedEmbeds).toEqual({ [asks.id]: [{ value: issue, layout: 'none' }] })
  })

  it('reads the whole channel: a full page is followed by the next, until a short one', async () => {
    const many = Array.from({ length: CHANNEL_PAGE + 5 }, (_, i) =>
      event({ kind: 9, content: `m${i}`, created_at: 1_600_000_000 + i, tags: [['h', DM]] }),
    )
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
      const f = filters[0]
      if (!(f.kinds as number[]).includes(9)) return { ok: true as const, events: [] }
      const until = f.until as number | undefined
      const events = many
        .filter((e) => until === undefined || e.created_at <= until)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, f.limit as number)
      return { ok: true as const, events }
    })
    const found = await channelConversationAsViewer(DM, 'https://relay.test', token)
    expect(found.roots).toHaveLength(CHANNEL_PAGE + 5)
    expect(found.roots[0].body).toBe('m0')
  })

  it('reports a refused read as a failure, never as an empty conversation', async () => {
    queryRelay.mockResolvedValueOnce({ ok: false, reason: 'restricted: relay_membership_required' })
    await expect(channelConversationAsViewer(DM, 'https://relay.test', token)).rejects.toThrow()
  })

  it('a message is a kind:9 in the channel, its attachment as imeta and its mention as p — no 1111', async () => {
    const body = `For you nostr:${encodeNpub(CATH)}`
    const result = await commentAsViewer(
      {
        container: dmContainer,
        body,
        files: [{ name: 'photo.jpg', contentType: 'image/jpeg', size: 4096, sha256: 'def456', mediaUrl: 'https://relay.test/media/def' }],
      },
      'https://relay.test',
      token,
    )
    expect(result).toEqual({ ok: true, id: 'signed'.padEnd(64, '0') })
    const published = signed()
    expect(published.kind).toBe(9)
    expect(published.content).toBe(body)
    expect(published.tags[0]).toEqual(['h', DM])
    expect(published.tags).toContainEqual(['p', CATH])
    const imeta = published.tags.find((t) => t[0] === 'imeta')
    expect(imeta).toContain('size 4096')
    expect(imeta).toContain('x def456')
    expect(published.tags.some((t) => t[0] === 'A' || t[0] === 'e')).toBe(false)
  })

  it('an urgent mention is the plain mention in the text and an urgent tag beside its p (CON-17)', async () => {
    const body = `Need you nostr:${encodeNpub(CATH)}`
    await commentAsViewer({ container: dmContainer, body, urgent: [CATH] }, 'https://relay.test', token)
    const published = signed()
    expect(published.content).toBe(body)
    expect(published.tags).toContainEqual(['p', CATH])
    expect(published.tags.filter((t) => t[0] === 'urgent')).toEqual([['urgent', CATH]])
  })

  it('a [ reference to a message earns its q on chat too (CON-25)', async () => {
    const picked = 'e'.repeat(64)
    await commentAsViewer({ container: dmContainer, body: `See ${messageReference(picked, 9)}` }, 'https://relay.test', token)
    expect(signed().tags.filter((t) => t[0] === 'q')).toEqual([['q', picked]])
  })

  it('a reply does not quote the message it answers: that is its e (CON-25)', async () => {
    const parent = { id: hello.id, author: MIKY, body: 'Hello', createdAt: hello.created_at, kind: 9 }
    await commentAsViewer({ container: dmContainer, body: `About ${messageReference(hello.id, 9)}`, parent }, 'https://relay.test', token)
    expect(signed().tags.filter((t) => t[0] === 'q')).toEqual([])
  })

  it('a reply is the same kind:9 with Buzz’s single reply-marked e', async () => {
    const parent = { id: hello.id, author: MIKY, body: 'Hello', createdAt: hello.created_at, kind: 9 }
    await commentAsViewer({ container: dmContainer, body: 'Hi!', parent }, 'https://relay.test', token)
    const published = signed()
    expect(published.kind).toBe(9)
    expect(published.tags.filter((t) => t[0] === 'e')).toEqual([['e', hello.id, '', 'reply']])
    expect(published.tags).toContainEqual(['h', DM])
  })

  it('an edit that changes the attachments carries the whole new set as imeta (CON-5)', async () => {
    await editCommentAsViewer(
      {
        container: dmContainer,
        targetEventId: picture.id,
        body: 'Here it is',
        files: [{ name: 'other.png', contentType: 'image/png', size: 10, sha256: 'fff', mediaUrl: 'https://relay.test/media/fff' }],
      },
      'https://relay.test',
      token,
    )
    const published = signed()
    expect(published.kind).toBe(40003)
    expect(published.tags).toContainEqual(['h', DM])
    expect(published.tags.filter((t) => t[0] === 'imeta')).toHaveLength(1)
    expect(published.tags.find((t) => t[0] === 'imeta')).toContain('x fff')
  })

  it('✕ on a sent card is an edit carrying the whole folded set, that card none and the other kept (4136f999)', async () => {
    const issue = `30851:${CATH}:f0b27d90-d5b9-40e7-8078-865ab36a421c`
    const other = `30851:${CATH}:e0b27d90-d5b9-40e7-8078-865ab36a421c`
    await editCommentAsViewer(
      {
        container: dmContainer,
        targetEventId: picture.id,
        body: 'Here it is',
        embeds: [{ value: issue, layout: 'none' }, { value: other, layout: 'detailed' }],
        files: attachmentsOf(picture),
      },
      'https://relay.test',
      token,
    )
    const published = signed()
    expect(published.kind).toBe(40003)
    expect(published.content).toBe('Here it is')
    expect(published.tags.filter((t) => t[0] === 'embed')).toEqual([
      ['embed', issue, 'none'],
      ['embed', other, 'detailed'],
    ])
    // The message's file rides the same edit, its tag as the message has it (SPEC §6.8).
    expect(published.tags.filter((t) => t[0] === 'imeta')).toEqual([
      ['imeta', 'url https://relay.test/media/def', 'm image/jpeg', 'x def456', 'size 4096', 'filename photo.jpg'],
    ])
  })
})

/*
  CON-7's third leg, landed with REM-1: a DM send reports success only when the
  relay has accepted the event, and a failure that may be transient is tried
  again rather than reported. These fail if the write ever goes back to
  fire-and-forget.
*/
describe('publishConfirmed — success is the relay’s acceptance, and a transient failure is retried', () => {
  const unsigned = { kind: 9, pubkey: MIKY, created_at: 1_700_000_000, tags: [['h', 'x']], content: 'hi' }
  const waits: number[] = []
  const sleep = async (ms: number) => {
    waits.push(ms)
  }
  beforeEach(() => {
    waits.length = 0
    publishSigned.mockReset()
  })

  it('reports the event only once the relay accepted it', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true, eventId: 'a'.repeat(64), httpStatus: 200 } as never)
    await expect(publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })).resolves.toEqual({ ok: true, id: 'a'.repeat(64) })
  })

  it('never reports success when the relay did not accept it', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'relay unavailable', httpStatus: 503 } as never)
    const result = await publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })
    expect(result).toEqual({ ok: false, reason: 'relay unavailable' })
    expect(publishSigned).toHaveBeenCalledTimes(PUBLISH_ATTEMPTS)
  })

  it('a request that threw is tried again, with the same signed event, and its success is reported', async () => {
    publishSigned
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, eventId: 'b'.repeat(64), httpStatus: 200 } as never)
    const result = await publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })
    expect(result).toEqual({ ok: true, id: 'b'.repeat(64) })
    expect(publishSigned).toHaveBeenCalledTimes(2)
    const calls = publishSigned.mock.calls as unknown as unknown[][]
    expect(calls[0][1]).toBe(calls[1][1])
    expect(waits).toHaveLength(1)
  })

  it('a quota refusal waits the time the relay named, then tries again', async () => {
    publishSigned
      .mockResolvedValueOnce({ ok: false, reason: 'rate-limited: quota exceeded; retry in 7s', httpStatus: 429 } as never)
      .mockResolvedValueOnce({ ok: true, eventId: 'c'.repeat(64), httpStatus: 200 } as never)
    const result = await publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })
    expect(result).toEqual({ ok: true, id: 'c'.repeat(64) })
    expect(waits).toEqual([7_000])
  })

  it('a considered refusal is reported at once — asking again returns the same no', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'invalid: imeta size (129682) does not match stored size (129661)', httpStatus: 400 } as never)
    const result = await publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })
    expect(result).toEqual({ ok: false, reason: 'invalid: imeta size (129682) does not match stored size (129661)' })
    expect(publishSigned).toHaveBeenCalledTimes(1)
  })

  it('the relay already holding the event — a lost answer to an earlier try — is acceptance', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true, duplicate: true, eventId: 'd'.repeat(64), httpStatus: 200 } as never)
    await expect(publishConfirmed(unsigned, 'https://relay.test', token, 'refused', { sleep })).resolves.toEqual({ ok: true, id: 'd'.repeat(64) })
  })

  it('a DM send goes through it: a relay that never accepts is a send that failed', async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'relay unavailable', httpStatus: 502 } as never)
    const result = await commentAsViewer({ container: { kind: 'channel', h: 'x' }, body: 'hi' }, 'https://relay.test', token)
    expect(result.ok).toBe(false)
    expect(publishSigned).toHaveBeenCalledTimes(PUBLISH_ATTEMPTS)
  }, 15_000)
})

describe("a comment's anchor keeps its whole run and its words (§13.6, LEAF-7)", () => {
  const DOC = `30842:${'a'.repeat(64)}:doc`

  it('keeps every block of the run and the quote, so the card reads the selection rather than its first block', () => {
    const tags = [['A', DOC], ['block', 'p1', 'p2', 'p3'], ['quote', 'ship on Friday.', 'Then we']]
    expect(partsAndAnchorOf({ kind: 1111, tags })).toEqual([
      { address: DOC, block: 'p1', anchor: true, anchorTags: [['block', 'p1', 'p2', 'p3'], ['quote', 'ship on Friday.', 'Then we']] },
    ])
  })

  it('reads a one-block comment as it always did', () => {
    expect(partsAndAnchorOf({ kind: 1111, tags: [['A', DOC], ['block', 'p1']] })).toEqual([
      { address: DOC, block: 'p1', anchor: true, anchorTags: [['block', 'p1']] },
    ])
  })

  it("draws no anchor on a reply that copied its comment's place: the comment shows it, once", () => {
    const reply = [['A', DOC], ['e', 'c'.repeat(64)], ['k', '1111'], ['block', 'p1', 'p2'], ['quote', 'ship on Friday.']]
    expect(partsAndAnchorOf({ kind: 1111, tags: reply })).toEqual([])
  })

  it('draws no part of the page the comment is on, sent before that rule, and still draws its anchor and another page’s part (COMM-8)', () => {
    const OTHER_DOC = `30842:${'b'.repeat(64)}:other`
    const tags = [['A', DOC], ['block', 'p1'], ['part', DOC, 'p9'], ['part', OTHER_DOC, 'q1']]
    expect(partsAndAnchorOf({ kind: 1111, tags })).toEqual([
      { address: DOC, block: 'p1', anchor: true, anchorTags: [['block', 'p1']] },
      { address: OTHER_DOC, block: 'q1' },
    ])
  })

  it('anchors nothing on a channel message, which names no file', () => {
    expect(partsAndAnchorOf({ kind: 9, tags: [['block', 'p1', 'p2'], ['quote', 'x']] })).toEqual([])
  })
})
