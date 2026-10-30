/**
 * When a Screener item comes back after "Later", and how that time is said.
 *
 * "Tomorrow" was 24 hours from the click, so a Later pressed at 11 PM came
 * back at 11 PM, and "In a week" was the same to the minute (Katerina,
 * 30 October). The two far choices land at the start of a working day now:
 * tomorrow at 9:00, and the coming Monday at 9:00.
 */

/** The hour a "Tomorrow" or a "Next week" lands on, local time. */
const MORNING_HOUR = 9
const HOUR_MS = 60 * 60 * 1000
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `h:mm AM` — `formatTimestamp`'s clock, without its "Just now", which is for the past. */
function clock(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export interface LaterOption {
  label: string
  /** The absolute instant it comes back, ms. */
  untilMs: number
}

/** The local day `days` after `now`'s, at 9:00. Calendar arithmetic, so a DST change does not move the hour. */
function morningAfter(now: number, days: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, MORNING_HOUR).getTime()
}

/** The Later menu's choices, worked out from `now`. */
export function laterOptions(now: number): LaterOption[] {
  // The coming Monday, a full week ahead on a Monday itself.
  const toMonday = ((8 - new Date(now).getDay()) % 7) || 7
  return [
    { label: 'In 1 hour', untilMs: now + HOUR_MS },
    { label: 'In 3 hours', untilMs: now + 3 * HOUR_MS },
    { label: 'Tomorrow', untilMs: morningAfter(now, 1) },
    { label: 'Next week', untilMs: morningAfter(now, toMonday) },
  ]
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * The time a choice lands on, at the right of its row: a bare time today
 * (Peek's rule: a bare time means today), the day's short name before it on
 * any other day. Every choice is within a week, so the name says which day.
 */
export function laterMenuTime(untilMs: number, now: number): string {
  const until = new Date(untilMs)
  const time = clock(untilMs)
  return sameLocalDay(until, new Date(now)) ? time : `${DAYS[until.getDay()]} ${time}`
}

/** What the toast after a Later says: "Back at 4:15 PM", "Back tomorrow at 9:00 AM", "Back Mon at 9:00 AM". */
export function laterToastLabel(untilMs: number, now: number): string {
  const until = new Date(untilMs)
  const time = clock(untilMs)
  if (sameLocalDay(until, new Date(now))) return `Back at ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameLocalDay(until, tomorrow)) return `Back tomorrow at ${time}`
  return `Back ${DAYS[until.getDay()]} at ${time}`
}
