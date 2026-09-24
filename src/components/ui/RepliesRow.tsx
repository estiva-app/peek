import { IconChevronRight, IconMessage2 } from '@tabler/icons-react'
import { AvatarGroup } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'
import { cn } from '@/lib/utils'
import { Chip } from './Chip'

/**
 * The row under a message that opens its thread: who replied, "N replies", the
 * last reply's time, and "1 new" when there is. The same row under a message
 * and under a huddle, drawn once (UIG-25: HuddleCard had typed a copy).
 * @registry reusable: stays in Peek (Katerina, 24 September, UIG-25)
 */
export function RepliesRow({
  replyCount,
  replyAuthors,
  lastReplyTime,
  hasNewReply = false,
  isUrgent = false,
}: {
  replyCount: number
  replyAuthors?: { name: string; avatarSrc?: string }[]
  lastReplyTime?: string
  hasNewReply?: boolean
  /** The "1 new" chip in the warning colour, for an urgent thread. */
  isUrgent?: boolean
}) {
  const avatarSrcFor = useAvatarSrc()
  return (
    <div className="flex items-center gap-2 pl-8 pr-2 pb-1.5 w-full">
      <div className="group/replies flex items-center gap-2 py-1.5 shrink-0 signal:px-2 signal:rounded-lg signal:border signal:border-transparent signal:hover:border-accent-outline signal:hover:bg-accent-wash signal:transition-colors">
        {replyAuthors && replyAuthors.length > 0 && (
          /* The shared stack at 18px (2026-09-03). This row hand-rolled
             its own for want of a size prop, and drifted while it did:
             four faces where the shared rule is three, and its own ring.
             The picture chain is Peek's Avatar wrapper's, kept exactly —
             the message's own face, else the registry's for that name. */
          <div className="hidden signal:flex items-center shrink-0">
            <AvatarGroup
              size={18}
              members={replyAuthors.map((a) => ({ name: a.name, picture: a.avatarSrc ?? avatarSrcFor(a.name) }))}
            />
          </div>
        )}
        <IconMessage2
          size={16}
          stroke={1.5}
          className={cn(
            'text-text-secondary group-hover/replies:text-text-primary transition-colors shrink-0 signal:text-text-interactive signal:group-hover/replies:text-text-primary',
            replyAuthors && replyAuthors.length > 0 && 'signal:hidden'
          )}
        />
        <span className="text-chip text-text-secondary group-hover/replies:text-text-primary transition-colors signal:font-medium signal:text-text-interactive signal:group-hover/replies:text-text-primary">
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
        </span>
        {lastReplyTime && (
          <span className="hidden signal:inline font-mono text-small leading-3 mt-px text-text-muted tabular-nums">
            {lastReplyTime}
          </span>
        )}
        <IconChevronRight
          size={12}
          stroke={2}
          className="hidden signal:block text-text-muted group-hover/replies:text-text-primary transition-all group-hover/replies:translate-x-0.5"
        />
      </div>
      {hasNewReply && !isUrgent && (
        <>
          <div className="w-0.5 h-0.5 rounded-full bg-text-muted shrink-0" />
          <Chip type="brand" label="1 new" />
        </>
      )}
      {hasNewReply && isUrgent && (
        <>
          <div className="w-0.5 h-0.5 rounded-full bg-text-muted shrink-0" />
          <Chip type="warning" label="1 new" />
        </>
      )}
    </div>
  )
}
