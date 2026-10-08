import { IconStar, IconStarFilled, IconDotsVertical, IconLockPlus, IconLock, IconFolderShare, IconLayoutSidebarRight, IconLayoutSidebarRightFilled } from '@tabler/icons-react'
import { TopicState } from './ui/TopicState'
import { Avatar } from './ui/Avatar'
import { TopicMoreMenu } from './ui/TopicMoreMenu'
import { IconButton } from './ui/IconButton'
import type { ReactNode } from 'react'
import { MembersPill, Panel, Toolbar, ToolbarButton, type PanelProps } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'
import { MetaText } from '@/components/ui/MetaText'

interface HeaderProps extends Partial<Pick<PanelProps, 'footer' | 'bodyRef' | 'onBodyScroll' | 'bodyClassName'>> {
  /** The conversation under the bar: the body of the column's `Panel`, which scrolls. */
  children?: ReactNode
  avatarSrc?: string
  name?: string
  /**
   * Which of the three this header is over. It was two booleans, `topicMode`
   * and `huddleMode`, which could both be true and said nothing about the
   * third case — a direct message was "neither" (Katerina's review, 22
   * September).
   *
   * - `topic` — the status icon, the open and resolved counts, the members pill
   * - `huddle` — a lock, no counts, the members pill, and no Start huddle
   * - `dm` — the other person's face, and nothing else
   */
  variant?: 'topic' | 'dm' | 'huddle'
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
  className?: string
}

/**
 * The column of an open topic, huddle or direct message: its bar — name, open
 * and resolved counts, members, a star and a more-actions menu — and the
 * conversation under it, in the package's `Panel`.
 */
export function Header({
  avatarSrc,
  name,
  variant = 'dm',
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
  className,
  children,
  footer,
  bodyRef,
  onBodyScroll,
  bodyClassName,
  folderId,
  onToggleFolderPanel,
  folderPanelOpen = false,
}: HeaderProps) {
  const avatarSrcFor = useAvatarSrc()

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
    <ToolbarButton tooltip="More actions" aria-label="More actions">
      <IconDotsVertical size={16} stroke={1.5} />
    </ToolbarButton>
  )

  // The package's Panel, so its bar is every other column's (Katerina, 8
  // October): its own row was 48px with the hairline under it, so 49px, its
  // line a pixel below People's and Replies', its title 20px in where theirs is 16px.
  return (
    <Panel
      className={className}
      footer={footer}
      bodyRef={bodyRef}
      onBodyScroll={onBodyScroll}
      bodyClassName={bodyClassName}
      title={
        <div className="flex items-center gap-2 overflow-hidden">
          {variant === 'huddle' ? (
            <IconLock size={16} stroke={1.5} className="text-text-secondary shrink-0" />
          ) : variant === 'topic' ? (
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
      }
      actions={
        <>
          {variant === 'topic' && !hideTopicMeta && (
            <>
              {/* Open / resolved counts */}
              <div className="flex items-center gap-2">
                <MetaText tone="secondary">
                  {openCount} open
                </MetaText>
                <div className="w-[3px] h-[3px] rounded-full bg-text-muted shrink-0" />
                <MetaText tone="success">
                  {resolvedCount} resolved
                </MetaText>
              </div>
            </>
          )}

          {/* Members pill — shown for both topic mode and huddle mode. In topic
              mode it opens the members dialog (huddle membership is set at
              creation, so the huddle pill stays inert). */}
          {variant !== 'dm' && !hideTopicMeta && members.length > 0 && (
            <MembersPill members={members.map((name) => ({ name, picture: avatarSrcFor(name) ?? undefined }))} onClick={onShowMembers} />
          )}

          {/* Start huddle (V2 / V3 only — driven by onStartHuddle prop). Hidden inside a huddle. */}
          {onStartHuddle && variant !== 'huddle' && (
            <IconButton
              tooltip="Start a huddle"
              aria-label="Start a huddle"
              onClick={onStartHuddle}
            >
              <IconLockPlus size={16} stroke={1.5} />
            </IconButton>
          )}

          {/* Action buttons — one strip: one Tab stop, arrows along it (the
              package Toolbar, no box of its own; UIG-14). */}
          <Toolbar aria-label="Conversation actions" surface={false}>
            <ToolbarButton
              tooltip={isStarred ? 'Remove from starred' : 'Add to starred'}
              aria-label={isStarred ? 'Remove from starred' : 'Add to starred'}
              onClick={onToggleStarred}
            >
              {isStarred ? (
                <IconStarFilled size={16} className="text-warning-default" />
              ) : (
                <IconStar size={16} stroke={1.5} />
              )}
            </ToolbarButton>
            {folderId && (
              <ToolbarButton
                tooltip="Copy Folder link — paste into another app to share this container"
                aria-label="Copy Folder link"
                onClick={copyFolderLink}
              >
                <IconFolderShare size={16} stroke={1.5} />
              </ToolbarButton>
            )}
            {onToggleFolderPanel && (
              <ToolbarButton
                tooltip={folderPanelOpen ? 'Hide Folder panel' : 'Show Folder panel'}
                aria-label={folderPanelOpen ? 'Hide Folder panel' : 'Show Folder panel'}
                onClick={onToggleFolderPanel}
              >
                {folderPanelOpen ? (
                  <IconLayoutSidebarRightFilled size={16} stroke={1.5} />
                ) : (
                  <IconLayoutSidebarRight size={16} stroke={1.5} />
                )}
              </ToolbarButton>
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
          </Toolbar>
        </>
      }
    >
      {children}
    </Panel>
  )
}
