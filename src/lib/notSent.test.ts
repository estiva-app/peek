import { describe, expect, it } from 'vitest'
import { notSavedNote, notSentNote, notSentReason } from './notSent'

describe('notSentReason — the line under the box after a refused send (PEEKM-3)', () => {
  it('says lost access as what it means, and never the relay’s own words', () => {
    expect(notSentReason('Design review', 'restricted: not a channel member')).toBe('you can no longer post in Design review')
    expect(notSentReason('Design review', 'invalid: event too large')).toBe('the relay did not take it')
  })
})

describe('notSavedNote — what a refused reaction, edit or delete says (OPT-8, Miky 9 Oct)', () => {
  it('says which change did not go through, and where what came back is', () => {
    expect(notSavedNote('reaction', 'Design review', 'Design review', 'invalid: event id does not match')).toBe('Reaction not saved')
    expect(notSavedNote('edit', 'Design review', 'Design review', 'invalid: event id does not match')).toBe(
      'Edit not saved — text restored in its edit box in Design review',
    )
    expect(notSavedNote('delete', 'your conversation with Ana', 'your conversation with Ana', 'blocked')).toBe(
      'Not deleted — the message is back in your conversation with Ana',
    )
  })

  it('says access is gone, in the conversation, when that is why', () => {
    for (const change of ['reaction', 'edit', 'delete'] as const)
      expect(notSavedNote(change, 'Design review', 'Design review', 'restricted: not a channel member')).toBe(
        'Not saved — you can no longer post in Design review',
      )
  })
})

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
