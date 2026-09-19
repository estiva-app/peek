import type { ReactNode } from 'react'
import { Divider } from '@estiva-app/ui'
import { cn } from '@/lib/utils'

interface DateDividerProps {
  label: ReactNode
  className?: string
}

/**
 * A thin line across a list with a label in the middle, such as a date or
 * "Replies", that separates one stretch of messages from the next.
 *
 * Its two lines are the package's `Divider`, edge to edge (`mx-0`), and the
 * label between them is Peek's (UIG-14). Not the package's labelled Divider:
 * that one takes a string only and draws it as a muted caption, and this
 * label is the section-label voice, truncates, and is sometimes a row of its
 * own (the promotion line in the thread panel).
 * @registry reusable: stays in Peek (Katerina, 18 September)
 */
export function DateDivider({ label, className }: DateDividerProps) {
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1.5', className)}>
      <Divider className="mx-0 flex-1" />
      {/* min-w-0 + truncate (not shrink-0): long labels — e.g. "Promoted to
          {long topic title}" in a 380px thread panel — ellipsize instead of
          clipping at the container edge. Short date labels are unaffected. */}
      <span className="text-h5 text-text-secondary min-w-0 truncate signal:font-mono signal:text-small signal:uppercase signal:tracking-widest signal:text-text-muted">{label}</span>
      <Divider className="mx-0 flex-1" />
    </div>
  )
}
