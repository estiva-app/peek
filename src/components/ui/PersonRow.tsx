import { useState } from 'react'
import { IconDotsVertical, IconAlertSquareRounded, IconX } from '@tabler/icons-react'
import { TopicState, type TopicStateType, type TopicStateStatus } from './TopicState'
import { IconButton } from './IconButton'
import { TopicMoreMenu } from './TopicMoreMenu'
import { cn } from '@/lib/utils'
import { useAvatarSrc } from '@/api'

interface PersonRowProps {
  name: string
  type?: TopicStateType
  topicStatus?: TopicStateStatus
  isUnread?: boolean
  isUrgent?: boolean
  isSelected?: boolean
  avatarSrc?: string
  memberCount?: number
  onClick?: () => void
  /** When provided, replaces the hover "more options" 3-dot icon with an X
   *  that calls this handler. Used by Open work rows so users can remove an
   *  item from the list. */
  onRemove?: () => void
  /** When provided, the hover 3-dot opens a more-menu with a destructive
   *  "Delete topic" item calling this handler (topic-list rows, QA #2.8).
   *  Without it the 3-dot stays inert, exactly as before. */
  onDeleteTopic?: () => void
  /** Adds "Topic details" to the more-menu (PEE-2). The same item the
   *  conversation header offers — one menu, two places to open it. */
  onOpenDetails?: () => void
  /** Adds an "Add to Open work" / "Remove from Open work" item to the
   *  more-menu — the label advertises which direction will succeed. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  className?: string
}

export function PersonRow({
  name,
  type = 'topic',
  topicStatus = 'unresolved',
  isUnread = false,
  isUrgent = false,
  isSelected = false,
  avatarSrc,
  memberCount,
  onClick,
  onRemove,
  onDeleteTopic,
  onOpenDetails,
  openWorkAction,
  onToggleOpenWork,
  className,
}: PersonRowProps) {
  const hasMenu = !!onDeleteTopic || !!onOpenDetails || !!(openWorkAction && onToggleOpenWork)
  const [isHovered, setIsHovered] = useState(false)
  // More-menu (portalled — the sidebar scroll container clips overflow).
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  // Resolve DM avatars through the registry (uploaded > seeded portrait >
  // silhouette) — the static avatarFor never sees real users' uploads.
  const avatarSrcFor = useAvatarSrc()

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!hasMenu) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // Right-anchored to the 3-dot: the content-sized menu grows leftward,
    // so long labels never truncate or run off-screen.
    setMenuPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) })
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 h-[32px] rounded-lg cursor-pointer transition-colors',
        isSelected ? 'bg-bg-selected' : isHovered || menuPos ? 'bg-bg-hover' : '',
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <TopicState
        type={type}
        status={type === 'topic' ? topicStatus : 'default'}
        avatarSrc={avatarSrc ?? (type === 'DM' ? avatarSrcFor(name) : undefined)}
        memberCount={memberCount}
        iconClassName={isSelected || isUnread ? 'text-text-primary' : undefined}
      />

      <span
        className={cn(
          'flex-1 text-sm truncate',
          isUnread ? 'font-medium' : 'font-normal',
          isSelected || isUnread ? 'text-text-primary' : 'text-text-secondary'
        )}
      >
        {name}
      </span>

      {/* Right slot - rendered only when there's something to show, so the title
          can use the full row width when idle. Slight layout shift on hover is intentional. */}
      {isHovered || menuPos ? (
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          {onRemove ? (
            <IconButton
              tooltip="Remove from list"
              aria-label="Remove from list"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="-m-1"
            >
              <IconX size={16} stroke={1.5} />
            </IconButton>
          ) : (
            <IconButton
              tooltip="More options"
              aria-label="More options"
              onClick={openMenu}
              className="-m-1"
            >
              <IconDotsVertical size={16} stroke={1.5} />
            </IconButton>
          )}
        </div>
      ) : isUrgent && isUnread ? (
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-[shadow:0_0_5px_rgba(255,176,32,0.4)]">
            <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
          </div>
        </div>
      ) : isUnread ? (
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
        </div>
      ) : null}

      {menuPos && hasMenu && (
        <TopicMoreMenu
          position={menuPos}
          onClose={() => setMenuPos(null)}
          onOpenDetails={onOpenDetails}
          openWorkAction={openWorkAction}
          onToggleOpenWork={onToggleOpenWork}
          onDeleteTopic={onDeleteTopic}
        />
      )}
    </div>
  )
}
