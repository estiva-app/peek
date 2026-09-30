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
import { fileMentionFilter, fileMentionsOf } from './fileMentions'

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
