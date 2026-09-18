import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface DateDividerProps {
  label: ReactNode
  className?: string
}

/**
 * A thin line across a list with a label in the middle, such as a date or
 * "Replies", that separates one stretch of messages from the next.
 */
export function DateDivider({ label, className }: DateDividerProps) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1.5', className)}>
      <div className="flex-1 h-px bg-border-subtle" />
      {/* min-w-0 + truncate (not shrink-0): long labels — e.g. "Promoted to
          {long topic title}" in a 380px thread panel — ellipsize instead of
          clipping at the container edge. Short date labels are unaffected. */}
      <span className="text-h5 text-text-secondary min-w-0 truncate signal:font-mono signal:text-small signal:uppercase signal:tracking-widest signal:text-text-muted">{label}</span>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  )
}
