import { useState, useRef, useEffect, useCallback } from 'react'
import { registerActiveComposer, unregisterComposer } from '@/lib/composerRegistry'
import { useEditor, EditorContent } from '@tiptap/react'
import { peekStarterKit } from '@/extensions/editorKit'
import { PeekMention, UrgentMention, TopicMention, FileMention, isSuggestionActive } from '@/extensions/mention'
import { ResolutionBlock, extractResolution } from '@/extensions/resolution'
import { HighlightTag, extractHighlightType } from '@/extensions/highlight'
import { IconPaperclip, IconSquareForbid2, IconArrowUp, IconHighlight, IconX, IconLoader2, IconAlertCircle } from '@tabler/icons-react'
import { IconButton } from './IconButton'
import { SectionLabel } from './SectionHeader'
import { HighlightSwatch } from './HighlightPill'
import { FrameArt } from './FrameArt'
import { FrameLightbox } from '../FrameLightbox'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, hasConvex, useUploadActions, type HighlightType, type UploadedFile } from '@/api'
import { frameById, frameBreadcrumb, type FigmaFrame } from '@/api'
import { FILE_ACCEPT_ATTR, validateFile, isImageAttachment, formatBytes, fileTypeLabel } from '@/lib/fileAttachments'
import { wrapInlineMarks } from '@/lib/textParsing'

export interface SendPayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** Figma frame ids attached via the command launcher's find flow. */
  attachments?: string[]
  /** Real uploaded files (already in Convex storage — Phase 5). */
  files?: UploadedFile[]
}

/** One picked file's lifecycle in the composer. */
interface PendingUpload {
  localId: string
  name: string
  size: number
  contentType: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  uploaded?: UploadedFile
}

let uploadSeq = 0

interface ComposeBoxProps {
  onSend?: (payload: SendPayload) => void
  placeholder?: 'default' | 'reply'
  /** Names this composer as a launcher target ("Reply to Alice", "#Topic").
   *  Shown in the command launcher's context chip and the Figma attach footer. */
  contextLabel?: string
  className?: string
}

function serializeInline(node: { forEach: (cb: (child: { type: { name: string }; attrs: Record<string, string>; text?: string; marks?: ReadonlyArray<{ type: { name: string } }> }) => void) => void }): string {
  let text = ''
  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      text += '\n'
    } else if (child.type.name === 'mention') {
      text += `@${child.attrs.label}`
    } else if (child.type.name === 'urgentMention') {
      text += `!@${child.attrs.label}`
    } else if (child.type.name === 'topicMention') {
      text += `[${child.attrs.label}]`
    } else if (child.type.name === 'fileMention') {
      text += `[${child.attrs.label}]`
    } else if (child.type.name === 'highlightTag') {
      // Skip - extracted as metadata, not serialized into text
    } else {
      const markNames = new Set((child.marks ?? []).map((m) => m.type.name))
      text += wrapInlineMarks(child.text ?? '', markNames)
    }
  })
  return text
}

function serializeToText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  const lines: string[] = []
  editor.state.doc.forEach((node) => {
    // Skip resolution blocks - they are consumed by the resolve action
    if (node.type.name === 'resolutionBlock') return
    if (node.type.name === 'paragraph') {
      lines.push(serializeInline(node))
    } else if (node.type.name === 'heading') {
      const text = serializeInline(node)
      if (text.trim()) lines.push(`${'#'.repeat(node.attrs.level === 2 ? 2 : 1)} ${text}`)
    } else if (node.type.name === 'bulletList') {
      node.forEach((li) => {
        li.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`- ${serializeInline(liChild)}`)
          }
        })
      })
    } else if (node.type.name === 'orderedList') {
      let idx = 1
      node.forEach((li) => {
        li.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`${idx}. ${serializeInline(liChild)}`)
            idx++
          }
        })
      })
    } else if (node.type.name === 'blockquote') {
      node.forEach((qChild) => {
        if (qChild.type.name === 'paragraph') {
          lines.push(`> ${serializeInline(qChild)}`)
        }
      })
    }
  })
  return lines.join('\n').trim()
}

// ── Slash command items - all shortcuts ──

type SlashItem =
  | { kind: 'highlight'; type: HighlightType; label: string }
  | { kind: 'shortcut'; label: string; trigger: string; input: string; description: string }

const SLASH_ITEMS: SlashItem[] = [
  // Highlights
  { kind: 'highlight', type: 'insight',    label: 'Insight' },
  { kind: 'highlight', type: 'concern',    label: 'Concern' },
  { kind: 'highlight', type: 'conclusion', label: 'Conclusion' },
  { kind: 'highlight', type: 'question',   label: 'Question' },
  { kind: 'highlight', type: 'summary',    label: 'Summary' },
  // Other shortcuts
  { kind: 'shortcut', label: 'Mention',  trigger: '@',  input: '@',   description: 'Mention a person' },
  { kind: 'shortcut', label: 'Urgent',   trigger: '!@', input: '!@',  description: 'Urgent mention' },
  { kind: 'shortcut', label: 'Link',     trigger: '[',  input: '[',   description: 'Reference a file or topic' },
  { kind: 'shortcut', label: 'Resolve',  trigger: '→',  input: '-> ', description: 'Resolve conversation' },
]

export function ComposeBox({ onSend, placeholder = 'default', contextLabel, className }: ComposeBoxProps) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [hasUrgent, setHasUrgent] = useState(false)
  const [hasHighlight, setHasHighlight] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashHighlight, setSlashHighlight] = useState(0)
  const [attachedFrameIds, setAttachedFrameIds] = useState<string[]>([])
  const [previewFrame, setPreviewFrame] = useState<FigmaFrame | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadFile, deleteUpload } = useUploadActions()
  const composeRef = useRef<HTMLDivElement>(null)

  const sendFnRef = useRef(onSend)
  sendFnRef.current = onSend

  // Mirror attachments into refs so the editorProps Enter handler (a stable
  // closure) always sees the current lists.
  const attachedFramesRef = useRef<string[]>([])
  attachedFramesRef.current = attachedFrameIds
  const pendingFilesRef = useRef<PendingUpload[]>([])
  pendingFilesRef.current = pendingFiles

  /** Files that finished uploading and are ready to send. */
  const readyFiles = (): UploadedFile[] =>
    pendingFilesRef.current.filter((f) => f.status === 'done' && f.uploaded).map((f) => f.uploaded!)
  const isUploading = pendingFiles.some((f) => f.status === 'uploading')

  const handlePickFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const localId = `u_${++uploadSeq}`
      const err = validateFile(file)
      if (err) {
        setPendingFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'error', error: err }])
        continue
      }
      setPendingFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'uploading' }])
      uploadFile(file).then(
        (uploaded) =>
          setPendingFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'done', uploaded } : f))),
        (e: unknown) =>
          setPendingFiles((prev) =>
            prev.map((f) => (f.localId === localId ? { ...f, status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' } : f)),
          ),
      )
    }
  }

  const removePendingFile = (localId: string) => {
    setPendingFiles((prev) => {
      const slot = prev.find((f) => f.localId === localId)
      // A successfully-uploaded blob that never got sent must be cleaned up.
      if (slot?.uploaded) deleteUpload(slot.uploaded.storageId)
      return prev.filter((f) => f.localId !== localId)
    })
  }

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions: [
      peekStarterKit,
      PeekMention,
      UrgentMention,
      TopicMention,
      FileMention,
      ResolutionBlock,
      HighlightTag,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none w-full bg-transparent text-sm text-text-primary leading-[1.4] break-words min-h-[20px]',
        style: 'caret-color: var(--text-primary)',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          const ed = editorRef.current!
          const text = serializeToText(ed)
          const resolution = extractResolution(ed)
          const hl = extractHighlightType(ed)
          const attachments = attachedFramesRef.current
          const files = readyFiles()
          // Hold Enter until in-flight uploads settle, so files aren't dropped.
          if (pendingFilesRef.current.some((f) => f.status === 'uploading')) return true
          if (text || resolution.hasResolution || attachments.length > 0 || files.length > 0) {
            sendFnRef.current?.({
              text,
              resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
              highlightType: hl,
              attachments: attachments.length > 0 ? [...attachments] : undefined,
              files: files.length > 0 ? files : undefined,
            })
            ed.commands.clearContent(true)
            setAttachedFrameIds([])
            setPendingFiles([])
          }
          return true
        }
        // Shift+Enter: in list → split item (or exit if empty), else new paragraph
        if (event.key === 'Enter' && event.shiftKey) {
          const ed = editorRef.current
          if (!ed) return false
          const { $from } = view.state.selection
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const listItem = $from.node(d)
              const isEmpty = listItem.textContent.length === 0
              if (isEmpty) {
                ed.commands.liftListItem('listItem')
              } else {
                ed.commands.splitListItem('listItem')
              }
              return true
            }
          }
          // In a quote: splitBlock continues it line by line; Shift+Enter on
          // an EMPTY quote line lifts out to a regular paragraph (mirrors how
          // an empty list item exits the list).
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'blockquote') {
              if ($from.parent.textContent.length === 0) {
                ed.commands.lift('paragraph')
                return true
              }
              break
            }
          }
          ed.commands.splitBlock()
          return true
        }
        return false
      },
    },
    content: '',
    autofocus: true,
    onUpdate({ editor }) {
      const doc = editor.state.doc
      let hasNonParagraph = false
      let hasAtomNode = false
      let hasHl = false
      doc.forEach((node) => {
        // Headings count as paragraph-like: an empty heading is still "empty".
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') hasNonParagraph = true
      })
      doc.descendants((node) => {
        if (node.isAtom && node.type.name !== 'paragraph') hasAtomNode = true
        if (node.type.name === 'highlightTag') hasHl = true
        if (node.type.name === 'urgentMention') return // handled below
      })

      // "Empty" means no text AND no atoms except highlightTag
      const textLen = doc.textContent.length
      const onlyHighlight = hasHl && textLen === 0 && !hasNonParagraph
      const empty = textLen === 0 && !hasNonParagraph && !hasAtomNode
      setIsEmpty(empty || onlyHighlight)

      // Collapse leftover empty paragraphs to one (but keep highlight tag)
      if (empty && !hasAtomNode && doc.childCount > 1) {
        requestAnimationFrame(() => {
          editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
        })
      }

      let urgent = false
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'urgentMention') urgent = true
      })
      setHasUrgent(urgent)
      setHasHighlight(hasHl)

      // Slash command detection
      const fullText = doc.textContent
      if (fullText.startsWith('/') && doc.childCount === 1 && !hasHl) {
        const query = fullText.slice(1).toLowerCase()
        setSlashQuery(query)
        setShowSlashMenu(true)
        setSlashHighlight(0)
      } else {
        setShowSlashMenu(false)
        setSlashQuery('')
      }
    },
  })

  editorRef.current = editor

  // Register with the global composer registry so the command launcher can
  // insert into "the compose box the user last touched" (focus wins; the most
  // recently mounted composer is the fallback).
  useEffect(() => {
    if (!editor) return
    const handle = {
      editor,
      label: contextLabel,
      attachFrames: (ids: string[]) =>
        setAttachedFrameIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]),
    }
    registerActiveComposer(handle)
    const onFocus = () => registerActiveComposer(handle)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
      unregisterComposer(editor)
    }
  }, [editor, contextLabel])

  // Insert a highlight tag into the editor at the start (preserving existing text)
  const insertHighlightTag = useCallback((type: HighlightType) => {
    const ed = editorRef.current
    if (!ed) return

    // Check if there's already a highlight tag
    let tagFrom = -1
    let tagTo = -1
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === 'highlightTag') {
        tagFrom = pos
        tagTo = pos + node.nodeSize
      }
    })

    if (tagFrom >= 0) {
      // Replace the existing tag in place (preserves surrounding text)
      ed.chain()
        .deleteRange({ from: tagFrom, to: tagTo })
        .insertContentAt(tagFrom, [
          { type: 'highlightTag', attrs: { highlightType: type } },
        ])
        .focus()
        .run()
    } else {
      // No existing tag - if there's only slash text, clear it first; otherwise prepend
      const docText = ed.state.doc.textContent
      if (docText.startsWith('/')) {
        ed.commands.clearContent(true)
      }
      ed.chain()
        .focus()
        .insertContentAt(1, [
          { type: 'highlightTag', attrs: { highlightType: type } },
          { type: 'text', text: ' ' },
        ])
        .run()
    }
  }, [])

  // Listen for tag clicks to reopen picker
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const highlightPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as HTMLElement | undefined
      // Only respond if the click came from within this ComposeBox
      if (target && composeRef.current?.contains(target)) {
        setShowHighlightPicker(true)
      }
    }
    window.addEventListener('highlight-tag-click', handler)
    return () => window.removeEventListener('highlight-tag-click', handler)
  }, [])

  // Close highlight picker on outside click
  useEffect(() => {
    if (!showHighlightPicker) return
    const close = (e: MouseEvent) => {
      if (highlightPickerRef.current?.contains(e.target as Node)) return
      setShowHighlightPicker(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showHighlightPicker])

  // Filtered slash items
  const filteredSlashItems = SLASH_ITEMS.filter((item) => {
    if (!slashQuery) return true
    if (item.kind === 'highlight') return item.label.toLowerCase().includes(slashQuery) || item.type.includes(slashQuery)
    return item.label.toLowerCase().includes(slashQuery) || item.trigger.includes(slashQuery) || item.input.includes(slashQuery) || item.description.toLowerCase().includes(slashQuery)
  })

  const handleSlashSelect = useCallback((item: SlashItem) => {
    setShowSlashMenu(false)
    setSlashQuery('')
    const ed = editorRef.current
    if (!ed) return

    if (item.kind === 'highlight') {
      insertHighlightTag(item.type)
    } else {
      // For shortcuts: clear the / and type the trigger character
      ed.commands.clearContent(true)
      ed.commands.focus()
      // Insert the trigger text so the suggestion plugin picks it up
      requestAnimationFrame(() => {
        ed.commands.insertContent(item.input)
      })
    }
  }, [insertHighlightTag])

  // Slash menu keyboard navigation
  useEffect(() => {
    if (!showSlashMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashHighlight((h) => Math.min(h + 1, filteredSlashItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashHighlight((h) => Math.max(h - 1, 0))
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const item = filteredSlashItems[slashHighlight]
        if (item) handleSlashSelect(item)
      } else if (e.key === 'Escape') {
        setShowSlashMenu(false)
        const ed = editorRef.current
        if (ed) {
          ed.commands.clearContent(true)
          ed.commands.focus()
        }
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [showSlashMenu, slashHighlight, filteredSlashItems, handleSlashSelect])

  const handleSend = () => {
    if (!editor) return
    if (isUploading) return // wait for in-flight uploads
    const text = serializeToText(editor)
    const resolution = extractResolution(editor)
    const hl = extractHighlightType(editor)
    const files = readyFiles()
    if (!text && !resolution.hasResolution && attachedFrameIds.length === 0 && files.length === 0) return
    onSend?.({
      text,
      resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
      highlightType: hl,
      attachments: attachedFrameIds.length > 0 ? attachedFrameIds : undefined,
      files: files.length > 0 ? files : undefined,
    })
    editor.commands.clearContent(true)
    editor.commands.focus()
    setIsEmpty(true)
    setHasUrgent(false)
    setHasHighlight(false)
    setAttachedFrameIds([])
    setPendingFiles([])
  }

  // Split filtered items into sections for rendering
  const highlightItems = filteredSlashItems.filter((i): i is SlashItem & { kind: 'highlight' } => i.kind === 'highlight')
  const shortcutItems = filteredSlashItems.filter((i): i is SlashItem & { kind: 'shortcut' } => i.kind === 'shortcut')

  return (
    <div ref={composeRef} className={cn('relative', className)}>
      {/* Slash command menu */}
      {showSlashMenu && filteredSlashItems.length > 0 && (
        <div className="absolute left-0 right-0 bottom-full mb-1 z-50">
          <div className="w-[244px] bg-bg-elevated border border-border-default rounded-lg shadow-lg p-2 flex flex-col gap-2">
            {highlightItems.length > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center h-[32px] px-2">
                  <SectionLabel>Highlights</SectionLabel>
                </div>
                {highlightItems.map((item) => {
                  const globalIdx = filteredSlashItems.indexOf(item)
                  return (
                    <div
                      key={item.type}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                        globalIdx === slashHighlight ? 'bg-bg-hover' : ''
                      )}
                      onMouseEnter={() => setSlashHighlight(globalIdx)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSlashSelect(item)
                      }}
                    >
                      <HighlightSwatch type={item.type} />
                      <span className="flex-1 text-sm text-text-secondary signal:text-text-primary">{item.label}</span>
                      {globalIdx === slashHighlight && (
                        <div className="flex items-center gap-2 shrink-0 text-text-muted">
                          <span className="text-[12px] leading-[1.2]">↩</span>
                          <span className="text-[9px] font-medium leading-[1.15] signal:font-mono signal:text-[9.5px] signal:tracking-[0.04em]">Enter</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {highlightItems.length > 0 && shortcutItems.length > 0 && (
              <div className="h-px bg-border-subtle mx-0" />
            )}
            {shortcutItems.length > 0 && (
              <div className="flex flex-col">
                <div className="flex items-center h-[32px] px-2">
                  <SectionLabel>Shortcuts</SectionLabel>
                </div>
                {shortcutItems.map((item) => {
                  const globalIdx = filteredSlashItems.indexOf(item)
                  return (
                    <div
                      key={item.trigger}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors',
                        globalIdx === slashHighlight ? 'bg-bg-hover' : ''
                      )}
                      onMouseEnter={() => setSlashHighlight(globalIdx)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSlashSelect(item)
                      }}
                    >
                      <span className="flex-1 text-sm text-text-secondary signal:text-text-primary">{item.label}</span>
                      <kbd className="inline-flex items-center justify-center bg-bg-inset border border-border-strong rounded-sm px-1 py-[1px] text-[11px] text-text-secondary leading-[1.2] min-w-[18px] shrink-0">
                        {item.trigger}
                      </kbd>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Highlight picker (from toolbar button or tag click) */}
      {showHighlightPicker && (
        <div ref={highlightPickerRef} className="absolute left-0 bottom-full mb-1 z-50">
          <div className="w-[180px] bg-bg-elevated border border-border-default rounded-lg shadow-lg p-2">
            {(['insight', 'concern', 'conclusion', 'question', 'summary'] as HighlightType[]).map((type) => (
              <div
                key={type}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertHighlightTag(type)
                  setShowHighlightPicker(false)
                }}
              >
                <HighlightSwatch type={type} />
                <span className="text-sm text-text-secondary signal:text-text-primary">{HIGHLIGHT_META[type].label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative bg-bg-inset border border-border-default focus-within:border-border-strong rounded-lg p-3 flex flex-col gap-4 transition-colors signal:transition-shadow signal:focus-within:border-border-focus signal:focus-within:shadow-[shadow:var(--focus-ring)]">
        {/* Editable area - left border when urgent or highlight */}
        <div data-composer-editor className={cn(
          'relative min-h-[20px] transition-all',
          hasUrgent && 'border-l-[4px] border-border-strong pl-2',
          !hasUrgent && hasHighlight && 'border-l-[4px] border-border-strong pl-2'
        )}>
          <EditorContent editor={editor} />
          {isEmpty && !hasHighlight && (
            <div className="absolute inset-0 pointer-events-none flex items-center gap-1 text-sm text-text-muted leading-[1.4] flex-wrap">
              {placeholder === 'reply' ? (
                <span>Reply...</span>
              ) : (
                <>
                  <span>Start a new conversation or type</span>
                  <kbd className="inline-flex items-center border border-border-strong rounded-sm px-1 py-[1px] text-[12px] text-text-secondary leading-[1.2]">
                    /
                  </kbd>
                  <span>for commands</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Attached frames - preview cards below the text, removable, click to view */}
        {attachedFrameIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFrameIds.map((id) => {
              const frame = frameById(id)
              if (!frame) return null
              return (
                <div
                  key={id}
                  className="group relative flex flex-col w-[132px] rounded-lg border border-border-default bg-bg-elevated p-1.5 gap-1.5 cursor-pointer"
                  onClick={() => setPreviewFrame(frame)}
                >
                  <div className="h-20 rounded-md bg-bg-active flex items-center justify-center overflow-hidden">
                    <FrameArt frame={frame} className={frame.kind === 'mobile' ? 'h-[68px]' : 'w-[90%]'} />
                  </div>
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{frame.name}</span>
                    <span className="text-[10px] leading-[1.2] text-text-secondary truncate">{frameBreadcrumb(frame)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${frame.name}`}
                    className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAttachedFrameIds((prev) => prev.filter((fid) => fid !== id))
                    }}
                  >
                    <IconX size={11} stroke={1.75} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Pending / uploaded files — removable chips below the text. */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f) => {
              const thumb = f.uploaded?.previewUrl
              const isImage = isImageAttachment(f.name, f.contentType)
              return (
                <div
                  key={f.localId}
                  className={cn(
                    'group relative flex items-center gap-2 w-[200px] rounded-lg border bg-bg-elevated p-1.5 pr-3',
                    f.status === 'error' ? 'border-error-default' : 'border-border-default',
                  )}
                >
                  <div className="size-9 rounded-md bg-bg-active flex items-center justify-center shrink-0 overflow-hidden text-text-secondary">
                    {f.status === 'uploading' ? (
                      <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                    ) : f.status === 'error' ? (
                      <IconAlertCircle size={16} stroke={1.5} className="text-error-default" />
                    ) : isImage && thumb ? (
                      <img src={thumb} alt={f.name} className="size-full object-cover" />
                    ) : (
                      <span className="text-[9px] font-semibold">{fileTypeLabel(f.name)}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{f.name}</span>
                    <span className={cn('text-[10px] leading-[1.2] truncate', f.status === 'error' ? 'text-error-default' : 'text-text-secondary')}>
                      {f.status === 'error' ? f.error : f.status === 'uploading' ? 'Uploading…' : formatBytes(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      removePendingFile(f.localId)
                    }}
                  >
                    <IconX size={11} stroke={1.75} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* File upload needs storage — shown only against a live backend
                (the demo build hides it; the action only appears where it works). */}
            {hasConvex && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => {
                    handlePickFiles(e.target.files)
                    e.target.value = '' // let the same file be re-picked
                  }}
                />
                <IconButton tooltip="Attach file" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}>
                  <IconPaperclip size={16} stroke={1.5} />
                </IconButton>
              </>
            )}
            <IconButton tooltip="Snooze" aria-label="Snooze">
              <IconSquareForbid2 size={16} stroke={1.5} />
            </IconButton>
            <IconButton
              aria-label="Highlight"
              tooltip="Mark as Highlight"
              onClick={() => setShowHighlightPicker((v) => !v)}
            >
              <IconHighlight size={16} stroke={1.5} />
            </IconButton>
          </div>

          {(() => {
            const hasReadyFile = pendingFiles.some((f) => f.status === 'done')
            const canSend = (!isEmpty || attachedFrameIds.length > 0 || hasReadyFile) && !isUploading
            return (
              <div className="flex items-center gap-2.5">
              <span className="hidden signal:inline font-mono text-[9px] tracking-[0.04em] text-text-muted select-none">
                Enter to send · Shift+Enter new line
              </span>
              <button
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  'flex items-center justify-center p-1 rounded-lg transition-colors',
                  canSend
                    ? 'bg-accent-primary hover:bg-accent-hover text-text-inverse cursor-pointer signal:shadow-[shadow:var(--glow-accent)]'
                    : 'bg-bg-disabled text-text-disabled pointer-events-none'
                )}
              >
                <IconArrowUp size={16} stroke={1.5} />
              </button>
              </div>
            )
          })()}
        </div>
      </div>

      {previewFrame && (
        <FrameLightbox frame={previewFrame} onClose={() => setPreviewFrame(null)} />
      )}
    </div>
  )
}
