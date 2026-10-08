/**
 * The mentions half of a file's Activity — CON-11, CON-14.
 *
 * Three claims worth pinning. A mention is the `a` tag: a comment that carries
 * the file's address is one, and a comment that merely has the text is not
 * (the filter never sees it). The file's own conversation is excluded —
 * a comment whose `A` is this file is the stream, and identity merges. And a
 * topic message is read by SPEC §6.4's rule: its `a` is a mention when the
 * body names the file, and a pre-REW-10 comment anchor when it does not.
 */
import { describe, expect, it } from 'vitest'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import { fileMentionFilter, fileMentionsOf, mentionConversationWith, mentionRepliesOf, stillNames, type FileMention } from './fileMentions'

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
    content: `about ${id}`,
    sig: '',
    ...rest,
    tags: [...(h ? [['h', h]] : []), ...(A ? [['A', A]] : []), ...(a ?? []).map((x) => ['a', x]), ...(rest.tags ?? [])],
  } as SignedEvent
}

describe('fileMentionFilter', () => {
  it('asks for comments and topic messages by the address', () => {
    expect(fileMentionFilter(THIS)).toEqual({ kinds: [1111, 9], '#a': [THIS], limit: 200 })
  })
})

describe('fileMentionsOf reads a topic message by SPEC §6.4 (CON-14)', () => {
  const topicMessage = event('said-in-topic', { kind: 9, h: OTHER_H, a: [THIS], content: `See ${THIS_NADDR}`, created_at: 5 })

  it('one whose body names the file is a mention, said in its topic', () => {
    const [m] = fileMentionsOf([topicMessage], THIS, RELAY)
    expect(m).toMatchObject({ id: 'said-in-topic', kind: 9, folder: OTHER_H, saidIn: `39000:${RELAY}:${OTHER_H}`, threadId: 'said-in-topic' })
  })

  it('one whose body does not name the file is a mention too — a kind:9 is chat, never a comment (SPEC §6.4, CON-20, CON-5)', () => {
    const legacy = event('legacy-anchor', { kind: 9, h: OTHER_H, a: [THIS], content: 'anchored the old way' })
    expect(fileMentionsOf([legacy], THIS, RELAY)).toMatchObject([{ id: 'legacy-anchor', kind: 9, saidIn: `39000:${RELAY}:${OTHER_H}` }])
  })

  it('is left out when the relay’s key is unknown, and the comments stay', () => {
    const comment = event('comment', { h: OTHER_H, A: OTHER, a: [THIS] })
    expect(fileMentionsOf([topicMessage, comment], THIS, null).map((m) => m.id)).toEqual(['comment'])
  })

  it('sorts with the comments, newest first', () => {
    const comment = event('comment', { h: OTHER_H, A: OTHER, a: [THIS], created_at: 1 })
    expect(fileMentionsOf([comment, topicMessage], THIS, RELAY).map((m) => m.id)).toEqual(['said-in-topic', 'comment'])
  })
})

describe('fileMentionsOf', () => {
  it('is every comment rooted on another file that tags the address, newest first', () => {
    const out = fileMentionsOf(
      [
        event('older', { h: OTHER_H, A: OTHER, a: [OTHER, THIS], created_at: 100 }),
        event('newer', { h: 'third-uuid', A: `30851:${AUTHOR}:pay-1`, a: [THIS], created_at: 900 }),
      ],
      THIS,
    )
    expect(out.map((m) => [m.id, m.folder, m.saidIn])).toEqual([
      ['newer', 'third-uuid', `30851:${AUTHOR}:pay-1`],
      ['older', OTHER_H, OTHER],
    ])
  })

  /* Identity merges: a comment on the file is the stream, not Activity. */
  it('excludes a comment on the file itself — its A is this file, or it has none', () => {
    const out = fileMentionsOf(
      [
        event('root', { h: 'this-uuid', A: THIS, a: [THIS] }),
        event('legacy', { h: 'this-uuid', a: [THIS] }),
      ],
      THIS,
    )
    expect(out).toEqual([])
  })

  /* A relay answering a `#a` filter cannot return this, but the function must
     not trust the filter it did not run. */
  it('excludes a comment that does not carry the address', () => {
    const out = fileMentionsOf([event('other', { h: OTHER_H, A: OTHER, a: [OTHER] })], THIS)
    expect(out).toEqual([])
  })

  it('a reply opens the thread its e names; a root opens itself', () => {
    const [reply, root] = fileMentionsOf(
      [
        event('reply', { h: OTHER_H, A: OTHER, a: [THIS], created_at: 2, tags: [['e', 'parent-id']] }),
        event('root', { h: OTHER_H, A: OTHER, a: [OTHER, THIS], created_at: 1 }),
      ],
      THIS,
    )
    expect(reply.threadId).toBe('parent-id')
    expect(root.threadId).toBe('root')
  })

  it('carries every address the comment names, the file it is on included', () => {
    const [m] = fileMentionsOf([event('m', { h: OTHER_H, A: OTHER, a: [OTHER, `30851:${AUTHOR}:pay-1`, THIS] })], THIS)
    expect(m.references).toEqual([OTHER, `30851:${AUTHOR}:pay-1`, THIS])
  })

  it('reports one row per event', () => {
    const e = event('dup', { h: OTHER_H, A: OTHER, a: [THIS] })
    expect(fileMentionsOf([e, e], THIS)).toHaveLength(1)
  })
})

/*
  Each mention as it is now — PEE-48. The row draws what was done to the
  message where it was said: its replies, edits, reactions and resolution,
  and leaves the Activity when an edit takes the file out of the text.
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

describe('stillNames (PEE-48, Katerina 8 October)', () => {
  it('keeps a mention nobody edited', () => {
    expect(stillNames(`See ${THIS_NADDR}`, undefined, THIS)).toBe(true)
  })

  it('keeps one whose edit still names the file, and drops one whose edit took it out', () => {
    expect(stillNames(`See ${THIS_NADDR}`, `Look at ${THIS_NADDR} again`, THIS)).toBe(true)
    expect(stillNames(`See ${THIS_NADDR}`, 'Never mind', THIS)).toBe(false)
  })

  it('never drops a mention made by a pasted link, whose text cannot be read for the file (FOL-38)', () => {
    expect(stillNames('See https://peek.estiva.app/topic/this-file', 'Never mind', THIS)).toBe(true)
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
    const conversation = await mentionConversationWith([root], THIS, query)
    expect(conversation.roots.map((r) => r.id)).toEqual([M_ROOT])
    expect(conversation.replies[M_ROOT].map((r) => r.id)).toEqual([hex('a')])
    const d = conversation.decorations.byId[M_ROOT]
    expect(d.reactions.map((r) => r.emoji)).toEqual(['👍'])
    expect(d.resolutions.map((r) => [r.action, r.message])).toEqual([['resolved', 'Done']])
  })

  it('reads the latest text, and leaves out a mention an edit took the file out of', async () => {
    const stillThere = event(hex('d'), { kind: 40003, content: `Now: ${THIS_NADDR}`, tags: [['e', M_ROOT]], created_at: 30 })
    const takenOut = event(hex('e'), { kind: 40003, content: 'Never mind', tags: [['e', M_REPLY]], created_at: 31 })
    const { query } = relayOf([stillThere, takenOut])
    const conversation = await mentionConversationWith([root, asReply], THIS, query)
    expect(conversation.roots.map((r) => r.id)).toEqual([M_ROOT])
    expect(conversation.decorations.byId[M_ROOT].edit?.body).toBe(`Now: ${THIS_NADDR}`)
  })

  it('asks for no replies when no mention opens a thread', async () => {
    const { query, asked } = relayOf([])
    await mentionConversationWith([asReply], THIS, query)
    expect(asked.some((f) => Array.isArray(f.kinds) && (f.kinds as number[]).includes(1111))).toBe(false)
  })
})
