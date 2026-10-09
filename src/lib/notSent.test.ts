import { describe, expect, it } from 'vitest'
import { notSentNote } from './notSent'

const TEXT = { text: true, files: false, filesLost: false }

describe('notSentNote — what a refused send says (OPT-7)', () => {
  it('says where the text went back, not what the relay said', () => {
    expect(notSentNote('Design review', 'Design review', 'invalid: event id does not match', TEXT)).toBe('Not sent — text restored in Design review')
    expect(notSentNote('your reply to Ana', 'Design review', 'blocked: spam', TEXT)).toBe('Not sent — text restored in your reply to Ana')
  })

  it('says access is gone, in the conversation and not the thread, when that is why', () => {
    expect(notSentNote('your reply to Ana', 'Design review', 'restricted: not a channel member', TEXT)).toBe(
      'Not sent — you can no longer post in Design review; text restored',
    )
    expect(notSentNote('your conversation with Ana', 'your conversation with Ana', 'restricted: not a relay member', TEXT)).toBe(
      'Not sent — you can no longer post in your conversation with Ana; text restored',
    )
  })

  it('says what came back, and that files stayed behind', () => {
    expect(notSentNote('Design review', 'Design review', 'invalid', { text: true, files: true, filesLost: false })).toBe(
      'Not sent — text and files restored in Design review',
    )
    expect(notSentNote('Design review', 'Design review', 'invalid', { text: true, files: false, filesLost: true })).toBe(
      'Not sent — text restored in Design review, files not restored',
    )
  })

  it('never claims text came back when none did', () => {
    expect(notSentNote('Design review', 'Design review', 'invalid', { text: false, files: false, filesLost: true })).toBe('Not sent; files not restored')
    expect(notSentNote('Design review', 'Design review', 'invalid', { text: false, files: false, filesLost: false })).toBe('Not sent')
  })
})
