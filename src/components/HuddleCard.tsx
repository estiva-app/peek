import { useState } from 'react'
import {
  IconMessage2,
  IconChevronRight,
  IconDotsVertical,
  IconLock,
  IconAlertSquareRounded,
  IconChecks,
  IconArrowNarrowRight,
} from '@tabler/icons-react'
import { Card, Menu, MenuItem, ToolbarButton } from '@estiva-app/ui'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ConfirmDelete } from './ConfirmDelete'
import { Avatar } from './ui/Avatar'
import { Chip } from './ui/Chip'
import { Divider } from './ui/Divider'
import { UnreadDot } from './ui/UnreadDot'
import { cn } from '@/lib/utils'
import { previewText } from '@/lib/textParsing'
import { useReplyCount, useReplyMeta, type Huddle } from '@/api'

interface HuddleCardProps {
  huddle: Huddle
  isSelected?: boolean
  /** 'grid' = legacy 2-col Huddles tab card (130px tall, 2-line preview).
   *  'inStream' = compact V3 inline card (1-line preview, private register, lock icon). */
  variant?: 'grid' | 'inStream'
  /** New activity in the huddle. Mirrors ConversationCard: pairs with isUrgent for the
   *  amber vs blue treatment. Notification chrome renders in the inStream variant only. */
  hasNewMessage?: boolean
  hasNewReply?: boolean
  isUrgent?: boolean
  onClick?: () => void
  onReply?: () => void
  onDelete?: () => void
  className?: string
}

export function MemberAvatars({
  members,
  count,
  borderClass,
}: {
  members?: string[]
  count?: number
  borderClass?: string
}) {
  // If names are provided, render up to 4 of them with photo lookup; otherwise
  // fall back to count-based placeholders for legacy callers.
  const slots = members ? members.slice(0, 4) : Array.from({ length: Math.min(count ?? 0, 4) }, () => undefined)
  return (
    <div className="flex items-center">
      {slots.map((name, i) => (
        <div
          key={i}
          className={cn(
            'relative shrink-0 size-6 rounded-sm overflow-hidden border-2',
            i > 0 && '-ml-2',
            borderClass ?? 'border-bg-surface'
          )}
        >
          <Avatar size={24} name={name} alt={name} />
        </div>
      ))}
    </div>
  )
}

export function HuddleCard({
  huddle,
  isSelected = false,
  variant = 'grid',
  hasNewMessage = false,
  hasNewReply = false,
  isUrgent = false,
  onClick,
  onReply,
  onDelete,
  className,
}: HuddleCardProps) {
  const inStream = variant === 'inStream'
  const isResolved = huddle.state === 'resolved'
  const [isHovered, setIsHovered] = useState(false)
  /* The ⋯ menu owns its button since `@estiva-app/ui` 0.10.0, so this is no
     longer a rect — only whether it is open, which the card still needs: an
     open menu must not let a click through to the card, and must not let the
     hover strip unmount from under itself. */
  const [menuOpen, setMenuOpen] = useState(false)

  // Grid keeps the legacy "first + N" truncation; inStream shows full comma-joined
  // names (the user-side label is "you and these other people").
  const gridMemberLabel =
    huddle.members.length <= 2
      ? huddle.members.join(', ')
      : `${huddle.members[0]} + ${huddle.members.length - 1}`
  const inStreamMemberLabel = huddle.members.join(', ')

  // Empty huddles (no seed conversation) show a placeholder preview.
  // Formatting markers are stripped — previews are plain snippets.
  const bodyText = previewText(huddle.conversation?.body ?? 'No messages yet')

  // Live reply count for the thread id the card opens (seedMessageId for
  // promoted huddles, conversation.id otherwise — same id useTopicView uses to
  // open the thread panel), so new replies typed in the thread panel increment
  // the card's count without needing a manual refresh.
  const replyCountOf = useReplyCount()
  const threadId = huddle.seedMessageId ?? huddle.conversation?.id
  const replyCount = replyCountOf(threadId, huddle.conversation?.replyCount ?? 0)

  // Reply-row facepile + last-reply time (signal theme). Mock mode derives
  // them live; the Convex row already carries the server-shaped fields.
  const replyMetaOf = useReplyMeta()
  const replyMeta = replyMetaOf(threadId)
  const replyAuthors = replyMeta.replyAuthors ?? huddle.conversation?.replyAuthors
  const lastReplyTime = replyMeta.lastReplyTime ?? huddle.conversation?.lastReplyTime

  // Delete asks first (D56).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const handleDelete = () => setConfirmingDelete(true)

  // Single-line preview body for the inStream variant — strip newlines so the
  // truncate happens cleanly at the card's right edge.
  const flatBody = bodyText.replace(/\n+/g, ' ').trim()

  return (
    <>
      {/*
        The package's Card (UIG-27). Color register: huddles use the surface fill
        for the body — same tier as ConversationCard so they sit at the same level
        on the page. The bg-inset banner above (same surface tier as the ComposeBox
        container) does the visual differentiation: a labeled inset/recessed strip
        in light mode, a lighter strip in dark mode. It lights up when pointed at,
        and `hovered` holds while its menu is open. Selected is the conversation
        card's selected, softer hairline included (Katerina, 2026-09-15); only
        the stream's huddle carries notification chrome, as before.
      */}
      <Card
        fill="surface"
        hover="fill"
        hovered={isHovered}
        selected={isSelected}
        attention={inStream && (hasNewMessage || hasNewReply) ? (isUrgent ? 'warning' : 'accent') : undefined}
        className={cn('relative flex flex-col overflow-hidden', inStream ? '' : 'h-[130px]', className)}
        onClick={(e) => {
          if (menuOpen) return
          const target = e.target as HTMLElement
          if (target.closest('button, [role="button"], [data-interactive]')) return
          onClick?.()
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (menuOpen) return
          setIsHovered(false)
        }}
      >
        {/* "Huddle" top banner — V3 inStream only. A neutral elevated-grey strip
            (lighter than the body's bg-private), edge-to-edge so the parent's
            rounded-lg + overflow-hidden give it rounded top corners. Differentiates
            the card in V3's mixed stream where huddles and conversation cards appear
            side by side. */}
        {inStream && (
          <div className="h-6 bg-bg-inset px-2 flex items-center shrink-0">
            <span className="text-caption text-text-primary leading-none">Huddle</span>
          </div>
        )}

        {/* Body wrapper — owns padding (so the banner can fill edge-to-edge) and is the
            positioning parent for the hover-menu absolute overlay. When the inStream
            reply footer renders we drop the wrapper's bottom padding so the footer's
            own pb-1.5 owns the bottom spacing exactly like ConversationCard does. */}
        <div className={cn(
          'relative flex flex-col px-2 pt-2',
          inStream ? 'gap-1' : 'flex-1',
          // A trailing reply footer or resolution banner owns the bottom padding.
          inStream && (replyCount > 0 || isResolved) ? '' : 'pb-2',
        )}>
        {/* Header. inStream uses a single 24px lock-avatar (purple square with lock icon)
            instead of overlapping member avatars — communicates "this is a huddle" with
            one icon and clusters [avatar + names + timestamp] together like ConversationCard.
            grid keeps the legacy member-avatars + first-only name preview. */}
        <div className="flex items-center gap-2">
          {inStream ? (
            <div className="size-6 rounded-sm bg-bg-inset flex items-center justify-center shrink-0">
              <IconLock size={16} stroke={1.5} className="text-text-primary" />
            </div>
          ) : (
            <MemberAvatars
              members={huddle.members}
              borderClass={
                isSelected ? 'border-bg-selected' : isHovered ? 'border-bg-hover' : 'border-bg-surface'
              }
            />
          )}
          {/* tw-merge silently drops `text-body-2-strong` when followed by `text-text-primary`
              inside a cn() call (both share the `text-` prefix). Explicit arbitrary values
              preserve the body-2-strong styling: 14px / 140% line-height / weight 500. */}
          <span className={cn(
            'text-body-2-strong text-text-primary truncate',
            // inStream: shrink so the timestamp can sit immediately after the names.
            // grid: take remaining flex width so the timestamp stays at the right edge.
            inStream ? 'min-w-0' : 'flex-1'
          )}>
            {inStream ? inStreamMemberLabel : gridMemberLabel}
          </span>
          <span className="text-caption text-text-muted whitespace-nowrap shrink-0 signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">
            {inStream
              ? (huddle.conversation?.timestamp ?? huddle.lastActivity)
              : huddle.conversation
                ? `${huddle.lastActivity}, ${huddle.conversation.timestamp}`
                : huddle.lastActivity}
          </span>
          {inStream && hasNewMessage && !isUrgent && <UnreadDot className="ml-auto" />}
          {inStream && hasNewMessage && isUrgent && (
            <div className="w-6 h-6 flex items-center justify-center shrink-0 ml-auto">
              <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-glow-warning">
                <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
              </div>
            </div>
          )}
        </div>

        {/* Body preview — 1 line in inStream, 2 lines in grid. inStream's body is
            indented with pl-8 to align under the names (matches ConversationCard's
            body which uses pl-8 to sit under the author name). */}
        {inStream ? (
          <p className="pl-8 text-caption leading-snug text-text-secondary truncate">
            {flatBody}
          </p>
        ) : (
          <div className="pt-1 flex-1 min-h-0 overflow-hidden">
            <p className="text-caption leading-snug text-text-secondary line-clamp-2">
              {bodyText.split('\n').filter(Boolean).map((line, i) => {
                const cleaned = line.replace(/^[-•]\s/, '• ').replace(/^\d+\.\s/, (m) => m)
                return (
                  <span key={i}>
                    {i > 0 && <br />}
                    {cleaned}
                  </span>
                )
              })}
            </p>
          </div>
        )}

        {/* Reply-count footer.
            grid: compact 14px icon + caption text, hugs the bottom of the card.
            inStream: matches ConversationCard's footer exactly (16px icon, text-chip,
            pl-8 pr-2 pb-1.5) so huddles and conversations sitting side by side in
            V3's mixed stream share the same reply-count chrome. */}
        {!inStream && replyCount > 0 && (
          <div className="flex items-center gap-2 text-text-secondary h-6 signal:text-text-interactive">
            <IconMessage2 size={14} stroke={1.5} className="shrink-0" />
            <span className="text-caption signal:font-medium">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          </div>
        )}
        {inStream && replyCount > 0 && (
          <div className="flex items-center gap-2 pl-8 pr-2 pb-1.5 w-full">
            <div className="group/replies flex items-center gap-2 py-1.5 shrink-0 signal:px-2 signal:rounded-lg signal:border signal:border-transparent signal:hover:border-accent-outline signal:hover:bg-accent-wash signal:transition-colors">
              {replyAuthors && replyAuthors.length > 0 && (
                <div className="hidden signal:flex items-center shrink-0">
                  {replyAuthors.slice(0, 4).map((a, i) => (
                    <Avatar
                      key={a.name}
                      size={18}
                      src={a.avatarSrc}
                      alt={a.name}
                      className={cn('ring-[1.5px] ring-bg-surface', i > 0 && '-ml-1.5')}
                    />
                  ))}
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
        )}

        {/* Resolution banner — inStream resolved huddles, mirrors ConversationCard's banner. */}
        {inStream && isResolved && (
          <div className="flex items-center gap-2 pl-8 pr-2 pb-2 pt-1">
            <IconChecks size={16} stroke={1.5} className="text-success-default shrink-0" />
            <span className="text-h5 text-success-default whitespace-nowrap">
              {huddle.conversation?.resolvedBy || 'Someone'} resolved
            </span>
            {huddle.conversation?.resolutionMessage && (
              <>
                <IconArrowNarrowRight size={12} stroke={1.5} className="text-text-primary shrink-0" />
                <span className="text-h5 text-text-primary truncate">{huddle.conversation.resolutionMessage}</span>
              </>
            )}
          </div>
        )}

        {/* Quick menu on hover — the package Toolbar the message card uses,
            the second copy of its chrome gone (§4.2, F7). The menu owns its
            button; the card is clickable, so the button still swallows its
            own click — Base UI composes its toggle onto that. */}
        {isHovered && (
          <div className="absolute right-[3px] top-[3px]" onClick={(e) => e.stopPropagation()}>
            <ConversationQuickMenu
              onReply={() => { onReply?.(); onClick?.() }}
              more={
              <Menu
                trigger={
                  <ToolbarButton
                    tooltip="More actions"
                    aria-label="More actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconDotsVertical size={16} stroke={1.5} />
                  </ToolbarButton>
                }
                align="right"
                onOpenChange={(next) => {
                  setMenuOpen(next)
                  if (!next) setIsHovered(false)
                }}
                className="w-[244px] gap-2"
              >
                {/* "View details" has no handler and never had one — an inert
                    control, COMPONENTS-PEEK F3, not something to change while
                    porting. */}
                <MenuItem label="View details" />
                <Divider className="mx-0" />
                <MenuItem label="Delete" destructive onClick={handleDelete} />
              </Menu>
              }
            />
          </div>
        )}
        </div>
      </Card>
      {confirmingDelete && (
        <ConfirmDelete what="huddle" onConfirm={() => onDelete?.()} onClose={() => setConfirmingDelete(false)} />
      )}
    </>
  )
}
