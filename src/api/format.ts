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

/** The local calendar day before `d`. Calendar arithmetic rather than
 *  `now - 24h`: on the day a DST fallback stretches to 25 hours, subtracting
 *  24h from an evening "now" lands back inside the SAME day, and "Yesterday"
 *  would never match. */
function previousLocalDay(d: Date): Date {
  const p = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  p.setDate(p.getDate() - 1)
  return p
}

/** `'Today'`, `'Yesterday'`, else `'EEE, MMMM d'` — no year, ever. */
export function formatDateLabel(createdAt: number, now: number = Date.now()): string {
  const d = new Date(createdAt)
  const n = new Date(now)
  if (sameLocalDay(d, n)) return 'Today'
  if (sameLocalDay(d, previousLocalDay(n))) return 'Yesterday'
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Timestamp for anywhere a time stands with NO date divider above it —
 *  thread reply cards, the thread's pinned root message, the resolve/reopen
 *  bullets, the screener.
 *
 *  One rule, no exceptions: A BARE TIME MEANS TODAY. Every older day names
 *  itself, so the day is never inferred from a divider or a neighbouring row
 *  (ruling 2026-08-20, replacing 2026-07-29's explicit `Today at …`, which
 *  repeated "Today" on every row of a live thread). The rule only holds while
 *  it holds everywhere: one surface showing a bare time for something that is
 *  not today makes every bare time in the app ambiguous again.
 *
 *  `'Just now'` → `'2:30 PM'` → `'Yesterday at 2:30 PM'` →
 *  `'Sep 3 at 2:30 PM'` (this year) → `'Sep 3, 2025 at 2:30 PM'`.
 *  Day and time join with `at`, not a dot (ruling 2026-07-28). */
export function formatReplyTimestamp(createdAt: number, now: number = Date.now()): string {
  if (now - createdAt < 60_000) return 'Just now'
  const time = formatTimestamp(createdAt, now)
  const d = new Date(createdAt)
  const n = new Date(now)
  if (sameLocalDay(d, n)) return time
  if (sameLocalDay(d, previousLocalDay(n))) return `Yesterday at ${time}`
  const monthDay = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === n.getFullYear()
    ? `${monthDay} at ${time}`
    : `${monthDay}, ${d.getFullYear()} at ${time}`
}
