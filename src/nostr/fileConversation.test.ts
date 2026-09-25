/**
 * A file's conversation as Peek's own view reads and writes it — FOL-31.
 *
 * The read folds three relay answers — threads by `#e`, the raw events for
 * their tags, and the decorations interop reports (edits, reactions,
 * resolutions) — into one shape the view draws from. The writes are the
 * kinds the rest of the suite already agrees on: `1111` for a comment and a
 * reply, `40003` for an edit, `7` for a reaction, `9101` for a resolution,
 * `5` to take any of them back. Each is pinned here by its tags, because a
 * wrong tag publishes for ever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeNaddr, encodeNpub } from '@estiva-app/protocol'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async () => ({ ok: true as const })),
  signViaEstivaId: vi.fn(async (event: Record<string, unknown>) => ({ ...event, id: 'signed'.padEnd(64, '0'), sig: '' })),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import {
  CHANNEL_PAGE,
  PUBLISH_ATTEMPTS,
  channelConversationAsViewer,
  commentAsViewer,
  deleteEventAsViewer,
  publishConfirmed,
  editCommentAsViewer,
  fileConversationAsViewer,
  foldEdits,
  isCommentOn,
  mentionTagsFor,
  referenceTagsFor,
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
/** A topic message anchored to this file before REW-10 — its body does not name it, and it is a comment for good. */
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
    expect(found.roots[0].files).toEqual([
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
    expect(d.edit).toEqual({ body: 'First, corrected', at: edit.created_at, by: CATH })
    expect(d.reactions).toEqual([{ id: reaction.id, emoji: '👍', by: MIKY, at: reaction.created_at }])
    expect(d.resolutions).toEqual([
      { id: resolved.id, action: 'resolved', by: MIKY, at: resolved.created_at, message: 'done', supportingEventId: reply.id },
    ])
    // A reply is a target too, so a reaction on it would be found.
    expect(found.decorations.byId[reply.id]).toEqual({ reactions: [], resolutions: [] })
    expect(found.decorations.reactionTargetsOmitted).toBe(0)
    // The same edit, folded here for the body, the mark and the files (CON-5).
    expect(found.edits).toEqual({ [root.id]: { body: 'First, corrected', editedAt: edit.created_at } })
  })

  it('drops a root that is a comment on another file naming this one — that is Activity, not the conversation', async () => {
    const found = await fileConversationAsViewer(container, [root.id, mentionFromElsewhere.id], 'https://relay.test', token)
    expect(found.roots.map((r) => r.id)).toEqual([root.id])
  })

  it('drops a topic message whose body names this file, and keeps one anchored to it the pre-REW-10 way (CON-14)', async () => {
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

  it('reports the relay’s refusal in its words', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'blocked: not a member' } as never)
    const result = await commentAsViewer({ container, body: 'x' }, 'https://relay.test', token)
    expect(result).toEqual({ ok: false, reason: 'blocked: not a member' })
  })
})

describe('the decorations are written as the suite agrees them', () => {
  it('an edit is a kind:40003 naming the comment and the Folder', async () => {
    await editCommentAsViewer({ container, targetEventId: root.id, body: 'First, corrected' }, 'https://relay.test', token)
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

describe('referenceTagsFor', () => {
  it('names each file once, skips the file the comment is on, and ignores a broken pointer', () => {
    expect(referenceTagsFor(`${OTHER_NADDR} and ${OTHER_NADDR} and nostr:naddr1broken`, ADDRESS)).toEqual([['a', OTHER]])
    expect(referenceTagsFor(OWN_NADDR, ADDRESS)).toEqual([])
  })
})

describe('isCommentOn — SPEC §6.4’s per-tag rule', () => {
  it('a kind:1111 is what the A names; a root without one is kept', () => {
    expect(isCommentOn(root, ADDRESS)).toBe(true)
    expect(isCommentOn(withPicture, ADDRESS)).toBe(true)
    expect(isCommentOn(mentionFromElsewhere, ADDRESS)).toBe(false)
  })

  /* A kind:9 has no A, so its a is read against its body (CON-14). */
  it('a kind:9 whose body names the file is a mention — the a is the index of the reference', () => {
    const topicMessage = event({ kind: 9, content: `See ${OWN_NADDR}`, tags: [['h', OTHER_FOLDER], ['a', ADDRESS]] })
    expect(isCommentOn(topicMessage, ADDRESS)).toBe(false)
  })

  it('a kind:9 whose body does not name the file is a pre-REW-10 comment anchor, read for good', () => {
    const legacy = event({ kind: 9, content: 'Written before comments moved to 1111', tags: [['h', OTHER_FOLDER], ['a', ADDRESS]] })
    expect(isCommentOn(legacy, ADDRESS)).toBe(true)
  })

  it('a kind:9 that does not carry the file as a is not a comment on it, whatever its body says', () => {
    const named = event({ kind: 9, content: `See ${OWN_NADDR}`, tags: [['h', OTHER_FOLDER]] })
    expect(isCommentOn(named, ADDRESS)).toBe(false)
  })
})

describe('mentionTagsFor', () => {
  it('names each mentioned person once, and ignores anything that is not an npub', () => {
    const npub = encodeNpub(CATH)
    expect(mentionTagsFor(`hi nostr:${npub} and again nostr:${npub}, see nostr:nevent1qqs`)).toEqual([['p', CATH]])
  })
})

describe('foldEdits — the body and the attachments fold separately (RFC 0.4 §7.2.1, amended 2026-09-23, CON-5)', () => {
  const target = { id: 'f'.repeat(64), body: 'Original' }
  const imeta = (x: string) => ['imeta', `url https://relay.test/media/${x}`, 'm image/png', `x ${x}`, 'size 10', `filename ${x}.png`]
  const at = 1_800_000_000
  const editOf = (id: string, content: string, created_at: number, extra: string[][] = []): TestEvent => ({
    id: id.repeat(64).slice(0, 64),
    sig: '',
    pubkey: CATH,
    created_at,
    kind: 40003,
    tags: [['h', FOLDER], ['e', target.id], ...extra],
    content,
  })
  const shas = (fold: ReturnType<typeof foldEdits>) => fold[target.id]?.files?.map((f) => f.sha256)

  it('a later edit carrying imeta replaces the set — it does not append', () => {
    const first = editOf('1', 'Original', at, [imeta('aaa'), imeta('bbb')])
    const second = editOf('2', 'Original', at + 5, [imeta('ccc')])
    expect(shas(foldEdits([target], [second, first]))).toEqual(['ccc'])
  })

  it('an edit without imeta leaves the attachments as they were', () => {
    const attach = editOf('1', 'Original', at, [imeta('aaa')])
    const reword = editOf('2', 'Reworded', at + 5)
    const fold = foldEdits([target], [attach, reword])[target.id]
    expect(fold.body).toBe('Reworded')
    expect(fold.files?.map((f) => f.sha256)).toEqual(['aaa'])
    // And with no edit carrying any, there is no set: the comment's own stands.
    expect(foldEdits([target], [reword])[target.id].files).toBeUndefined()
  })

  it('the latest edit carrying imeta wins, by ts then created_at then id', () => {
    const early = editOf('1', 'Original', at, [imeta('aaa'), ['ts', String(at * 1000 + 900)]])
    const late = editOf('2', 'Original', at, [imeta('bbb'), ['ts', String(at * 1000 + 100)]])
    expect(shas(foldEdits([target], [late, early]))).toEqual(['aaa'])
    // A ts that disagrees with created_at is ignored, so the id breaks the tie.
    const lying = editOf('3', 'Original', at, [imeta('ccc'), ['ts', String((at + 3600) * 1000)]])
    const other = editOf('4', 'Original', at, [imeta('ddd')])
    expect(shas(foldEdits([target], [other, lying]))).toEqual(['ddd'])
    // A newer edit without imeta does not take the set with it.
    expect(shas(foldEdits([target], [early, late, editOf('5', 'Changed', at + 60)]))).toEqual(['aaa'])
  })

  it('an edit whose body is byte-identical to the one it replaces is not marked edited', () => {
    const attachOnly = editOf('1', 'Original', at, [imeta('aaa')])
    expect(foldEdits([target], [attachOnly])[target.id]).toEqual({ body: 'Original', files: [expect.objectContaining({ sha256: 'aaa' })] })
    // The mark stays with the last edit that changed the body, judged against the body as it then stood.
    const reword = editOf('2', 'Reworded', at + 5)
    const reattach = editOf('3', 'Reworded', at + 10, [imeta('bbb')])
    expect(foldEdits([target], [attachOnly, reword, reattach])[target.id].editedAt).toBe(at + 5)
    const back = editOf('4', 'Original', at + 20)
    expect(foldEdits([target], [reword, back])[target.id].editedAt).toBe(at + 20)
  })

  it('ignores an edit of something that is not one of the targets', () => {
    const elsewhere = { ...editOf('1', 'Other', at), tags: [['h', FOLDER], ['e', 'e'.repeat(64)], imeta('aaa')] }
    expect(foldEdits([target], [elsewhere])).toEqual({})
  })
})

/*
  REM-1 — a DM is a channel container: its `kind:9` messages, read by `#h` and
  written with `buildMessage`. The fold is the one Convex's `nostr/sync.ts`
  drew a DM with until then.
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
  /** A reply to a reply: the importer never had a row to hang it from, and neither does this. */
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

  it('reads the messages by #h, puts each reply under its message, and folds what was done to them', async () => {
    const found = await channelConversationAsViewer(DM, 'https://relay.test', token)
    expect(found.roots.map((r) => r.body)).toEqual(['Hello', 'Here it is'])
    expect(found.replies[hello.id]?.map((r) => r.body)).toEqual(['Hi!'])
    expect(Object.keys(found.replies)).toEqual([hello.id])
    expect(found.roots[1].files).toEqual([
      { name: 'photo.jpg', contentType: 'image/jpeg', size: 4096, sha256: 'def456', mediaUrl: 'https://relay.test/media/def' },
    ])
    expect(found.edits[hello.id]?.body).toBe('Hello there')
    expect(found.decorations.byId[answer.id].reactions.map((r) => r.emoji)).toEqual(['❤️'])
    expect(found.decorations.byId[hello.id].resolutions.map((r) => r.action)).toEqual(['resolved'])
    // A kind list on every `#h` read: a kindless one is refused outright.
    const first = queryRelay.mock.calls[0][1] as Record<string, unknown>[]
    expect(first).toEqual([{ kinds: [9], '#h': [DM], limit: CHANNEL_PAGE }])
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
