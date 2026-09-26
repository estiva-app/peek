import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TONE = {
  muted: 'text-text-muted',
  secondary: 'text-text-secondary',
  success: 'text-success-default',
} as const

/**
 * The small figure beside a name or a count: a message's time, a thread entry's
 * time, a topic's open and resolved counts. One line, and in Signal the mono
 * micro-type with even digits. It was typed by hand in nine places (UIG-25).
 * @registry reusable: stays in Peek (Katerina, 24 September, UIG-25)
 */
export function MetaText({
  children,
  tone = 'muted',
  size = 'caption',
  className,
}: {
  children: ReactNode
  /** `muted` for a time; `secondary` and `success` for a topic's open and resolved counts. */
  tone?: keyof typeof TONE
  /** `chip` beside a small name, in the thread panel and the Screener's preview. */
  size?: 'caption' | 'chip'
  /** Placement only: `shrink-0`, `contents`. */
  className?: string
}) {
  return (
    // @estiva-escape(no-copied-look): A4 (Katerina, 24 September: record only): the chip size shares TopicState's count style; TopicState keeps its own
    <span
      className={cn(
        size === 'chip' ? 'text-chip font-normal' : 'text-caption',
        TONE[tone],
        'whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums',
        className,
      )}
    >
      {children}
    </span>
  )
}
