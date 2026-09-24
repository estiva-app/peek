import { HIGHLIGHT_FILL_CLASSES, HIGHLIGHT_META, type HighlightType } from '@/api'
import { cn } from '@/lib/utils'

interface HighlightPillProps {
  type: HighlightType
  className?: string
}

/**
 * The small label naming a message's highlight, such as Insight or Question,
 * with its colour square in front.
 */
export function HighlightPill({ type, className }: HighlightPillProps) {
  const meta = HIGHLIGHT_META[type]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm bg-accent-muted text-chip whitespace-nowrap shrink-0',
        className
      )}
    >
      <span className={cn('size-[10px] rounded-sm shrink-0', HIGHLIGHT_FILL_CLASSES[type])} />
      {/* @estiva-escape: A4 (Katerina, 24 September: record only): a highlight's name in the chip text style; whether it should be a Chip is for later */}
      <span className="text-text-primary signal:font-mono signal:text-small signal:font-semibold signal:tracking-wide">{meta.label}</span>
    </span>
  )
}

/**
 * The colour square for one kind of highlight on its own, used where the name
 * is written beside it, as in the highlight menu.
 */
export function HighlightSwatch({ type, className }: { type: HighlightType; className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center size-4 shrink-0', className)}>
      <span className={cn('size-3 rounded-sm', HIGHLIGHT_FILL_CLASSES[type])} />
    </span>
  )
}
