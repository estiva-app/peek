/**
 * A file's threads: read by `#e`, written per NIP-22's table — FOL-19.
 *
 * The fold this pins was measured on production first
 * (`scripts/probe-fol19-file-threads.ts`): every comment on a Ship issue
 * carries `A/K/P` and `a/k/p` naming the issue plus `h`, the kinds off Ship's
 * manifest are `[1111, 9]`, and no reply anywhere in the Folder carries a
 * lowercase `a`. So the `#a` read that brings comments back with the file can
 * never bring a reply, and the reply Peek writes must not carry one either.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async () => ({ ok: true as const })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import { replyToCommentAsViewer, threadsAsViewer } from './foreign'

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const FOLDER = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const ISSUE = 30851
const COMMENT = 1111
const ADDRESS = `${ISSUE}:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const token = { accessToken: 't', pubkey: CATH } as never

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
  pubkey: SHIP,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

/** Ship's manifest as production declares it for an issue: 1111, also reading 9. */
const manifest = event({
  kind: 31990,
  tags: [['d', 'estiva-ship'], ['k', String(ISSUE)]],
  content: JSON.stringify({
    name: 'Estiva Ship',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
    projections: { [ISSUE]: { widget: 'card', slots: { title: { tag: 'title' } } } },
    actions: [
      {
        id: 'comment',
        label: 'Comment',
        appliesTo: String(ISSUE),
        emits: { kind: COMMENT, scope: 'address', alsoRead: [9] },
        input: { type: 'string' },
      },
    ],
  }),
})

const issue = event({ kind: ISSUE, tags: [['d', 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'], ['title', 'The file route'], ['h', FOLDER]] })

/** A top-level comment, in the shape production carries. */
const root = event({
  kind: COMMENT,
  content: 'First',
  tags: [['A', ADDRESS], ['K', String(ISSUE)], ['P', SHIP], ['a', ADDRESS], ['k', String(ISSUE)], ['p', SHIP], ['h', FOLDER]],
})
const other = event({ kind: COMMENT, content: 'Second', tags: [['a', ADDRESS], ['h', FOLDER]] })
/** Ship's own reply: `kind:9`, `['e', root, '', 'reply']`, no `a`. */
const shipReply = event({ kind: 9, content: 'From Ship', tags: [['e', root.id, '', 'reply'], ['h', FOLDER]] })
/** A NIP-22 reply: uppercase names the file, lowercase names the comment. */
const nipReply = event({
  kind: COMMENT,
  content: 'Per the NIP',
  pubkey: CATH,
  tags: [['A', ADDRESS], ['K', String(ISSUE)], ['P', SHIP], ['e', root.id], ['k', String(COMMENT)], ['p', SHIP], ['h', FOLDER]],
})
/** A reply to the reply: hangs off the reply's id, not the root's. */
const nested = event({ kind: COMMENT, content: 'Deeper', tags: [['A', ADDRESS], ['e', nipReply.id], ['k', String(COMMENT)], ['h', FOLDER]] })

function relayOver(world: TestEvent[]) {
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: world.filter((e) =>
      filters.some((f) => {
        if (f.ids && !(f.ids as string[]).includes(e.id)) return false
        if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
        if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
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

beforeEach(() => {
  publishSigned.mockClear()
  signViaEstivaId.mockClear()
  queryRelay.mockImplementation(relayOver([manifest, issue, root, other, shipReply, nipReply, nested]))
})

describe('threadsAsViewer reads every thread of a file in one request', () => {
  it('returns the roots with their kind, and the direct replies under each', async () => {
    const threads = await threadsAsViewer(ADDRESS, [root.id, other.id], 'https://relay.test', token)
    expect(threads.roots[root.id]).toMatchObject({ id: root.id, kind: COMMENT, body: 'First' })
    expect(threads.roots[other.id]).toMatchObject({ kind: COMMENT })
    expect(threads.replies[root.id]?.map((r) => r.body)).toEqual(['From Ship', 'Per the NIP'])
    // Absent, not `[]`: a root with no replies has no entry to draw a "0" from.
    expect(threads.replies[other.id]).toBeUndefined()
  })

  it('takes both kinds off the manifest, so a Ship kind:9 reply and a NIP-22 one both arrive', async () => {
    const threads = await threadsAsViewer(ADDRESS, [root.id], 'https://relay.test', token)
    expect(threads.replies[root.id]?.map((r) => r.kind)).toEqual([9, COMMENT])
  })

  it('reads one level: a reply to a reply hangs off the reply and is not counted here', async () => {
    const threads = await threadsAsViewer(ADDRESS, [root.id], 'https://relay.test', token)
    expect(threads.replies[root.id]?.map((r) => r.body)).not.toContain('Deeper')
  })

  it('asks once, with the ids and the #e filter in one POST', async () => {
    await threadsAsViewer(ADDRESS, [root.id, other.id], 'https://relay.test', token)
    // The manifest resolve is its own reads; the thread read is the last call.
    const last = queryRelay.mock.calls.at(-1)?.[1] as Record<string, unknown>[]
    expect(last).toEqual([
      { ids: [root.id, other.id], limit: 2 },
      { kinds: [COMMENT, 9], '#e': [root.id, other.id], limit: 200 },
    ])
  })

  it('answers empty for no roots without asking', async () => {
    queryRelay.mockClear()
    expect(await threadsAsViewer(ADDRESS, [], 'https://relay.test', token)).toEqual({ roots: {}, replies: {} })
    expect(queryRelay).not.toHaveBeenCalled()
  })
})

describe('replyToCommentAsViewer writes NIP-22’s reply, not a second top-level comment', () => {
  it('keeps the uppercase trio on the file and points the lowercase trio at the parent', async () => {
    const parent = { id: root.id, author: SHIP, body: 'First', createdAt: root.created_at, kind: COMMENT }
    const result = await replyToCommentAsViewer(
      { reference: ADDRESS, parent, body: 'Agreed.' },
      'https://relay.test',
      token,
    )
    expect(result.ok).toBe(true)
    const published = signViaEstivaId.mock.calls[0][0] as { kind: number; tags: string[][]; content: string }
    expect(published.kind).toBe(COMMENT)
    expect(published.content).toBe('Agreed.')
    // The thread root is still the file — a reader scoping by `#A` finds it.
    expect(published.tags).toContainEqual(['A', ADDRESS])
    expect(published.tags).toContainEqual(['K', String(ISSUE)])
    expect(published.tags).toContainEqual(['P', SHIP])
    // The immediate parent is the comment: its id, its kind, its author.
    expect(published.tags).toContainEqual(['e', root.id])
    expect(published.tags).toContainEqual(['k', String(COMMENT)])
    expect(published.tags).toContainEqual(['p', SHIP])
    // And no lowercase `a` — the reply must be invisible to the `#a` read,
    // which is what production's replies are and what the thread pane expects.
    expect(published.tags.some((t) => t[0] === 'a')).toBe(false)
    // The Folder still gates it.
    expect(published.tags).toContainEqual(['h', FOLDER])
  })

  it('names the parent’s kind, which for a Ship reply is 9 and not the comment kind', async () => {
    const parent = { id: shipReply.id, author: SHIP, body: 'From Ship', createdAt: 0, kind: 9 }
    await replyToCommentAsViewer({ reference: ADDRESS, parent, body: 'ok' }, 'https://relay.test', token)
    const published = signViaEstivaId.mock.calls[0][0] as { tags: string[][] }
    expect(published.tags).toContainEqual(['k', '9'])
    expect(published.tags).toContainEqual(['e', shipReply.id])
  })

  it('is refused where the manifest offers no comment, before anything is signed', async () => {
    const mute = event({
      kind: 31990,
      tags: [['d', 'mute'], ['k', '30999']],
      content: JSON.stringify({ name: 'Mute', projections: { 30999: { widget: 'card', slots: {} } }, actions: [] }),
    })
    const record = event({ kind: 30999, tags: [['d', 'x'], ['h', FOLDER]] })
    queryRelay.mockImplementation(relayOver([mute, record]))
    const parent = { id: root.id, author: SHIP, body: '', createdAt: 0, kind: COMMENT }
    const result = await replyToCommentAsViewer(
      { reference: `30999:${SHIP}:x`, parent, body: 'no' },
      'https://relay.test',
      token,
    )
    expect(result.ok).toBe(false)
    expect(signViaEstivaId).not.toHaveBeenCalled()
  })
})
