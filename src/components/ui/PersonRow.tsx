import { useState } from 'react'
import { IconBell, IconDotsVertical, IconAlertSquareRounded, IconX } from '@tabler/icons-react'
import { TopicState, type TopicStateType, type TopicStateStatus } from './TopicState'
import { IconButton } from './IconButton'
import { TopicMoreMenu } from './TopicMoreMenu'
import { UnreadDot } from './UnreadDot'
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
   *  "Delete" item calling this handler (topic-list rows, QA #2.8).
   *  Without it the 3-dot stays inert, exactly as before. */
  onDeleteTopic?: () => void
  /** Adds "Details" to the more-menu (PEE-2). The same item the
   *  conversation header offers — one menu, two places to open it. */
  onOpenDetails?: () => void
  /** Adds "Rename" to the more-menu (FOL-33) — a bare-file row whose manifest
   *  declares one. See `TopicMoreMenu`. */
  onRename?: () => void
  /** Adds "New topic inside" and "Move…" (FOL-4). See `TopicMoreMenu`. */
  onNewSubTopic?: () => void
  onMove?: () => void
  /** Adds an "Add to Open work" / "Remove from Open work" item to the
   *  more-menu — the label advertises which direction will succeed. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  /** Adds "Join" / "Leave" to the more-menu (SPEC §11.8), and marks a row
   *  its person is told about when idle — the state is visible without
   *  hovering, because a joined-and-read row and one the person is not part
   *  of would otherwise look the same, and only the first will ever light. */
  memberAction?: 'join' | 'leave'
  onToggleMember?: () => void
  /** Adds "Hide conversation" to the more-menu (DMS-6) — DM rows whose hide
   *  can succeed. The same item the conversation header offers. */
  onHideDm?: () => void
  /** Adds "Archive…" or "Unarchive" (FOL-46). See `TopicMoreMenu`. */
  archiveAction?: 'archive' | 'unarchive'
  onToggleArchive?: () => void
  className?: string
}

/**
 * One row in a side list, such as a topic, person, group, huddle or folder,
 * with its icon or photo, name, unread mark and a hover menu.
 */
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
  onRename,
  onNewSubTopic,
  onMove,
  openWorkAction,
  onToggleOpenWork,
  memberAction,
  onToggleMember,
  onHideDm,
  archiveAction,
  onToggleArchive,
  className,
}: PersonRowProps) {
  const hasMenu =
    !!(archiveAction && onToggleArchive) ||
    !!onDeleteTopic ||
    !!onOpenDetails ||
    !!onRename ||
    !!onNewSubTopic ||
    !!onMove ||
    !!onHideDm ||
    !!(openWorkAction && onToggleOpenWork) ||
    !!(memberAction && onToggleMember)
  const isTold = memberAction === 'leave'
  const [isHovered, setIsHovered] = useState(false)
  /* The menu owns its button since `@estiva-app/ui` 0.10.0, so what this file
     keeps is not a position any more — it is only whether the menu is open,
     because the row stays hovered and keeps its actions visible while it is.
     Portalled and right-aligned by the shared menu: the sidebar scroll
     container clips overflow, and a content-sized menu grows leftward so long
     labels never truncate. */
  const [menuOpen, setMenuOpen] = useState(false)
  // Resolve DM avatars through the registry (uploaded > seeded portrait >
  // silhouette) — the static avatarFor never sees real users' uploads.
  const avatarSrcFor = useAvatarSrc()

  /* The row itself is clickable, so the button still swallows the click that
     opens the menu. Base UI composes its own toggle onto this handler rather
     than replacing it, so both run. */
  const moreButton = (
    <IconButton
      tooltip="More options"
      aria-label="More options"
      onClick={(e) => e.stopPropagation()}
      className="-m-1"
    >
      <IconDotsVertical size={16} stroke={1.5} />
    </IconButton>
  )

  return (
    // @estiva-escape(no-copied-look, no-raw-element): N8 (Katerina, 24 September: record only): a row that fills on hover and opens on a click, as Checkbox's row also does
    <div
      className={cn(
        'flex items-center gap-2 px-2 h-[32px] rounded-lg cursor-pointer transition-colors',
        isSelected ? 'bg-bg-selected' : isHovered || menuOpen ? 'bg-bg-hover' : '',
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
          'flex-1 text-body-2 truncate',
          isUnread ? 'font-medium' : 'font-normal',
          isSelected || isUnread ? 'text-text-primary' : 'text-text-secondary'
        )}
      >
        {name}
      </span>

      {/* Right slot - rendered only when there's something to show, so the title
          can use the full row width when idle. Slight layout shift on hover is intentional. */}
      {isHovered || menuOpen ? (
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
          ) : hasMenu ? (
            <TopicMoreMenu
              trigger={moreButton}
              onOpenChange={setMenuOpen}
              onOpenDetails={onOpenDetails}
              onRename={onRename}
              onNewSubTopic={onNewSubTopic}
              onMove={onMove}
              openWorkAction={openWorkAction}
              onToggleOpenWork={onToggleOpenWork}
              memberAction={memberAction}
              onToggleMember={onToggleMember}
              onDeleteTopic={onDeleteTopic}
              onHideDm={onHideDm}
              archiveAction={archiveAction}
              onToggleArchive={onToggleArchive}
            />
          ) : (
            moreButton
          )}
        </div>
      ) : isUrgent && isUnread ? (
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-glow-warning">
            <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
          </div>
        </div>
      ) : isUnread ? (
        <UnreadDot />
      ) : isTold ? (
        /* A member and nothing new: the quiet mark that says this row can light
           (FOL-30, §11.8). Information, not an affordance — the toggle is in the menu. */
        <div className="w-6 h-6 flex items-center justify-center shrink-0" data-member>
          <IconBell size={12} stroke={1.5} className="text-text-muted" aria-label="Yours" />
        </div>
      ) : null}

    </div>
  )
}
