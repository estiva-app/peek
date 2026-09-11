import { cn } from '@/lib/utils'
import { WithTooltip } from './WithTooltip'
import { EmptyState } from './EmptyState'

/**
 * What has happened to a topic, as a timeline (PEE-2).
 *
 * The same bullets-and-connector treatment the replies panel already uses for
 * resolutions — dots down one axis, a line between them, one line of 12px text
 * each — because this is the same idea at a larger scale and a second visual
 * language for "a history" would be one too many.
 *
 * Not a copy of that component: its dot column is 40px wide to line its bullets
 * up with the reply cards' avatars, which is a geometry that only means
 * something in that panel. What is shared is the treatment, not the numbers.
 *
 * Oldest first, reading downwards. A topic's history is short enough that
 * newest-first would only make the beginning hard to find.
 */
export type ActivityKind = 'created' | 'renamed' | 'resolved' | 'reopened' | 'joined' | 'left'

export interface ActivityEntry {
  kind: ActivityKind
  /** Milliseconds. */
  at: number
  /** Who did it. Null for someone Peek cannot name. */
  by: string | null
  /** A rename's previous name. Kept for the record even though the line reads
   *  forwards — it is the only place the old name survives at all. */
  detail?: string
  /** A rename's new name, or the message a resolution was about. */
  subject?: string
}

const DOT: Record<ActivityKind, string> = {
  created: 'bg-accent-primary',
  renamed: 'bg-text-muted',
  resolved: 'bg-success-default',
  reopened: 'bg-text-muted',
  joined: 'bg-text-muted',
  left: 'bg-text-muted',
}

/**
 * How long ago, at the precision that is worth reading.
 *
 * A history is scanned for *when roughly*, not for a timestamp: "3h" answers
 * the question people actually have, and a date does the same job once
 * something is old enough that hours stop meaning anything. The full date and
 * time is on the element's `title`, so the precise answer is one hover away
 * rather than taking up the row for everybody.
 *
 * The year appears only when it is not this one — a history that is mostly
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

const exactly = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  })

export function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    // A hand-made empty line until 2026-09-10 (PEEK-ADOPTION.md 13.1).
    return <EmptyState scope="section" message="Nothing has happened yet." />
  }

  return (
    <div className="relative flex flex-col gap-2">
      {/* The connector runs through the centre of the dot column and stops at
          the first and last bullet, so it reads as joining them rather than as
          a rule the entries happen to sit on. */}
      {entries.length > 1 && (
        <div aria-hidden className="absolute left-[7.5px] top-[9px] bottom-[24px] w-px bg-border-default" />
      )}
      {entries.map((entry, i) => (
        <div key={`${entry.kind}-${entry.at}-${i}`} data-activity={entry.kind} className="relative flex items-start gap-2">
          <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">
            {/* The outer disc is the page colour and masks the connector, so the
                line appears to stop at each bullet rather than run under it. */}
            <span className="flex size-2 items-center justify-center rounded-full bg-bg-elevated">
              <span className={cn('size-1 rounded-full', DOT[entry.kind])} />
            </span>
          </span>
          {/*
            * The time goes *under* the entry, not beside it (Katerina,
            * 2026-08-20). Beside, it was a column the text had to make room
            * for, and the longer entries — a resolution carrying its message —
            * are the ones that need the width most. Underneath, every entry
            * gets the full line and the times still read down one edge.
            */}
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <p className="text-[12px] leading-[1.4]">
              <Line entry={entry} />
            </p>
            <WithTooltip label={exactly(entry.at)} wrapperClassName="self-start">
              <span className="text-[12px] leading-[1.4] text-text-muted">{whenLabel(entry.at)}</span>
            </WithTooltip>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * One entry, in words.
 *
 * The person is always named first and always in the primary tone, because
 * "who" is what people scan a history for. What they did stays secondary,
 * except where the thing itself is the point — a rename's old name, a
 * resolution's message.
 */
function Line({ entry }: { entry: ActivityEntry }) {
  const who = <span className="text-text-primary">{entry.by ?? 'Someone'}</span>

  switch (entry.kind) {
    case 'created':
      return (
        <>
          {who}
          <span className="text-text-secondary"> created this topic</span>
        </>
      )
    case 'renamed':
      return (
        <>
          {who}
          {/* Forwards, to the new name (Katerina, 2026-08-20). Reading it
              backwards from the old one made the entry a puzzle: you had to
              find the next rename below to learn what it became. */}
          <span className="text-text-secondary"> renamed this topic to </span>
          <span className="text-text-primary">{entry.subject}</span>
        </>
      )
    case 'joined':
      return (
        <>
          {who}
          <span className="text-text-secondary"> joined</span>
        </>
      )
    case 'left':
      // Nothing produces this yet — leaving a topic does not exist in Peek.
      // Carried so the timeline is ready for it rather than needing a change
      // in two places later (Katerina, 2026-08-20).
      return (
        <>
          {who}
          <span className="text-text-secondary"> left</span>
        </>
      )
    case 'resolved':
      return (
        <>
          {who}
          <span className="text-success-default"> resolved</span>
          {entry.subject && <span className="text-text-secondary"> · {entry.subject}</span>}
        </>
      )
    case 'reopened':
      return (
        <>
          {who}
          <span className="text-text-secondary"> reopened</span>
          {entry.subject && <span className="text-text-secondary"> · {entry.subject}</span>}
        </>
      )
  }
}
