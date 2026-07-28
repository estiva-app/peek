/**
 * Client-side timestamp/date-label formatting — domain model §5.
 * Display strings are pure functions of createdAt; these replace the
 * stored `timestamp`/`dateLabel` mock fields as entities move to Convex.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `'Just now'` under 60s, else `h:mm AM/PM` (no leading zero). */
export function formatTimestamp(createdAt: number, now: number = Date.now()): string {
  if (now - createdAt < 60_000) return 'Just now'
  const d = new Date(createdAt)
  const hh = d.getHours()
  const mm = d.getMinutes()
  const ampm = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 || 12
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** `'Today'`, `'Yesterday'`, else `'EEE, MMMM d'` — no year, ever. */
export function formatDateLabel(createdAt: number, now: number = Date.now()): string {
  const d = new Date(createdAt)
  const n = new Date(now)
  if (sameLocalDay(d, n)) return 'Today'
  const yesterday = new Date(now - 24 * 60 * 60 * 1000)
  if (sameLocalDay(d, yesterday)) return 'Yesterday'
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Reply-card timestamp — the day rides along once it stops being obvious:
 *  `'Just now'` → `'2:30 PM'` (today) → `'Yesterday at 2:30 PM'` →
 *  `'Sep 3 at 2:30 PM'` (this year) → `'Sep 3, 2025 at 2:30 PM'`.
 *  Day and time join with `at`, not a dot (ruling 2026-07-28). Thread panels
 *  have no date dividers, so the label itself carries the day; the feed
 *  keeps plain times — dividers own the day there. */
export function formatReplyTimestamp(createdAt: number, now: number = Date.now()): string {
  if (now - createdAt < 60_000) return 'Just now'
  const time = formatTimestamp(createdAt, now)
  const d = new Date(createdAt)
  const n = new Date(now)
  if (sameLocalDay(d, n)) return time
  if (sameLocalDay(d, new Date(now - 24 * 60 * 60 * 1000))) return `Yesterday at ${time}`
  const monthDay = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === n.getFullYear()
    ? `${monthDay} at ${time}`
    : `${monthDay}, ${d.getFullYear()} at ${time}`
}

/** Local calendar-day key for grouping (stable across DST). */
export function dayKey(createdAt: number): string {
  const d = new Date(createdAt)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** `'MMMM d'` — the promotion divider's date (per topicStore.formatPromotedAt). */
export function formatPromotedAt(createdAt: number): string {
  const d = new Date(createdAt)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
