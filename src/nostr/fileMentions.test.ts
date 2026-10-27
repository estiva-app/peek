/**
 * The mentions half of a file's Activity — CON-11, CON-14, PEEKM-7.
 *
 * Which messages list is interop's `mentionedInOf`: one carrying the file's
 * address as `a` (or whose latest edit does) and whose latest words still
 * link the file. What is Peek's, and pinned here: the row each one draws —
 * where it was said, the thread it opens, a topic message's topic — the
 * file's own conversation left out, and the whole read at the wire, where an
 * edit that swaps a link moves the row from one file to the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeNaddr, type LinkResolver, type SignedEvent } from '@estiva-app/protocol'
import { mentionedInOf } from '@estiva-app/interop'
import { fileMentionsAsViewer, fileMentionsOf, mentionConversationWith, mentionRepliesOf, type FileMention } from './fileMentions'
import { forgetUrlShapes } from './foreign'

const queryRelay = vi.hoisted(() => vi.fn())
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

const AUTHOR = 'cd'.repeat(32)
const RELAY = 'ab'.repeat(32)
const THIS = `30840:${AUTHOR}:this-file`
const THIS_NADDR = `nostr:${encodeNaddr({ kind: 30840, pubkey: AUTHOR, identifier: 'this-file', relays: [] })}`
const OTHER = `30840:${AUTHOR}:other-file`
const OTHER_H = 'other-uuid'

const event = (id: string, over: Partial<SignedEvent> & { h?: string; A?: string; a?: string[] }): SignedEvent => {
  const { h, A, a, ...rest } = over
  return {
    id,
    pubkey: AUTHOR,
    created_at: 1_000,
    kind: 1111,
    content: `See ${THIS_NADDR}`,
    sig: '',
    ...rest,
    tags: [...(h ? [['h', h]] : []), ...(A ? [['A', A]] : []), ...(a ?? []).map((x) => ['a', x]), ...(rest.tags ?? [])],
  } as SignedEvent
}

/** The rows a relay answer draws for this file, as `fileMentionsAsViewer` reads them. */
const rowsOf = (events: SignedEvent[], relayKey?: string | null, resolve?: LinkResolver) => fileMentionsOf(mentionedInOf(events, THIS, resolve), relayKey)

describe('a topic message under Mentioned in (SPEC §6.4, CON-14)', () => {
  const topicMessage = event('said-in-topic', { kind: 9, h: OTHER_H, a: [THIS], created_at: 5 })

  it('one whose body names the file is a mention, said in its topic', () => {
    const [m] = rowsOf([topicMessage], RELAY)
    expect(m).toMatchObject({ id: 'said-in-topic', kind: 9, folder: OTHER_H, saidIn: `39000:${RELAY}:${OTHER_H}`, threadId: 'said-in-topic' })
  })

  it('one whose words do not name the file lists nothing, whatever its `a` says: the latest words decide (PEEKM-7)', () => {
    const legacy = event('legacy-anchor', { kind: 9, h: OTHER_H, a: [THIS], content: 'anchored the old way' })
    expect(rowsOf([legacy], RELAY)).toEqual([])
  })

  it('is left out when the relay’s key is unknown, and the comments stay', () => {
    const comment = event('comment', { h: OTHER_H, A: OTHER, a: [THIS] })
    expect(rowsOf([topicMessage, comment], null).map((m) => m.id)).toEqual(['comment'])
  })

  it('sorts with the comments, newest first', () => {
    const comment = event('comment', { h: OTHER_H, A: OTHER, a: [THIS], created_at: 1 })
    expect(rowsOf([comment, topicMessage], RELAY).map((m) => m.id)).toEqual(['said-in-topic', 'comment'])
  })
})

describe('a comment under Mentioned in', () => {
  it('is every comment rooted on another file that tags the address, newest first', () => {
    const out = rowsOf([
      event('older', { h: OTHER_H, A: OTHER, a: [OTHER, THIS], created_at: 100 }),
      event('newer', { h: 'third-uuid', A: `30851:${AUTHOR}:pay-1`, a: [THIS], created_at: 900 }),
    ])
    expect(out.map((m) => [m.id, m.folder, m.saidIn])).toEqual([
      ['newer', 'third-uuid', `30851:${AUTHOR}:pay-1`],
      ['older', OTHER_H, OTHER],
    ])
  })

  /* Identity merges: a comment on the file is the stream, not Activity. */
  it('excludes a comment on the file itself — its A is this file, or it has none', () => {
    expect(rowsOf([event('root', { h: 'this-uuid', A: THIS, a: [THIS] }), event('legacy', { h: 'this-uuid', a: [THIS] })])).toEqual([])
  })

  /* A relay answering a `#a` filter cannot return this, but the function must not trust the filter it did not run. */
  it('excludes a comment that does not carry the address', () => {
    expect(rowsOf([event('other', { h: OTHER_H, A: OTHER, a: [OTHER] })])).toEqual([])
  })

  it('a reply opens the thread its e names; a root opens itself', () => {
    const [reply, root] = rowsOf([
      event('reply', { h: OTHER_H, A: OTHER, a: [THIS], created_at: 2, tags: [['e', 'parent-id']] }),
      event('root', { h: OTHER_H, A: OTHER, a: [OTHER, THIS], created_at: 1 }),
    ])
    expect(reply.threadId).toBe('parent-id')
    expect(root.threadId).toBe('root')
  })

  it('carries every address the comment names, the file it is on included', () => {
    const [m] = rowsOf([event('m', { h: OTHER_H, A: OTHER, a: [OTHER, `30851:${AUTHOR}:pay-1`, THIS] })])
    expect(m.references).toEqual([OTHER, `30851:${AUTHOR}:pay-1`, THIS])
  })

  it('reports one row per event', () => {
    const e = event('dup', { h: OTHER_H, A: OTHER, a: [THIS] })
    expect(rowsOf([e, e])).toHaveLength(1)
  })
})

/*
  Mentioned in at the wire (PEEKM-7, Miky 2026-10-27): a file lists a comment
  while its latest words link it — an edit's words, by an app link as much as
  by a `nostr:` reference. Read through the viewer's link reader, against a
  relay that answers the filters the read sends.
*/
describe('Mentioned in after an edit', () => {
  const UUID_A = 'b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5'
  const UUID_B = 'c5fb7a7b-e5b3-4944-9a3b-7bb2f3a4d5e6'
  const ISSUE_A = `30851:${AUTHOR}:${UUID_A}`
  const ISSUE_B = `30851:${AUTHOR}:${UUID_B}`
  const TOKEN = { accessToken: 't', pubkey: 'e'.repeat(64), expiresAt: Date.now() + 60_000 } as never
  const manifest = {
    id: 'm1',
    kind: 31990,
    pubkey: AUTHOR,
    created_at: 1,
    content: '{}',
    sig: '',
    tags: [['d', 'estiva-ship'], ['web', 'https://ship.estiva.app/o/<bech32>', 'naddr'], ['urls', 'https://ship.estiva.app/issue/<slug>-<d>', '30851']],
  }
  const issue = (d: string) => ({ id: `i-${d}`, kind: 30851, pubkey: AUTHOR, created_at: 2, content: '', sig: '', tags: [['d', d]] })
  const COMMENT = '1'.repeat(64)

  /** A relay holding `events`, answering by kinds, ids, `#a`, `#e`, `#d` and limit, as buzz does. */
  const relayHolding = (events: object[]) =>
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => ({
      ok: true,
      events: (events as SignedEvent[]).filter((e) =>
        filters.some((f) => {
          if (Array.isArray(f.kinds) && !(f.kinds as number[]).includes(e.kind)) return false
          if (Array.isArray(f.ids) && !(f.ids as string[]).includes(e.id)) return false
          for (const name of ['a', 'e', 'd']) {
            const want = f[`#${name}`] as string[] | undefined
            if (want && !e.tags.some((t) => t[0] === name && want.includes(t[1]))) return false
          }
          return true
        }),
      ),
    }))

  const comment = event(COMMENT, {
    h: OTHER_H,
    A: OTHER,
    a: [ISSUE_A],
    content: `Blocked on https://ship.estiva.app/issue/billing-${UUID_A}`,
    created_at: 10,
  })
  const swap = event('2'.repeat(64), {
    kind: 40003,
    h: OTHER_H,
    a: [ISSUE_B],
    content: `Blocked on https://ship.estiva.app/issue/payout-${UUID_B}`,
    created_at: 20,
    tags: [['e', COMMENT]],
  })

  beforeEach(() => {
    vi.useFakeTimers()
    forgetUrlShapes()
    queryRelay.mockReset()
    relayHolding([manifest, issue(UUID_A), issue(UUID_B), comment, swap])
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('an edit that swaps one pasted link for another moves the comment to the new file, with its new words', async () => {
    expect(await fileMentionsAsViewer(ISSUE_A, 'https://relay', TOKEN)).toEqual([])
    const [row, ...rest] = await fileMentionsAsViewer(ISSUE_B, 'https://relay', TOKEN)
    expect(rest).toEqual([])
    expect(row).toMatchObject({ id: COMMENT, saidIn: OTHER, folder: OTHER_H, body: swap.content, references: [ISSUE_B, OTHER] })
  })

  it('before the edit, the comment lists under the file its words link', async () => {
    relayHolding([manifest, issue(UUID_A), issue(UUID_B), comment])
    expect((await fileMentionsAsViewer(ISSUE_A, 'https://relay', TOKEN)).map((m) => m.id)).toEqual([COMMENT])
    expect(await fileMentionsAsViewer(ISSUE_B, 'https://relay', TOKEN)).toEqual([])
  })
})

/*
  Each mention as it is now — PEE-48. The row draws what was done to the
  message where it was said: its replies, edits, reactions and resolution.
*/
const hex = (c: string) => c.repeat(64)
const M_ROOT = hex('1')
const M_REPLY = hex('2')
const M_TOPIC = hex('3')

/** A relay over a fixed set of events: `kinds`, `ids` and `#e`, which is all these reads ask. */
const relayOf = (events: SignedEvent[]) => {
  const asked: Record<string, unknown>[] = []
  const query = async (filters: Record<string, unknown>[]) => {
    asked.push(...filters)
    return events.filter((e) =>
      filters.some((f) => {
        if (Array.isArray(f.kinds) && !(f.kinds as number[]).includes(e.kind)) return false
        if (Array.isArray(f.ids) && !(f.ids as string[]).includes(e.id)) return false
        const es = f['#e'] as string[] | undefined
        if (es && !e.tags.some((t) => t[0] === 'e' && es.includes(t[1]))) return false
        return true
      }),
    )
  }
  return { query, asked }
}

const mentionOf = (over: Partial<FileMention> & { id: string }): FileMention => ({
  author: AUTHOR,
  body: `See ${THIS_NADDR}`,
  createdAt: 1_000,
  kind: 1111,
  folder: OTHER_H,
  saidIn: OTHER,
  threadId: over.id,
  references: [THIS],
  urgent: [],
  files: [],
  ...over,
})

describe('mentionRepliesOf (PEE-48)', () => {
  const threads = new Set([M_ROOT, M_TOPIC])

  it('files a comment reply under the comment it answers, and a topic reply under its thread', () => {
    const commentReply = event(hex('a'), { kind: 1111, A: OTHER, tags: [['e', M_ROOT]], created_at: 20 })
    const direct = event(hex('b'), { kind: 9, tags: [['e', M_TOPIC, '', 'reply']], created_at: 30 })
    const nested = event(hex('c'), { kind: 9, tags: [['e', M_TOPIC, '', 'root'], ['e', hex('b'), '', 'reply']], created_at: 31 })
    const out = mentionRepliesOf([nested, commentReply, direct], threads)
    expect(out[M_ROOT].map((e) => e.id)).toEqual([hex('a')])
    expect(out[M_TOPIC].map((e) => e.id)).toEqual([hex('b'), hex('c')])
  })

  it('counts nothing that is not a reply: a reaction, an edit, the mention itself, a reply elsewhere', () => {
    const reaction = event(hex('d'), { kind: 7, tags: [['e', M_ROOT]] })
    const edit = event(hex('e'), { kind: 40003, tags: [['e', M_ROOT]] })
    const elsewhere = event(hex('f'), { kind: 1111, tags: [['e', hex('9')]] })
    const itself = event(M_ROOT, { kind: 1111, A: OTHER })
    expect(mentionRepliesOf([reaction, edit, elsewhere, itself], threads)).toEqual({})
  })
})

describe('mentionConversationWith (PEE-48)', () => {
  const root = mentionOf({ id: M_ROOT, createdAt: 10 })
  const asReply = mentionOf({ id: M_REPLY, threadId: hex('8'), createdAt: 11 })
  const reply = event(hex('a'), { kind: 1111, A: OTHER, tags: [['e', M_ROOT]], created_at: 20 })
  const reaction = event(hex('b'), { kind: 7, content: '👍', pubkey: RELAY, tags: [['e', M_ROOT]], created_at: 21 })
  const resolved = event(hex('c'), {
    kind: 9101,
    content: 'Done',
    pubkey: RELAY,
    tags: [['e', M_ROOT], ['t', 'resolution'], ['action', 'resolved']],
    created_at: 22,
  })

  it('reads each mention’s replies, reactions and resolution', async () => {
    const { query } = relayOf([reply, reaction, resolved])
    const conversation = await mentionConversationWith([root], query)
    expect(conversation.roots.map((r) => r.id)).toEqual([M_ROOT])
    expect(conversation.replies[M_ROOT].map((r) => r.id)).toEqual([hex('a')])
    const d = conversation.decorations.byId[M_ROOT]
    expect(d.reactions.map((r) => r.emoji)).toEqual(['👍'])
    expect(d.resolutions.map((r) => [r.action, r.message])).toEqual([['resolved', 'Done']])
  })

  it('reads the latest text of each mention', async () => {
    const edited = event(hex('d'), { kind: 40003, content: `Now: ${THIS_NADDR}`, tags: [['e', M_ROOT]], created_at: 30 })
    const { query } = relayOf([edited])
    const conversation = await mentionConversationWith([root], query)
    expect(conversation.decorations.byId[M_ROOT].edit?.body).toBe(`Now: ${THIS_NADDR}`)
  })

  it('asks for no replies when no mention opens a thread', async () => {
    const { query, asked } = relayOf([])
    await mentionConversationWith([asReply], query)
    expect(asked.some((f) => Array.isArray(f.kinds) && (f.kinds as number[]).includes(1111))).toBe(false)
  })
})
