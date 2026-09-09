import type { ReactNode } from 'react'
import {
  IconMoodPlus,
  IconMessage2,
  IconCircleCheck,
  IconCircleDashed,
} from '@tabler/icons-react'
import { IconButton } from './ui/IconButton'
import { cn } from '@/lib/utils'

interface ConversationQuickMenuProps {
  isResolved?: boolean
  onReact?: () => void
  onReply?: () => void
  onResolve?: () => void
  onReopen?: () => void
  /**
   * The ⋯ menu itself, which owns its own button since `@estiva-app/ui`
   * 0.10.0. This strip used to keep a ref, measure that button and hand the
   * rect upward so the card could place a menu; all of it existed to tell a
   * menu where a button it can hold itself was.
   */
  more?: ReactNode
  className?: string
}

export function ConversationQuickMenu({
  isResolved = false,
  onReact,
  onReply,
  onResolve,
  onReopen,
  more,
  className,
}: ConversationQuickMenuProps) {
  return (
    <div
      className={cn(
        'bg-bg-elevated border border-border-subtle rounded-sm shadow-sm flex items-start gap-1 p-1',
        className
      )}
    >
      <IconButton tooltip="React" aria-label="React" onClick={onReact}>
        <IconMoodPlus size={16} stroke={1.5} />
      </IconButton>
      <IconButton tooltip="Reply" aria-label="Reply" onClick={onReply}>
        <IconMessage2 size={16} stroke={1.5} />
      </IconButton>

      <div className="w-px self-stretch bg-border-subtle" />

      {isResolved ? (
        <IconButton tooltip="Reopen" aria-label="Reopen" onClick={onReopen}>
          <IconCircleDashed size={16} stroke={1.5} />
        </IconButton>
      ) : (
        <IconButton
          tooltip="Resolve"
          aria-label="Resolve"
          onClick={onResolve}
          className="signal:hover:bg-success-muted signal:hover:text-success-default"
        >
          <IconCircleCheck size={16} stroke={1.5} />
        </IconButton>
      )}

      <div className="w-px self-stretch bg-border-subtle" />

      {more}
    </div>
  )
}
