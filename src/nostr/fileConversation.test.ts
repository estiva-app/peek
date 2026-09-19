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
import { encodeNpub } from '@estiva-app/protocol'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async () => ({ ok: true as const })),
  signViaEstivaId: vi.fn(async (event: Record<string, unknown>) => ({ ...event, id: 'signed'.padEnd(64, '0'), sig: '' })),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import {
  commentAsViewer,
  deleteEventAsViewer,
  editCommentAsViewer,
  fileConversationAsViewer,
  mentionTagsFor,
  reactAsViewer,
  resolveAsViewer,
  type ConversationContainer,
} from './fileConversation'

const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const MIKY = 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const BARE_FILE = 30840
const COMMENT = 1111
const ADDRESS = `${BARE_FILE}:${CATH}:estiva-suits-updates`
const container: ConversationContainer = { kind: 'file', address: ADDRESS, h: FOLDER }
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
  queryRelay.mockImplementation(relayOver([manifest, file, root, withPicture, reply, edit, reaction, resolved]))
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

describe('mentionTagsFor', () => {
  it('names each mentioned person once, and ignores anything that is not an npub', () => {
    const npub = encodeNpub(CATH)
    expect(mentionTagsFor(`hi nostr:${npub} and again nostr:${npub}, see nostr:nevent1qqs`)).toEqual([['p', CATH]])
  })
})
