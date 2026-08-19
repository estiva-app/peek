import { cn } from '@/lib/utils'

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
export type ActivityKind = 'created' | 'renamed' | 'resolved' | 'reopened' | 'joined'

export interface ActivityEntry {
  kind: ActivityKind
  /** Milliseconds. */
  at: number
  /** Who did it. Null for someone Peek cannot name. */
  by: string | null
  /** A rename's previous name. */
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
}

const day = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export function ActivityTimeline({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-[12px] leading-[1.4] text-text-secondary">Nothing has happened yet.</p>
  }

  return (
    <div className="relative flex flex-col gap-2">
      {/* The connector runs through the centre of the dot column and stops at
          the first and last bullet, so it reads as joining them rather than as
          a rule the entries happen to sit on. */}
      {entries.length > 1 && (
        <div aria-hidden className="absolute left-[7.5px] top-[9px] bottom-[9px] w-px bg-border-default" />
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
          <p className="min-w-0 flex-1 text-[12px] leading-[1.4]">
            <Line entry={entry} />
          </p>
          <span className="shrink-0 text-[12px] leading-[1.4] text-text-muted">{day(entry.at)}</span>
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
          <span className="text-text-secondary"> renamed it from </span>
          {/* The old name is the half worth showing: the new one is the title
              at the top of the dialog. */}
          <span className="text-text-primary">{entry.detail}</span>
        </>
      )
    case 'joined':
      return (
        <>
          {who}
          <span className="text-text-secondary"> joined</span>
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
