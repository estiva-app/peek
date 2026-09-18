import type { ReactNode } from 'react'
import { IconStar, IconStarFilled, IconDotsVertical, IconLockPlus, IconLock, IconFolderShare, IconLayoutSidebarRight, IconLayoutSidebarRightFilled } from '@tabler/icons-react'
import { TopicState } from './ui/TopicState'
import { Avatar } from './ui/Avatar'
import { TopicMoreMenu } from './ui/TopicMoreMenu'
import { MembersPill } from './ui/MembersPill'
import { IconButton } from './ui/IconButton'
import { cn } from '@/lib/utils'

interface ConversationHeaderProps {
  avatarSrc?: string
  name?: string
  /** When true, shows topic-mode layout: TopicState icon, status counts, members */
  topicMode?: boolean
  /** V2 huddle main-view header: lock icon on the left, no open/resolved counts. Members pill still
   *  shows when `members` is provided. Pairs with `name` carrying the comma-joined member names. */
  huddleMode?: boolean
  isResolved?: boolean
  openCount?: number
  resolvedCount?: number
  /** Hide counts and members pill (e.g. when Huddles tab is active) */
  hideTopicMeta?: boolean
  /** Topic participants — drives the avatars + count in the members pill */
  members?: string[]
  isStarred?: boolean
  onToggleStarred?: () => void
  /** When provided, renders a "Start a huddle" icon button next to the members pill. */
  onStartHuddle?: () => void
  /** When provided (topic mode), clicking the members pill opens the members
   *  dialog (rendered by the view that owns the data). */
  onShowMembers?: () => void
  /**
   * This topic's Folder id — the NIP-29 channel every event here carries as `h`.
   *
   * Present only when the topic exists on the relay. Shown so it can be pasted
   * into another app: the same Folder holds this topic's messages and, say, a
   * tracker's issues, each app projecting the one container its own way.
   */
  folderId?: string | null
  /**
   * Show/hide the Folder panel (PEEK-24).
   *
   * Next to the Folder link on purpose: both are about the container this topic
   * shares with other apps, rather than about the conversation. Absent where
   * there is no panel to toggle, so the button never appears somewhere it
   * cannot do anything.
   */
  onToggleFolderPanel?: () => void
  folderPanelOpen?: boolean
  /** When provided, "More actions" opens a menu with an Add/Remove Open work
   *  item — the label advertises which direction will succeed. Without it the
   *  3-dot stays inert, exactly as before. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  /** Opens the topic details dialog (PEE-2) — the same menu item the sidebar
   *  row offers, so a topic reads the same from either end. */
  onOpenDetails?: () => void
  /**
   * The topic's shareable URL, or null when it has none.
   *
   * Built by the caller rather than here: only the view holds the channel uuid
   * and the title, and `shareableTopicUrl` answers null for a topic whose only
   * link is Peek-private (PEE-17).
   */
  topicLink?: string | null
  /** Deleting used to be reachable from the sidebar row only, so a topic could
   *  be deleted from the list but not from inside itself. One menu, both
   *  places (PEE-2). */
  onDeleteTopic?: () => void
  /** Hide this DM from the viewer's sidebar (DMS-6) — see `TopicMoreMenu`. */
  onHideDm?: () => void
  tabs?: ReactNode
  className?: string
}

export function ConversationHeader({
  avatarSrc,
  name,
  topicMode = false,
  huddleMode = false,
  isResolved = false,
  openCount = 0,
  resolvedCount = 0,
  hideTopicMeta = false,
  members = [],
  isStarred = false,
  onToggleStarred,
  onStartHuddle,
  onShowMembers,
  openWorkAction,
  onToggleOpenWork,
  onOpenDetails,
  topicLink,
  onDeleteTopic,
  onHideDm,
  tabs,
  className,
  folderId,
  onToggleFolderPanel,
  folderPanelOpen = false,
}: ConversationHeaderProps) {
  const copyFolderLink = () => {
    // `folder:<uuid>`, not a URL. A Folder belongs to no single app, so a link
    // pointing at Peek would misdescribe a container Peek merely shares.
    const link = `folder:${folderId}`
    void navigator.clipboard?.writeText(link).catch(() => window.prompt('Copy this Folder link:', link))
  }

  const copyTopicLink = topicLink
    ? () => {
        void navigator.clipboard
          ?.writeText(topicLink)
          .catch(() => window.prompt('Copy this link:', topicLink))
      }
    : undefined

  const hasMoreMenu =
    !!onOpenDetails || !!onDeleteTopic || !!onHideDm || !!copyTopicLink || !!(openWorkAction && onToggleOpenWork)

  /* The menu owns this button since `@estiva-app/ui` 0.10.0, so the open
     state, the rect measurement and the toggle are all gone from this file.
     When a topic has no menu actions the button is still drawn and still does
     nothing, exactly as before — an inert control, COMPONENTS-PEEK F3, not
     something to change while porting. */
  const moreButton = (
    <IconButton tooltip="More actions" aria-label="More actions">
      <IconDotsVertical size={16} stroke={1.5} />
    </IconButton>
  )

  return (
    <div className={cn('shrink-0 border-b border-border-subtle', className)}>
      {/* Row 1: title + actions */}
      <div className="h-12 flex items-center justify-between pl-5 pr-4 py-2">
        {/* Left */}
        <div className="flex items-center gap-2 overflow-hidden">
          {huddleMode ? (
            <IconLock size={16} stroke={1.5} className="text-text-secondary shrink-0" />
          ) : topicMode ? (
            <TopicState
              type="topic"
              status={isResolved ? 'resolved' : 'unresolved'}
              iconClassName="text-text-secondary"
            />
          ) : (
            <Avatar size={16} src={avatarSrc} alt={name} />
          )}
          {name && (
            <span className="text-body-2-strong text-text-primary truncate">{name}</span>
          )}
        </div>

        {/* Right */}
        <div className="flex gap-3 items-center shrink-0">
          {topicMode && !hideTopicMeta && !huddleMode && (
            <>
              {/* Open / resolved counts */}
              <div className="flex items-center gap-2">
                <span className="text-caption text-text-secondary whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">
                  {openCount} open
                </span>
                <div className="w-[3px] h-[3px] rounded-full bg-text-muted shrink-0" />
                <span className="text-caption text-success-default whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">
                  {resolvedCount} resolved
                </span>
              </div>
            </>
          )}

          {/* Members pill — shown for both topic mode and huddle mode. In topic
              mode it opens the members dialog (huddle membership is set at
              creation, so the huddle pill stays inert). */}
          {(topicMode || huddleMode) && !hideTopicMeta && members.length > 0 && (
            <MembersPill members={members} onClick={onShowMembers} />
          )}

          {/* Start huddle (V2 / V3 only — driven by onStartHuddle prop). Hidden inside a huddle. */}
          {onStartHuddle && !huddleMode && (
            <IconButton
              tooltip="Start a huddle"
              aria-label="Start a huddle"
              onClick={onStartHuddle}
            >
              <IconLockPlus size={16} stroke={1.5} />
            </IconButton>
          )}

          {/* Action buttons */}
          <div className="flex gap-1 items-center">
            <IconButton
              tooltip={isStarred ? 'Remove from starred' : 'Add to starred'}
              aria-label={isStarred ? 'Remove from starred' : 'Add to starred'}
              onClick={onToggleStarred}
            >
              {isStarred ? (
                <IconStarFilled size={16} className="text-warning-default" />
              ) : (
                <IconStar size={16} stroke={1.5} />
              )}
            </IconButton>
            {folderId && (
              <IconButton
                tooltip="Copy Folder link — paste into another app to share this container"
                aria-label="Copy Folder link"
                onClick={copyFolderLink}
              >
                <IconFolderShare size={16} stroke={1.5} />
              </IconButton>
            )}
            {onToggleFolderPanel && (
              <IconButton
                tooltip={folderPanelOpen ? 'Hide Folder panel' : 'Show Folder panel'}
                aria-label={folderPanelOpen ? 'Hide Folder panel' : 'Show Folder panel'}
                onClick={onToggleFolderPanel}
              >
                {folderPanelOpen ? (
                  <IconLayoutSidebarRightFilled size={16} stroke={1.5} />
                ) : (
                  <IconLayoutSidebarRight size={16} stroke={1.5} />
                )}
              </IconButton>
            )}
            {hasMoreMenu ? (
              <TopicMoreMenu
                trigger={moreButton}
                onOpenDetails={onOpenDetails}
                onCopyLink={copyTopicLink}
                openWorkAction={openWorkAction}
                onToggleOpenWork={onToggleOpenWork}
                onDeleteTopic={onDeleteTopic}
                onHideDm={onHideDm}
              />
            ) : (
              moreButton
            )}
          </div>
        </div>
      </div>

      {/* Row 2: tabs */}
      {tabs && (
        <div className="pl-5 pr-4 pb-2">
          {tabs}
        </div>
      )}
    </div>
  )
}
