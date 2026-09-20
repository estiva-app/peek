/**
 * The mentions half of Activity — CON-11.
 *
 * Two claims worth pinning. A mention is the `a` tag: a message that carries
 * the topic's address is one, in either message kind, and a message that
 * merely has the text is not (the filter never sees it). And the topic's own
 * channel is excluded — a message there that names the topic it is in is the
 * stream, and identity merges.
 */
import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { topicMentionFilter, topicMentionsOf } from './topicMentions'

const RELAY = 'ab'.repeat(32)
const THIS = `39000:${RELAY}:this-uuid`
const OTHER_H = 'other-uuid'

const event = (id: string, over: Partial<SignedEvent> & { h?: string; a?: string[] }): SignedEvent => {
  const { h, a, ...rest } = over
  return {
    id,
    pubkey: 'cd'.repeat(32),
    created_at: 1_000,
    kind: 9,
    content: `about ${id}`,
    sig: '',
    ...rest,
    tags: [...(h ? [['h', h]] : []), ...(a ?? []).map((x) => ['a', x]), ...(rest.tags ?? [])],
  } as SignedEvent
}

describe('topicMentionFilter', () => {
  it('asks for both message kinds by the address', () => {
    expect(topicMentionFilter(THIS)).toEqual({ kinds: [9, 1111], '#a': [THIS], limit: 200 })
  })
})

describe('topicMentionsOf', () => {
  it('is every message from another channel that tags the address, newest first', () => {
    const out = topicMentionsOf(
      [
        event('older', { h: OTHER_H, a: [THIS], created_at: 100 }),
        event('newer', { h: 'third-uuid', a: [THIS], created_at: 900, kind: 1111 }),
      ],
      THIS,
      'this-uuid',
    )
    expect(out.map((m) => [m.id, m.folder, m.kind])).toEqual([
      ['newer', 'third-uuid', 1111],
      ['older', OTHER_H, 9],
    ])
  })

  /* Identity merges: said in the topic itself, it is the stream, not Activity. */
  it('excludes a message said in the topic’s own channel', () => {
    const out = topicMentionsOf([event('self', { h: 'this-uuid', a: [THIS] })], THIS, 'this-uuid')
    expect(out).toEqual([])
  })

  /* A relay answering a `#a` filter cannot return this, but the function must
     not trust the filter it did not run. */
  it('excludes a message that does not carry the address', () => {
    const out = topicMentionsOf([event('other', { h: OTHER_H, a: ['30851:aa:pay-1'] })], THIS, 'this-uuid')
    expect(out).toEqual([])
  })

  it('spells the channel it was said in as that topic’s address, with the same relay key', () => {
    const [m] = topicMentionsOf([event('m', { h: OTHER_H, a: [THIS] })], THIS, 'this-uuid')
    expect(m.saidIn).toBe(`39000:${RELAY}:${OTHER_H}`)
  })

  it('carries every address the message names, and reads NIP-22’s uppercase A too', () => {
    const [m] = topicMentionsOf(
      [event('m', { h: OTHER_H, a: ['30851:aa:pay-1'], tags: [['A', THIS]] })],
      THIS,
      'this-uuid',
    )
    expect(m.references).toEqual(['30851:aa:pay-1', THIS])
  })

  it('reports one row per event', () => {
    const e = event('dup', { h: OTHER_H, a: [THIS] })
    expect(topicMentionsOf([e, e], THIS, 'this-uuid')).toHaveLength(1)
  })
})
