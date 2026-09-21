/**
 * The mentions half of a file's Activity — CON-11.
 *
 * Two claims worth pinning. A mention is the `a` tag: a comment that carries
 * the file's address is one, and a comment that merely has the text is not
 * (the filter never sees it). And the file's own conversation is excluded —
 * a comment whose `A` is this file is the stream, and identity merges.
 */
import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { fileMentionFilter, fileMentionsOf } from './fileMentions'

const AUTHOR = 'cd'.repeat(32)
const THIS = `30840:${AUTHOR}:this-file`
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
  it('asks for comments by the address', () => {
    expect(fileMentionFilter(THIS)).toEqual({ kinds: [1111], '#a': [THIS], limit: 200 })
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
