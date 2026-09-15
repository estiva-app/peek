import { HIGHLIGHT_FILL_CLASSES, HIGHLIGHT_META, type HighlightType } from '@/api'
import { cn } from '@/lib/utils'

interface HighlightPillProps {
  type: HighlightType
  className?: string
}

export function HighlightPill({ type, className }: HighlightPillProps) {
  const meta = HIGHLIGHT_META[type]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm bg-accent-muted text-chip whitespace-nowrap shrink-0',
        className
      )}
    >
      <span className={cn('size-[10px] rounded-[2px] shrink-0', HIGHLIGHT_FILL_CLASSES[type])} />
      <span className="text-text-primary signal:font-mono signal:text-small signal:font-semibold signal:tracking-wide">{meta.label}</span>
    </span>
  )
}

export function HighlightSwatch({ type, className }: { type: HighlightType; className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center size-4 shrink-0', className)}>
      <span className={cn('size-3 rounded-[3px]', HIGHLIGHT_FILL_CLASSES[type])} />
    </span>
  )
}
