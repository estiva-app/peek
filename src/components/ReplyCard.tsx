import { useState, useEffect, type ReactElement } from 'react'
import { AttachmentCard, Avatar, Card, Link, Menu, MenuItem, MenuSeparator, MenuSub, ToolbarButton } from '@estiva-app/ui'
import type { Embed } from '@estiva-app/protocol'
import { shareableMessageUrl } from '@/lib/objectUrl'
import {
  IconDotsVertical,
  IconX,
  IconAlertSquareRounded,
} from '@tabler/icons-react'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ConfirmDelete } from './ConfirmDelete'
import { Reaction as ReactionPill } from './ui/Reaction'
import { WithTooltip } from './ui/WithTooltip'
import { type ReactionData, type FileAttachment } from '@/api'
import { isCurrentUser } from '@/api'
import { EditBox, type EditSaved } from './ui/ConversationBox'
import { withoutCard } from '@estiva-app/conversation'
import { cn } from '@/lib/utils'
import { takeRefusedEdit, useRefusedEdit, type RefusedEdit } from '@/lib/refusedEdits'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'
import { HighlightPill, HighlightSwatch } from './ui/HighlightPill'
import { EditedMarker } from './ui/EditedMarker'
import { HIGHLIGHT_META, type HighlightType } from '@/api'
import type { ForeignObject } from '@estiva-app/interop'
import { MessageBody } from './ui/MessageBody'
import { UnreadDot } from './ui/UnreadDot'
import { MetaText } from '@/components/ui/MetaText'

// ── Reply More Menu ──

function ReplyMoreMenu({ trigger, onOpenChange, onEdit, onDelete, isOwnMessage = false, currentHighlight, onHighlight, className }: {
  /** The ⋯ button — the menu owns it, and portals, fits and exits itself. */
  trigger: ReactElement
  onOpenChange?: (open: boolean) => void
  onEdit?: () => void
  onDelete?: () => void
  /** The viewer wrote this reply. Edit and Delete show only then — PEE-32. */
  isOwnMessage?: boolean
  currentHighlight?: HighlightType
  onHighlight?: (type: HighlightType | undefined) => void
  className?: string
}) {
  return (
    <Menu trigger={trigger} align="right" onOpenChange={onOpenChange} className={cn('w-[180px] gap-2', className)}>
      <div className="flex flex-col">
        {/*
          Edit and Delete only on the viewer's own reply — PEE-32, the same rule
          as `ConversationMoreMenu` and its comment. Two menus, one rule: CON-3
          changed only one of them once, and a reply kept the behaviour a
          message had lost. Change both or neither.
        */}
        {isOwnMessage && <MenuItem label="Edit message" onClick={onEdit} />}
        {onHighlight && (
          /* The shared submenu (2026-09-03). This menu's hand-rolled copy is
             the one that dropped the ref its edge-flip measured — it measured
             nothing, always opened rightward, and shipped cut off by the
             screen edge. MenuSub portals and measures real rects. */
          <MenuSub label={currentHighlight ? 'Change highlight' : 'Mark as Highlight'}>
            {(['insight', 'concern', 'conclusion', 'question', 'summary'] as HighlightType[]).map((type) => (
              <MenuItem
                key={type}
                leading={<HighlightSwatch type={type} />}
                label={HIGHLIGHT_META[type].label}
                selected={currentHighlight === type}
                onClick={() => onHighlight(type)}
              />
            ))}
            {currentHighlight && (
              <>
                <MenuSeparator />
                <MenuItem
                  leading={<IconX size={16} stroke={1.5} className="text-text-secondary" />}
                  label="Remove"
                  onClick={() => onHighlight(undefined)}
                />
              </>
            )}
          </MenuSub>
        )}
      </div>
      {isOwnMessage && (
        <>
          <MenuSeparator />
          <MenuItem label="Delete" destructive onClick={onDelete} />
        </>
      )}
    </Menu>
  )
}

// ── ReplyCard ──

interface ReplyCardProps {
  authorName: string
  authorAvatarSrc?: string
  timestamp: string
  body: string
  /** When the body was last edited, ms — draws the marker (CON-8). */
  editedAt?: number
  /** Offer Edit and Delete (SPEC §6.5). Absent: only on the viewer's own ("You") message. */
  canEditAndDelete?: boolean
  reactions?: ReactionData[]
  highlightType?: HighlightType
  /** Figma frame ids attached to the reply (rendered as preview cards). */
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  isNew?: boolean
  isUrgent?: boolean
  onHighlightChange?: (type: HighlightType | undefined) => void
  onDelete?: () => void
  onBodyChange?: (newBody: string) => void
  /** The message's id: an edit of it the relay refused reopens this card's edit box with the saved text (OPT-8). */
  messageId?: string
  /** The reply's files after an edit added or removed some — PEE-16. The whole
   *  list, and only when this edit changed it. */
  onFilesChange?: (files: FileAttachment[]) => void
  /** The reply's card set after an edit changed it — OPT-17. */
  onEmbedsChange?: (embeds: Embed[]) => void
  /** The file whose conversation it is in: an edit linking that file adds no card (§13.6.2). */
  writtenOn?: string
  onReactionsChange?: (reactions: ReactionData[], emoji: string) => void
  /** True when this reply triggered the parent conv's resolution (compose `→ msg` in the
   *  thread panel). When set, edit mode surfaces the resolution as a resolutionBlock so
   *  the user can update or remove it inline. */
  ownsResolution?: boolean
  /** Current resolution message on the parent conv. Forwarded into the editor in edit mode. */
  resolutionMsg?: string
  /** Called on save when the editor's resolutionBlock changed:
   *  - resolved=true with new `message` → parent stays/becomes resolved with that message
   *  - resolved=false → parent reopens (user removed the resolution from the editor) */
  onResolutionChange?: (resolved: boolean, message?: string) => void
  nostrReferences?: string[]
  /** Whom the body names urgently, by pubkey — the event's `urgent` tags (SPEC §13.1, CON-24). */
  urgentMentions?: string[]
  /** The blocks of other objects the reply shows (SPEC §13.6.1, COM-2). */
  parts?: { address: string; block: string; anchor?: true }[]
  /** The cards its author asked for (SPEC §13.6.2). */
  embeds?: readonly Embed[]
  /** The published event's id. When present the timestamp becomes the
   *  message's permalink — see the render below (PEE-17). */
  nostrEventId?: string
  /** Which block of the referenced object this is about — SPEC §13.6. */
  nostrBlockId?: string
  /** Already-resolved reference objects, keyed by naddr (stories/tests — no relay). */
  resolvedObjects?: Record<string, ForeignObject>
  /** Show it with no way to change it: no hover menu, reactions not toggleable.
   *  A Convex topic's replies since CON-8. */
  readOnly?: boolean
  className?: string
}

/**
 * One reply in a conversation's thread: its author, time, text, files and
 * reactions, with a hover menu to react, edit, highlight or delete it.
 */
export function ReplyCard({
  authorName,
  authorAvatarSrc,
  timestamp,
  body,
  editedAt,
  canEditAndDelete,
  reactions,
  highlightType,
  files,
  isNew = false,
  isUrgent = false,
  onHighlightChange,
  onDelete,
  onBodyChange,
  messageId,
  onFilesChange,
  onEmbedsChange,
  writtenOn,
  onReactionsChange,
  ownsResolution = false,
  resolutionMsg,
  onResolutionChange,
  nostrReferences,
  urgentMentions,
  parts,
  embeds,
  nostrEventId,
  nostrBlockId,
  resolvedObjects,
  readOnly = false,
  className,
}: ReplyCardProps) {
  const messageLink = shareableMessageUrl(nostrEventId, window.location.origin)
  const [isHovered, setIsHovered] = useState(false)
  /* Not a rect since `@estiva-app/ui` 0.10.0 — the menu owns its button. Only
     whether it is open, which the card needs so the hover strip does not
     unmount from under an open menu. */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)


  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  // Sync local reactions state when the parent passes a new override (e.g. after navigation back).
  useEffect(() => { setReactionsState(reactions ?? []) }, [reactions])
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)
  // The picker is the quick menu's (§4.1, D30); the card only knows it is open.
  const [pickerOpen, setPickerOpen] = useState(false)

  const [bodyState, setBodyState] = useState(body)
  // Sync body from prop when it changes externally
  useEffect(() => { setBodyState(body) }, [body])
  useEffect(() => { setHighlightState(highlightType) }, [highlightType])
  // Edit mode: the shared box's edit form, a new box per opening (PEEKM-4, as ConversationCard).
  const [editing, setEditing] = useState<{ key: number; refused?: RefusedEdit } | null>(null)
  const isEditing = editing !== null

  const handleEditStart = (refused?: RefusedEdit) => setEditing((was) => ({ key: (was?.key ?? 0) + 1, refused }))

  // A refused edit: the old text is back, and the edit box reopens with what was saved and why (OPT-8, as ConversationCard).
  const refusedEdit = useRefusedEdit(messageId)
  useEffect(() => {
    if (refusedEdit === undefined || !messageId || !takeRefusedEdit(messageId)) return
    setBodyState(body)
    if (isEditing) return
    handleEditStart(refusedEdit)
  }, [refusedEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  // Saved: shown at once and handed on in one handler, so the text, files and cards go as one edit (`queueEdit`).
  const handleEditSave = (saved: EditSaved) => {
    if (saved.text !== undefined) {
      setBodyState(saved.text)
      onBodyChange?.(saved.text)
    }
    // Resolution changes flow up when this reply owns the parent's resolution, or now gives it one.
    const { hasResolution, resolutionMessage } = saved.resolution
    if (hasResolution && (!ownsResolution || resolutionMessage !== (resolutionMsg ?? ''))) onResolutionChange?.(true, resolutionMessage)
    else if (!hasResolution && ownsResolution) onResolutionChange?.(false, undefined)
    if (saved.highlightType !== highlightState) {
      setHighlightState(saved.highlightType)
      onHighlightChange?.(saved.highlightType)
    }
    if (saved.files) onFilesChange?.(saved.files)
    if (saved.embeds) onEmbedsChange?.(saved.embeds)
    setEditing(null)
  }

  // Edit and Delete only on the viewer's own message (SPEC §6.5, SHI-29)
  // when the seam says so; else the author label (PEE-32), as `ConversationCard` reads it.
  const isOwnMessage = canEditAndDelete ?? isCurrentUser(authorName)

  // Delete asks first (D56).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const handleDelete = () => setConfirmingDelete(true)

  const handleHighlightChange = (type: HighlightType | undefined) => {
    setHighlightState(type)
    onHighlightChange?.(type)
    setIsHovered(false)
  }

  const handleReact = (emoji: string) => {
    // Computed from the state in hand, not inside a state updater: React runs
    // updaters during render, and telling the parent from there set state in
    // another component mid-render — a warning on every reaction until
    // 2026-09-10 (PEEK-ADOPTION.md §11.5).
    const prev = reactionsState
    let next: ReactionData[]
    const existing = prev.find((r) => r.emoji === emoji && r.owner === 'yours')
    if (existing) {
      next = existing.count <= 1
        ? prev.filter((r) => r !== existing)
        : prev.map((r) => (r === existing
            ? { ...r, count: r.count - 1, owner: 'others' as const, names: r.names?.filter((n) => n !== 'You') }
            : r))
    } else {
      const othersExisting = prev.find((r) => r.emoji === emoji && r.owner === 'others')
      next = othersExisting
        ? prev.map((r) => (r === othersExisting
            ? { ...r, count: r.count + 1, owner: 'yours' as const, names: r.names && [...r.names, 'You'] }
            : r))
        : [...prev, { emoji, count: 1, owner: 'yours' as const, names: ['You'] }]
    }
    setReactionsState(next)
    onReactionsChange?.(next, emoji)
  }

  return (
    <>
      {/* The package's Card, as the conversation card draws it (UIG-27): `hovered`
          holds while this reply's menu or picker is open. */}
      <Card
        fill="surface"
        // Read-only: a reply opens nothing and offers nothing, so nothing on hover.
        hover={readOnly ? 'none' : 'fill'}
        quietUntilHover
        hovered={isHovered}
        active={isEditing}
        attention={isNew ? (isUrgent ? 'warning' : 'accent') : undefined}
        className={cn('relative', className)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (pickerOpen || moreMenuOpen) return
          setIsHovered(false)
        }}
      >
        {isEditing ? (
          <div className="p-2">
            <div className="flex items-start gap-2">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} className="shrink-0 mt-1" />
              <EditBox
                key={editing.key}
                kind="reply"
                message={{
                  body: bodyState,
                  urgent: urgentMentions,
                  highlightType: highlightState,
                  resolution: ownsResolution ? { message: resolutionMsg ?? '' } : undefined,
                  files,
                  embeds,
                }}
                refused={editing.refused}
                here={writtenOn}
                onSave={handleEditSave}
                onCancel={() => setEditing(null)}
                resolvedObjects={resolvedObjects}
                className="flex-1 min-w-0"
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start pt-2 px-2">
            <div className="flex items-center gap-2 w-full">
              <div className="flex items-center gap-2 shrink-0 flex-1 min-w-0">
                <Avatar size={24} src={authorAvatarSrc} alt={authorName} />
                <span className="text-body-2-strong text-text-primary min-w-0 truncate">{authorName}</span>
                {/*
                  The timestamp is the permalink — Slack's idea, and the reason
                  it is right here: there is no menu to find, and the browser's
                  own "Copy link address" already does the copying. A message
                  has no other affordance, and adding a fourth item to a menu
                  people open for other reasons would hide it.

                  A plain span when the message has no event id yet: a reply
                  exists locally the moment it is sent and gains its id only
                  when it reaches the relay, so an anchor there would point at
                  nothing. `shareableMessageUrl` answers null and this falls
                  back rather than rendering a dead link.
                */}
                {messageLink ? (
                  <WithTooltip label="Link to this message" wrapperClassName="shrink-0">
                    {/* The time's look on a box around the link, which takes it from there (UIG-9). */}
                    <MetaText className="contents">
                      <Link href={messageLink} variant="quiet" data-interactive>
                        {timestamp}
                      </Link>
                    </MetaText>
                  </WithTooltip>
                ) : (
                  <MetaText className="shrink-0">{timestamp}</MetaText>
                )}
                <EditedMarker editedAt={editedAt} />
                {highlightState && <HighlightPill type={highlightState} />}
              </div>
              {isNew && !isUrgent && <UnreadDot />}
              {isNew && isUrgent && (
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-glow-warning">
                    <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
                  </div>
                </div>
              )}
            </div>
            <div className="pl-8 pr-2 pt-1 pb-2 w-full overflow-hidden break-words">
              <MessageBody
                body={bodyState}
                nostrReferences={nostrReferences}
                nostrBlockId={nostrBlockId}
                resolvedObjects={resolvedObjects}
                urgentMentions={urgentMentions}
                parts={parts}
                embeds={embeds}
                authorName={authorName}
                // The author's ✕, offered where Edit is: an edit with that card `none` and every other kept (§13.6.2).
                onRemoveCard={isOwnMessage && !readOnly && onEmbedsChange ? (value) => onEmbedsChange(withoutCard(embeds, value)) : undefined}
              />
            </div>
            {/* `items-start` because the cards are not the same height: a file
                row is 48px and an image card is ~150, and stretching left a
                `.pdf` chip with its icon floating in a tall empty box. */}
            {files && files.length > 0 && (
              <div className="flex flex-wrap items-start gap-2 pl-8 pr-2 pb-2 w-full">
                {files.map((f, i) => (
                  <AttachmentCard key={`${f.sha256 ?? f.name}_${i}`} {...postedAttachment(f)} fetchImage={blobObjectUrl} download data-interactive />
                ))}
              </div>
            )}
            {reactionsState.length > 0 && (
              <div className="flex items-center gap-2 pl-8 pt-1 pb-2 w-full">
                {reactionsState.map((r, i) => (
                  <ReactionPill key={i} emoji={r.emoji} count={r.count} owner={r.owner} names={r.names} onClick={readOnly ? undefined : () => handleReact(r.emoji)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick menu — React and ⋯ only: the package Toolbar the message
            card uses, the third copy of its chrome gone (§4.2, F7). The menu
            owns its button; the picker is the strip's. */}
        {isHovered && !isEditing && !readOnly && (
          <ConversationQuickMenu
            className="absolute right-1 top-1"
            onReact={handleReact}
            onPickerOpenChange={setPickerOpen}
            more={
              <ReplyMoreMenu
                trigger={
                  <ToolbarButton tooltip="More actions" aria-label="More actions">
                    <IconDotsVertical size={16} stroke={1.5} />
                  </ToolbarButton>
                }
                onOpenChange={(next) => {
                  setMoreMenuOpen(next)
                  if (!next) setIsHovered(false)
                }}
                isOwnMessage={isOwnMessage}
                onEdit={isOwnMessage ? () => handleEditStart() : undefined}
                onDelete={isOwnMessage ? handleDelete : undefined}
                currentHighlight={highlightState}
                onHighlight={handleHighlightChange}
              />
            }
          />
        )}
      </Card>

      {confirmingDelete && (
        <ConfirmDelete what="reply" onConfirm={() => onDelete?.()} onClose={() => setConfirmingDelete(false)} />
      )}
    </>
  )
}
