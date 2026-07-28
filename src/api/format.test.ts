import { describe, expect, it } from 'vitest'
import { formatDateLabel, formatTimestamp, formatReplyTimestamp, dayKey } from './format'

// Fixed "now": Tue Sep 3 2024, 10:00:00 local time.
const NOW = new Date(2024, 8, 3, 10, 0, 0).getTime()

describe('formatTimestamp (§5)', () => {
  it('renders Just now under 60s', () => {
    expect(formatTimestamp(NOW - 59_000, NOW)).toBe('Just now')
  })
  it('renders h:mm AM with no leading zero', () => {
    expect(formatTimestamp(new Date(2024, 8, 3, 9, 14).getTime(), NOW)).toBe('9:14 AM')
  })
  it('renders PM hours on a 12-hour clock', () => {
    expect(formatTimestamp(new Date(2024, 8, 2, 16, 5).getTime(), NOW)).toBe('4:05 PM')
  })
  it('renders 12 AM/PM at the edges', () => {
    expect(formatTimestamp(new Date(2024, 8, 2, 0, 30).getTime(), NOW)).toBe('12:30 AM')
    expect(formatTimestamp(new Date(2024, 8, 2, 12, 0).getTime(), NOW)).toBe('12:00 PM')
  })
})

describe('formatReplyTimestamp', () => {
  it('renders Just now under 60s', () => {
    expect(formatReplyTimestamp(NOW - 59_000, NOW)).toBe('Just now')
  })
  it('renders plain time for today', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 3, 9, 14).getTime(), NOW)).toBe('9:14 AM')
  })
  it('joins Yesterday with "at" for the previous local day', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 2, 16, 5).getTime(), NOW)).toBe('Yesterday at 4:05 PM')
  })
  it('joins short month + day with "at" within the same year', () => {
    expect(formatReplyTimestamp(new Date(2024, 7, 28, 11, 45).getTime(), NOW)).toBe('Aug 28 at 11:45 AM')
  })
  it('adds the year for previous years', () => {
    expect(formatReplyTimestamp(new Date(2023, 11, 24, 18, 0).getTime(), NOW)).toBe('Dec 24, 2023 at 6:00 PM')
  })
})

describe('formatDateLabel (§5)', () => {
  it('renders Today for the same local day', () => {
    expect(formatDateLabel(new Date(2024, 8, 3, 0, 5).getTime(), NOW)).toBe('Today')
  })
  it('renders Yesterday for the previous local day', () => {
    expect(formatDateLabel(new Date(2024, 8, 2, 23, 59).getTime(), NOW)).toBe('Yesterday')
  })
  it('renders EEE, MMMM d with no year for older days', () => {
    // Mon Sep 2 2024 is "Yesterday" from NOW; use the mock label date 2024-08-26 (a Monday).
    expect(formatDateLabel(new Date(2024, 7, 26).getTime(), NOW)).toBe('Mon, August 26')
  })
  it('reproduces the mock label format exactly', () => {
    // 'Mon, September 2' — the canonical mock label — from a different "now".
    const later = new Date(2024, 8, 10, 10, 0).getTime()
    expect(formatDateLabel(new Date(2024, 8, 2, 9, 14).getTime(), later)).toBe('Mon, September 2')
  })
})

describe('dayKey', () => {
  it('groups by local calendar day', () => {
    expect(dayKey(new Date(2024, 8, 2, 0, 1).getTime())).toBe(dayKey(new Date(2024, 8, 2, 23, 59).getTime()))
    expect(dayKey(new Date(2024, 8, 2, 23, 59).getTime())).not.toBe(dayKey(new Date(2024, 8, 3, 0, 1).getTime()))
  })
})
