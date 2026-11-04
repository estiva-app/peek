import { describe, expect, it } from 'vitest'
import { notSavedNote, notSentNote } from './notSent'

const TEXT = { text: true, files: false, filesLost: false }

describe('notSentNote — a send refused after the person left that conversation (OPT-7, ONE-4)', () => {
  it('names where it was sent, says why in the box’s words, and where the text went back, never the relay’s words', () => {
    expect(notSentNote('Design review', 'invalid: content exceeds maximum size of 262144 bytes', TEXT)).toBe(
      'Not sent in Design review: it is too long. Your text is back in its box.',
    )
    expect(notSentNote('Design review', 'invalid: event id does not match', TEXT)).toBe(
      'Not sent in Design review: something went wrong, try again. Your text is back in its box.',
    )
  })

  it('says lost access as "there", never "here": the person reads it from another conversation (Miky, at /land of peek#617)', () => {
    expect(notSentNote('your reply to Ana', 'blocked: spam', TEXT)).toBe('Not sent in your reply to Ana: you can no longer write there. Your text is back in its box.')
    const note = notSentNote('your conversation with Ana', 'restricted: not a relay member', TEXT)
    expect(note).toBe('Not sent in your conversation with Ana: you can no longer write there. Your text is back in its box.')
    expect(note).not.toMatch(/\brelay\b|\bhere\b/)
  })

  it('says what came back, and that files stayed behind', () => {
    expect(notSentNote('Design review', 'invalid', { text: true, files: true, filesLost: false })).toBe(
      'Not sent in Design review: something went wrong, try again. Your text and files are back in its box.',
    )
    expect(notSentNote('Design review', 'rate-limited: slow down', { text: true, files: false, filesLost: true })).toBe(
      'Not sent in Design review: too many at once, try again in a moment. Your text is back in its box. Its files could not be put back.',
    )
  })

  it('never claims text came back when none did', () => {
    expect(notSentNote('Design review', 'invalid', { text: false, files: false, filesLost: true })).toBe(
      'Not sent in Design review: something went wrong, try again. Its files could not be put back.',
    )
    expect(notSentNote('Design review', 'invalid', { text: false, files: false, filesLost: false })).toBe('Not sent in Design review: something went wrong, try again.')
  })
})

describe('notSavedNote — a refused edit or delete no card is on screen to say (OPT-8, ONE-4)', () => {
  it('names where, says why in the shared words with "there", and where what came back is', () => {
    expect(notSavedNote('edit', 'Design review', 'invalid: edit target not found or not editable by you')).toBe(
      'Not saved in Design review: this message was deleted, or you can no longer write there. Your text is back in its edit box.',
    )
    expect(notSavedNote('delete', 'your conversation with Ana', 'restricted: not a channel member')).toBe(
      'Not deleted in your conversation with Ana: you can no longer write there. The message is back.',
    )
  })
})
