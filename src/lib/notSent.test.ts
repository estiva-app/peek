import { describe, expect, it } from 'vitest'
import { notSavedNote, notSentNote } from './notSent'

const TEXT = { text: true, files: false, filesLost: false }

describe('notSentNote — a send refused after the person left that conversation (OPT-7, ONE-4)', () => {
  it('says why in the box’s words, and where the text went back, never the relay’s words', () => {
    expect(notSentNote('Design review', 'invalid: content exceeds maximum size of 262144 bytes', TEXT)).toBe(
      'Not sent: it is too long — text restored in Design review',
    )
    expect(notSentNote('your reply to Ana', 'blocked: spam', TEXT)).toBe('Not sent: you can no longer write here — text restored in your reply to Ana')
    expect(notSentNote('Design review', 'invalid: event id does not match', TEXT)).toBe(
      'Not sent: something went wrong, try again — text restored in Design review',
    )
  })

  it('says lost access once, and never "relay"', () => {
    const note = notSentNote('your conversation with Ana', 'restricted: not a relay member', TEXT)
    expect(note).toBe('Not sent: you can no longer write here — text restored in your conversation with Ana')
    expect(note).not.toMatch(/relay/)
  })

  it('says what came back, and that files stayed behind', () => {
    expect(notSentNote('Design review', 'invalid', { text: true, files: true, filesLost: false })).toBe(
      'Not sent: something went wrong, try again — text and files restored in Design review',
    )
    expect(notSentNote('Design review', 'rate-limited: slow down', { text: true, files: false, filesLost: true })).toBe(
      'Not sent: too many at once, try again in a moment — text restored in Design review, files not restored',
    )
  })

  it('never claims text came back when none did', () => {
    expect(notSentNote('Design review', 'invalid', { text: false, files: false, filesLost: true })).toBe(
      'Not sent: something went wrong, try again; files not restored',
    )
    expect(notSentNote('Design review', 'invalid', { text: false, files: false, filesLost: false })).toBe('Not sent: something went wrong, try again')
  })
})

describe('notSavedNote — a refused edit or delete no card is on screen to say (OPT-8, ONE-4)', () => {
  it('says why in the shared words, and where what came back is', () => {
    expect(notSavedNote('edit', 'Design review', 'invalid: edit target not found or not editable by you')).toBe(
      'Not saved: this message was deleted, or you can no longer write here — text restored in its edit box in Design review',
    )
    expect(notSavedNote('delete', 'your conversation with Ana', 'restricted: not a channel member')).toBe(
      'Not deleted: you can no longer write here — the message is back in your conversation with Ana',
    )
  })
})
