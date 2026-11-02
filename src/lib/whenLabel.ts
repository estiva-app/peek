/**
 * How long ago, at the precision that is worth reading — the time on another
 * app's comment in Peek (`CommentRow`). It was the time words of Peek's
 * `ActivityTimeline`, which nothing drew and which went (audit D9, 2 November).
 *
 * A history is scanned for *when roughly*, not for a timestamp: "3h" answers
 * the question people actually have, and a date does the same job once
 * something is old enough that hours stop meaning anything.
 *
 * The year appears only when it is not this one — a list that is mostly
 * recent should not repeat "2026" down its right-hand edge.
 */
export function whenLabel(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const then = new Date(at)
  const sameYear = then.getFullYear() === new Date(now).getFullYear()
  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
