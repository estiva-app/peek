import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { peekStarterKit } from '@/extensions/editorKit'
import { PeekMention, UrgentMention, TopicMention, FileMention, isSuggestionActive } from '@/extensions/mention'
import { ResolutionBlock, extractResolution, extractResolutionFromText } from '@/extensions/resolution'
import { HighlightTag, extractHighlightType } from '@/extensions/highlight'
import {
  IconMoodPlus,
  IconDotsVertical,
  IconPaperclip,
  IconSquareForbid2,
  IconChevronRight,
  IconX,
  IconAlertSquareRounded,
} from '@tabler/icons-react'
import figmaIcon from '@/assets/figma icon.svg'
import { FrameArt } from './ui/FrameArt'
import { FrameLightbox } from './FrameLightbox'
import { frameById, frameBreadcrumb, type FigmaFrame } from '@/api'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Avatar } from './ui/Avatar'
import ReactionPicker from './ReactionPicker'
import { Reaction as ReactionPill } from './ui/Reaction'
import { Divider } from './ui/Divider'
import { PEOPLE } from '@/api'
import { type ReactionData, type FileAttachment } from '@/api'
import { useIsTopicResolved } from '@/api'
import { FileAttachmentCard } from './ui/FileAttachmentCard'
import { cn } from '@/lib/utils'
import { HighlightPill, HighlightSwatch } from './ui/HighlightPill'
import { HIGHLIGHT_META, type HighlightType } from '@/api'
import { textToTiptapContent, serializeTiptapToText } from '@/lib/textParsing'
import { MessageBody } from './ui/MessageBody'

// ── Reply More Menu ──

function ReplyMoreMenu({ onEdit, onDelete, currentHighlight, onHighlight, isOwnMessage = false, className }: {
  onEdit?: () => void
  onDelete?: () => void
  currentHighlight?: HighlightType
  onHighlight?: (type: HighlightType | undefined) => void
  /** True when the reply was authored by "You" - gates Edit/Delete entries. */
  isOwnMessage?: boolean
  className?: string
}) {
  const [showHighlightSub, setShowHighlightSub] = useState(false)
  const [subOnLeft, setSubOnLeft] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const openSub = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setShowHighlightSub(true)
  }

  const closeSub = () => {
    closeTimer.current = setTimeout(() => setShowHighlightSub(false), 150)
  }

  // Measure whether the submenu fits to the right; if not, flip to left
  useEffect(() => {
    if (!showHighlightSub || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const subWidth = 160 + 8
    setSubOnLeft(rect.right + subWidth > window.innerWidth)
  }, [showHighlightSub])

  return (
    <div className={cn('bg-bg-elevated border border-border-default rounded-lg shadow-lg w-[180px] p-2 flex flex-col gap-2', className)}>
      <div className="flex flex-col">
        {isOwnMessage && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-hover w-full"
            onClick={onEdit}
          >
            <span className="flex-1 text-sm text-text-secondary signal:text-text-primary">Edit message</span>
          </div>
        )}
        {onHighlight && (
          <div className="relative">
            <div
              ref={triggerRef}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-hover w-full"
              onMouseEnter={openSub}
              onMouseLeave={closeSub}
            >
              <span className="flex-1 text-sm text-text-secondary signal:text-text-primary">
                {currentHighlight ? 'Change highlight' : 'Mark as Highlight'}
              </span>
              <IconChevronRight size={16} stroke={1.5} className="text-text-muted shrink-0" />
            </div>
            {showHighlightSub && (
              <div
                className={cn(
                  'absolute top-0 bg-bg-elevated border border-border-default rounded-lg shadow-lg w-[160px] p-2 z-50',
                  subOnLeft ? 'right-full mr-1' : 'left-full ml-1'
                )}
                onMouseEnter={openSub}
                onMouseLeave={closeSub}
              >
                {(['insight', 'concern', 'conclusion', 'question', 'summary'] as HighlightType[]).map((type) => (
                  <div
                    key={type}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-hover',
                      currentHighlight === type && 'bg-bg-hover'
                    )}
                    onClick={() => onHighlight(type)}
                  >
                    <HighlightSwatch type={type} />
                    <span className="text-sm text-text-secondary signal:text-text-primary">{HIGHLIGHT_META[type].label}</span>
                  </div>
                ))}
                {currentHighlight && (
                  <>
                    <div className="h-px bg-border-subtle mx-1 my-1" />
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-hover"
                      onClick={() => onHighlight(undefined)}
                    >
                      <IconX size={16} stroke={1.5} className="text-text-secondary shrink-0" />
                      <span className="text-sm text-text-secondary signal:text-text-primary">Remove</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {isOwnMessage && (
        <>
          <Divider className="mx-0" />
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-hover w-full"
            onClick={onDelete}
          >
            <span className="flex-1 text-sm text-error-default">Delete</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── ThreadReplyCard ──

interface ThreadReplyCardProps {
  authorName: string
  authorAvatarSrc?: string
  timestamp: string
  body: string
  reactions?: ReactionData[]
  highlightType?: HighlightType
  /** Figma frame ids attached to the reply (rendered as preview cards). */
  attachments?: string[]
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  isNew?: boolean
  isUrgent?: boolean
  onHighlightChange?: (type: HighlightType | undefined) => void
  onDelete?: () => void
  onBodyChange?: (newBody: string) => void
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
  className?: string
}

export function ThreadReplyCard({
  authorName,
  authorAvatarSrc,
  timestamp,
  body,
  reactions,
  highlightType,
  attachments,
  files,
  isNew = false,
  isUrgent = false,
  onHighlightChange,
  onDelete,
  onBodyChange,
  onReactionsChange,
  ownsResolution = false,
  resolutionMsg,
  onResolutionChange,
  nostrReferences,
  className,
}: ThreadReplyCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [moreMenuPos, setMoreMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLDivElement>(null)

  const isTopicResolved = useIsTopicResolved()

  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  // Sync local reactions state when the parent passes a new override (e.g. after navigation back).
  useEffect(() => { setReactionsState(reactions ?? []) }, [reactions])
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [reactionPickerPos, setReactionPickerPos] = useState<{ top: number; right: number } | null>(null)
  const reactButtonRef = useRef<HTMLDivElement>(null)
  const reactionPickerRef = useRef<HTMLDivElement>(null)

  const [bodyState, setBodyState] = useState(body)
  // Sync body from prop when it changes externally
  useEffect(() => { setBodyState(body) }, [body])
  useEffect(() => { setHighlightState(highlightType) }, [highlightType])
  const [isEditing, setIsEditing] = useState(false)
  const [previewFrame, setPreviewFrame] = useState<FigmaFrame | null>(null)
  const [editEmpty, setEditEmpty] = useState(false)
  const [editHasUrgent, setEditHasUrgent] = useState(false)
  const [editHasHighlight, setEditHasHighlight] = useState(false)

  const editSaveFnRef = useRef<() => void>(() => {})
  const editCancelFnRef = useRef<() => void>(() => {})
  const editEmptyRef = useRef(true)
  const editEditorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editEditor = useEditor({
    extensions: [
      peekStarterKit,
      PeekMention, UrgentMention, TopicMention, FileMention, ResolutionBlock, HighlightTag,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none w-full bg-transparent text-sm text-text-primary leading-[1.4] break-words min-h-[20px]',
        style: 'caret-color: var(--text-primary)',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          if (!editEmptyRef.current) editSaveFnRef.current()
          return true
        }
        if (event.key === 'Enter' && event.shiftKey) {
          const ed = editEditorRef.current
          if (!ed) return false
          const { $from } = view.state.selection
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              if ($from.node(d).textContent.length === 0) ed.commands.liftListItem('listItem')
              else ed.commands.splitListItem('listItem')
              return true
            }
          }
          ed.commands.splitBlock()
          return true
        }
        if (event.key === 'Escape') { editCancelFnRef.current(); return true }
        return false
      },
    },
    content: '',
    autofocus: false,
    onUpdate({ editor }) {
      const doc = editor.state.doc
      let hasNonParagraph = false
      let hasAtomNode = false
      doc.forEach((node) => { if (node.type.name !== 'paragraph') hasNonParagraph = true })
      doc.descendants((node) => { if (node.isAtom && node.type.name !== 'paragraph') hasAtomNode = true })
      const empty = doc.textContent.length === 0 && !hasNonParagraph && !hasAtomNode
      setEditEmpty(empty)
      editEmptyRef.current = empty
      if (empty && doc.childCount > 1) {
        requestAnimationFrame(() => { editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }) })
      }
      let urgent = false
      let highlight = false
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'urgentMention') urgent = true
        if (node.type.name === 'highlightTag') highlight = true
      })
      setEditHasUrgent(urgent)
      setEditHasHighlight(highlight)
    },
  })

  editEditorRef.current = editEditor

  useEffect(() => {
    if (!editEditor) return
    if (isEditing) {
      const content = textToTiptapContent(bodyState)
      // If message has a highlight, prepend the tag to the first paragraph
      if (highlightState && content.content && content.content.length > 0) {
        const first = content.content[0]
        if (first.type === 'paragraph') {
          const existing = (first.content ?? []) as Record<string, unknown>[]
          first.content = [
            { type: 'highlightTag', attrs: { highlightType: highlightState } },
            { type: 'text', text: ' ' },
            ...existing,
          ]
        }
      }
      // If this reply triggered the parent's resolution, append the resolution as a
      // resolutionBlock so the user can edit or remove it inline. Removing the block
      // on save reopens the parent (handled in handleEditSave below).
      if (ownsResolution) {
        const resolutionText = resolutionMsg ? `→ ${resolutionMsg}` : '→ '
        content.content.push({
          type: 'resolutionBlock',
          content: [{ type: 'text', text: resolutionText }],
        })
      }
      editEditor.commands.setContent(content)
      setTimeout(() => editEditor.commands.focus('end'), 0)
    } else {
      editEditor.commands.clearContent()
    }
  }, [isEditing, editEditor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showMoreMenu) return
    const close = (e: MouseEvent) => {
      if (moreMenuRef.current?.contains(e.target as Node)) return
      setShowMoreMenu(false)
      setMoreMenuPos(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showMoreMenu])

  const handleMore = () => {
    if (showMoreMenu) { setShowMoreMenu(false); setMoreMenuPos(null); return }
    const el = moreButtonRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    if (window.innerHeight - rect.bottom < 200) {
      setMoreMenuPos({ bottom: window.innerHeight - rect.top + 4, right })
    } else {
      setMoreMenuPos({ top: rect.bottom + 4, right })
    }
    setShowMoreMenu(true)
  }

  const handleEditStart = () => { setIsEditing(true); setShowMoreMenu(false) }

  const handleEditSave = () => {
    if (!editEditor) return
    const trimmed = serializeTiptapToText(editEditor)
    let resolution = extractResolution(editEditor)
    let finalBody = trimmed

    // Fallback for a start-of-line "-> msg" the InputRule didn't catch
    // (mid-line arrows are prose — ruling 2026-07-23).
    if (!resolution.hasResolution) {
      const fromText = extractResolutionFromText(trimmed)
      if (fromText) {
        finalBody = fromText.body
        resolution = { hasResolution: true, resolutionMessage: fromText.resolutionMessage }
      }
    }

    if (finalBody) {
      setBodyState(finalBody)
      onBodyChange?.(finalBody)
    }
    // Resolution changes only flow up when this reply owns the parent's resolution.
    if (ownsResolution || resolution.hasResolution) {
      if (resolution.hasResolution) {
        onResolutionChange?.(true, resolution.resolutionMessage)
      } else if (ownsResolution) {
        // Was the resolution-owner, no resolution block left → user removed it, reopen.
        onResolutionChange?.(false, undefined)
      }
    }
    // Preserve highlight type from edit
    const hl = extractHighlightType(editEditor)
    setHighlightState(hl)
    onHighlightChange?.(hl)
    setIsEditing(false)
  }

  const handleEditCancel = () => setIsEditing(false)

  editSaveFnRef.current = handleEditSave
  editCancelFnRef.current = handleEditCancel

  const handleDelete = () => { setShowMoreMenu(false); onDelete?.() }

  const handleHighlightChange = (type: HighlightType | undefined) => {
    setHighlightState(type)
    onHighlightChange?.(type)
    setShowMoreMenu(false)
    setMoreMenuPos(null)
    setIsHovered(false)
  }

  const openReactionPicker = () => {
    if (showReactionPicker) {
      setShowReactionPicker(false)
      setReactionPickerPos(null)
      return
    }
    const btn = reactButtonRef.current?.getBoundingClientRect()
    if (btn) {
      setReactionPickerPos({ top: btn.top - 4, right: window.innerWidth - btn.right })
      setShowReactionPicker(true)
    }
  }

  // Close reaction picker on outside click
  useEffect(() => {
    if (!showReactionPicker) return
    const close = (e: MouseEvent) => {
      if (reactionPickerRef.current?.contains(e.target as Node)) return
      if (reactButtonRef.current?.contains(e.target as Node)) return
      setShowReactionPicker(false)
      setReactionPickerPos(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showReactionPicker])

  const handleReact = (emoji: string) => {
    setReactionsState((prev) => {
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
      onReactionsChange?.(next, emoji)
      return next
    })
    setShowReactionPicker(false)
  }

  return (
    <>
      <div
        className={cn(
          'relative rounded-lg transition-colors border',
          isEditing
            ? 'bg-bg-selected border-accent-primary'
            : cn(
                isHovered ? 'bg-bg-hover' : 'bg-bg-surface',
                isNew
                  ? isUrgent
                    ? 'border-warning-muted'
                    : 'border-accent-muted'
                  : isHovered
                    ? 'border-border-default'
                    : 'border-transparent'
              ),
          className
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (showReactionPicker || showMoreMenu) return
          setIsHovered(false)
        }}
      >
        {isEditing ? (
          <div className="p-2">
            <div className="flex items-start gap-2">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} className="shrink-0 mt-1" />
              <div className="flex-1 min-w-0 bg-bg-inset border border-border-default rounded-lg p-3 flex flex-col gap-4">
                <div className={cn('relative min-h-[20px] transition-all', (editHasUrgent || editHasHighlight) && 'border-l-[4px] border-border-strong pl-2')}>
                  <EditorContent editor={editEditor} />
                  {editEmpty && (
                    <div className="absolute inset-0 pointer-events-none flex items-center text-sm text-text-muted leading-[1.4]">
                      Edit message
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <IconButton tooltip="Attach file" aria-label="Attach file"><IconPaperclip size={16} stroke={1.5} /></IconButton>
                    <IconButton tooltip="Snooze" aria-label="Snooze"><IconSquareForbid2 size={16} stroke={1.5} /></IconButton>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outlined" size="small" className="w-14" onClick={handleEditCancel}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="small" className="w-14" disabled={editEmpty} onClick={handleEditSave}>
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start pt-2 px-2">
            <div className="flex items-center gap-2 w-full">
              <div className="flex items-center gap-2 shrink-0 flex-1 min-w-0">
                <Avatar size={24} src={authorAvatarSrc} alt={authorName} />
                <span className="text-body-2-strong text-text-primary whitespace-nowrap">{authorName}</span>
                <span className="text-caption text-text-muted whitespace-nowrap signal:font-mono signal:text-[10px] signal:tracking-[0.02em] signal:tabular-nums">{timestamp}</span>
                {highlightState && <HighlightPill type={highlightState} />}
              </div>
              {isNew && !isUrgent && (
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                </div>
              )}
              {isNew && isUrgent && (
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-[shadow:0_0_5px_rgba(255,176,32,0.4)]">
                    <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
                  </div>
                </div>
              )}
            </div>
            <div className="pl-8 pr-2 pt-1 pb-2 w-full overflow-hidden break-words">
              <MessageBody body={bodyState} isTopicResolved={isTopicResolved} nostrReferences={nostrReferences} />
            </div>
            {attachments && attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-8 pr-2 pb-2 w-full">
                {attachments.map((id) => {
                  const frame = frameById(id)
                  if (!frame) return null
                  return (
                    <div
                      key={id}
                      data-interactive
                      className="flex flex-col w-[132px] rounded-lg border border-border-subtle bg-bg-inset hover:border-border-default p-1.5 gap-1.5 cursor-pointer transition-colors"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewFrame(frame)
                      }}
                    >
                      <div className="h-20 rounded-md bg-bg-active flex items-center justify-center overflow-hidden">
                        <FrameArt frame={frame} className={frame.kind === 'mobile' ? 'h-[68px]' : 'w-[90%]'} />
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <img src={figmaIcon} width={14} height={14} alt="Figma" className="rounded-[3px] shrink-0" />
                        <div className="flex flex-col gap-[1px] min-w-0">
                          <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{frame.name}</span>
                          <span className="text-[10px] leading-[1.2] text-text-secondary truncate">{frameBreadcrumb(frame)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {files && files.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-8 pr-2 pb-2 w-full">
                {files.map((f, i) => (
                  <FileAttachmentCard key={f.storageId ?? `${f.name}_${i}`} file={f} />
                ))}
              </div>
            )}
            {reactionsState.length > 0 && (
              <div className="flex items-center gap-2 pl-8 pt-1 pb-2 w-full">
                {reactionsState.map((r, i) => (
                  <ReactionPill key={i} emoji={r.emoji} count={r.count} owner={r.owner} names={r.names} onClick={() => handleReact(r.emoji)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quick menu - only react + more */}
        {isHovered && !isEditing && (
          <div className="absolute right-1 top-1">
            <div className="bg-bg-elevated border border-border-subtle rounded-sm shadow-sm flex items-start gap-1 p-1">
              <div ref={reactButtonRef} className="inline-flex">
                <IconButton tooltip="React" aria-label="React" onClick={openReactionPicker}>
                  <IconMoodPlus size={16} stroke={1.5} />
                </IconButton>
              </div>
              <div ref={moreButtonRef} className="inline-flex">
                <IconButton tooltip="More actions" aria-label="More actions" onClick={handleMore}>
                  <IconDotsVertical size={16} stroke={1.5} />
                </IconButton>
              </div>
            </div>
          </div>
        )}

        {/* More menu (portalled) */}
        {showMoreMenu && moreMenuPos &&
          createPortal(
            <div
              ref={moreMenuRef}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseLeave={() => { setShowMoreMenu(false); setMoreMenuPos(null); setIsHovered(false) }}
              style={{
                position: 'fixed',
                ...(moreMenuPos.top !== undefined ? { top: moreMenuPos.top } : {}),
                ...(moreMenuPos.bottom !== undefined ? { bottom: moreMenuPos.bottom } : {}),
                right: moreMenuPos.right,
                zIndex: 50,
              }}
            >
              <ReplyMoreMenu
                isOwnMessage={authorName === 'You'}
                onEdit={handleEditStart}
                onDelete={handleDelete}
                currentHighlight={highlightState}
                onHighlight={handleHighlightChange}
              />
            </div>,
            document.body
          )}
      </div>

      {/* Reaction picker (portalled) */}
      {showReactionPicker && reactionPickerPos &&
        createPortal(
          <div
            ref={reactionPickerRef}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseLeave={() => { setShowReactionPicker(false); setReactionPickerPos(null); setIsHovered(false) }}
            style={{
              position: 'fixed',
              top: reactionPickerPos.top,
              right: reactionPickerPos.right,
              transform: 'translateY(-100%)',
              zIndex: 50,
            }}
          >
            <ReactionPicker onSelect={handleReact} />
          </div>,
          document.body
        )}

      {previewFrame && (
        <FrameLightbox frame={previewFrame} onClose={() => setPreviewFrame(null)} />
      )}
    </>
  )
}
