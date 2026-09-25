import { describe, expect, it } from 'vitest'
import { formatDateLabel, formatTimestamp, formatReplyTimestamp } from './format'

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

/**
 * The rule these two share (2026-08-20): a bare time means TODAY, and every
 * older day names itself. formatReplyTimestamp is the rule; the pill below
 * adds the single exception, for a card sitting under an older date divider.
 */
describe('formatReplyTimestamp — a bare time means today', () => {
  it('renders Just now under 60s', () => {
    expect(formatReplyTimestamp(NOW - 59_000, NOW)).toBe('Just now')
  })
  it('stops saying Just now at exactly 60s', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 3, 9, 59, 0).getTime(), NOW)).toBe('9:59 AM')
  })
  it('leaves today bare — no "Today at" (ruling 2026-08-20)', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 3, 9, 14).getTime(), NOW)).toBe('9:14 AM')
  })
  it('leaves the first minute of today bare', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 3, 0, 0).getTime(), NOW)).toBe('12:00 AM')
  })
  it('joins Yesterday with "at" for the previous local day', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 2, 16, 5).getTime(), NOW)).toBe('Yesterday at 4:05 PM')
  })
  it('covers the whole of yesterday, both edges', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 2, 0, 0).getTime(), NOW)).toBe('Yesterday at 12:00 AM')
    expect(formatReplyTimestamp(new Date(2024, 8, 2, 23, 59).getTime(), NOW)).toBe('Yesterday at 11:59 PM')
  })
  it('joins short month + day with "at" within the same year', () => {
    expect(formatReplyTimestamp(new Date(2024, 7, 28, 11, 45).getTime(), NOW)).toBe('Aug 28 at 11:45 AM')
  })
  it('names the day two days back — never bare', () => {
    expect(formatReplyTimestamp(new Date(2024, 8, 1, 13, 30).getTime(), NOW)).toBe('Sep 1 at 1:30 PM')
  })
  it('adds the year for previous years', () => {
    expect(formatReplyTimestamp(new Date(2023, 11, 24, 18, 0).getTime(), NOW)).toBe('Dec 24, 2023 at 6:00 PM')
  })
  it('does not mistake the same month+day of another year for today', () => {
    expect(formatReplyTimestamp(new Date(2023, 8, 3, 9, 14).getTime(), NOW)).toBe('Sep 3, 2023 at 9:14 AM')
  })
  it('says Yesterday across a year boundary', () => {
    const newYear = new Date(2025, 0, 1, 0, 30).getTime()
    expect(formatReplyTimestamp(new Date(2024, 11, 31, 23, 50).getTime(), newYear)).toBe('Yesterday at 11:50 PM')
  })
  it('treats a future timestamp as Just now (clock skew / optimistic send)', () => {
    expect(formatReplyTimestamp(NOW + 5 * 60_000, NOW)).toBe('Just now')
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

/**
 * "Yesterday" is the previous CALENDAR day, not now-minus-24h. On the day a
 * DST fallback stretches to 25 hours, 24h before a late evening lands back
 * inside that same day, and the old arithmetic silently lost "Yesterday".
 * Walking a full year in the runner's own zone hits whatever transitions it
 * has; in a zone without DST this simply passes.
 */
describe('previous-day arithmetic is calendar-based, not 24h-based', () => {
  for (const hour of [0, 12, 23]) {
    it('resolves Yesterday for every day of a year at ' + hour + ':30 local', () => {
      const failures: string[] = []
      for (let i = 0; i < 365; i++) {
        const now = new Date(2026, 0, 1 + i, hour, 30)
        const prev = new Date(2026, 0, i, hour, 30) // Date normalises day 0 → the previous month
        const label = formatDateLabel(prev.getTime(), now.getTime())
        if (label !== 'Yesterday') failures.push(prev.toDateString() + ' from ' + now.toDateString() + ': ' + label)
      }
      expect(failures).toEqual([])
    })
  }
  it('rolls back across a month boundary', () => {
    const mar1 = new Date(2024, 2, 1, 10, 0).getTime()
    expect(formatDateLabel(new Date(2024, 1, 29, 22, 0).getTime(), mar1)).toBe('Yesterday')
  })
  it('rolls back across a year boundary', () => {
    const jan1 = new Date(2025, 0, 1, 10, 0).getTime()
    expect(formatDateLabel(new Date(2024, 11, 31, 22, 0).getTime(), jan1)).toBe('Yesterday')
  })
})
