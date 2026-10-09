import { describe, expect, it } from 'vitest'
import { notSentNote } from './notSent'

describe('notSentNote — what a refused send says (OPT-7)', () => {
  it('says where the text went back, not what the relay said', () => {
    expect(notSentNote('Design review', 'Design review', 'invalid: event id does not match', false)).toBe('Not sent — text restored in Design review')
    expect(notSentNote('your reply to Ana', 'Design review', 'blocked: spam', false)).toBe('Not sent — text restored in your reply to Ana')
  })

  it('says access is gone, in the conversation and not the thread, when that is why', () => {
    expect(notSentNote('your reply to Ana', 'Design review', 'restricted: not a channel member', false)).toBe(
      'Not sent — you can no longer post in Design review; text restored',
    )
    expect(notSentNote('your conversation with Ana', 'your conversation with Ana', 'restricted: not a relay member', false)).toBe(
      'Not sent — you can no longer post in your conversation with Ana; text restored',
    )
  })

  it('adds that the files stayed behind', () => {
    expect(notSentNote('Design review', 'Design review', 'invalid', true)).toBe('Not sent — text restored in Design review, files not restored')
  })
})
