import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { registerActiveComposer, unregisterComposer } from '@/lib/composerRegistry'
import { browserDrafts, type DraftStore } from '@/lib/drafts'
import { serializeTiptapToText, textToTiptapContent, withUrgentMentions } from '@/lib/textParsing'
import { useEditor, EditorContent } from '@tiptap/react'
import { PEEK_EDITOR_CLASSES, peekEditorExtensions } from '@/extensions/peekEditor'
import { SelectionToolbar, isSuggestionActive } from '@estiva-app/ui/editor'
import { extractResolution } from '@/extensions/resolution'
import { extractHighlightType } from '@/extensions/highlight'
import { extractUrgent } from '@/extensions/mention'
import { IconArrowUp } from '@tabler/icons-react'
import { IconButton } from './IconButton'
import { AttachmentCard, Kbd, Toolbar } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { useCanUpload, type HighlightType, type UploadedFile } from '@/api'
import { pastedImages, pendingAttachmentNote } from '@/lib/fileAttachments'
import { usePendingAttachments } from '@/lib/usePendingAttachments'
import { AttachFileButton } from './AttachFiles'
import { HighlightButton } from './HighlightButton'
import { WRITING_BOX_CLASSES } from '@/components/ui/looks'

export interface SendPayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /**
   * The pubkeys the `!@` mentions name (CON-17). `text` writes each as a
   * plain mention, so this is the only place the urgency survives to the wire.
   */
  urgent?: string[]
  /** Figma frame ids attached via the command launcher's find flow. */
  /** Real uploaded files (already in Convex storage — Phase 5). */
  files?: UploadedFile[]
}

/**
 * What `onSend` resolves when the relay refused the message (OPT-7). The
 * composer puts it back and then calls `say`, so the note is said once the
 * text is where the note says it is. `filesLost`: it had files, and they could
 * not come back with it (the person had moved on, and a draft keeps only text).
 *
 * The caller builds `say` when it sends, so it names the conversation the
 * message was written in, not the one on screen when the relay answered.
 */
export interface SendRefused {
  say: (filesLost: boolean) => void
}

const isRefusal = (outcome: unknown): outcome is SendRefused =>
  typeof outcome === 'object' && outcome !== null && typeof (outcome as SendRefused).say === 'function'

interface ComposeBoxProps {
  /**
   * Send it. **Resolve `false` when nothing was written anywhere** — CON-10.
   *
   * `void` and `true` both mean sent, so a caller that does not know keeps the
   * old behaviour. An explicit `false` puts the text back silently: the caller
   * has said why. A {@link SendRefused} puts it back and then lets the caller
   * say so (OPT-7).
   *
   * The outcome that matters is whether the message was *stored*, not whether
   * it reached the relay: a message Peek holds is on every Peek reader's screen,
   * and returning `false` for a failed relay mirror would re-offer text that has
   * already been posted.
   */
  onSend?: (payload: SendPayload) => void | boolean | SendRefused | Promise<void | boolean | SendRefused>
  /**
   * Where an unsent message belongs — CON-10. Built with `draftKeys`.
   *
   * Omitted means nothing is kept, which is right for a composer with no
   * stable destination — the huddle creator has no huddle yet, and a draft that
   * cannot be keyed correctly is worse than none, because it comes back
   * somewhere it was not written.
   */
  draftKey?: string
  /** The store. Injected so a test needs no browser; defaults to `localStorage`. */
  drafts?: DraftStore
  placeholder?: 'default' | 'reply'
  /** Names this composer as a launcher target ("Reply to Alice", "#Topic").
   *  Shown in the command launcher's context chip and the Figma attach footer. */
  contextLabel?: string
  /**
   * Objects already resolved, by address — `MessageBody`'s seam, for a surface
   * with no relay to ask (a story, a test). An address chip in the composer
   * (UIG-40) takes its title and status from here instead of asking.
   */
  resolvedObjects?: Record<string, ForeignObject>
  className?: string
}

/*
  What a message is *sent* as is what an edit is *saved* as — one writer,
  `serializeTiptapToText`. This file used to carry its own copy of that walk,
  and the two drifted the way two copies do: RIC-11 taught the edit path to
  write a topic as `nostr:naddr…` and a message as `nostr:nevent…`, and the
  composer went on sending `[Title]` and dropping the message node on the
  floor, so the first pointer mention ever typed on production went out as
  the bracket form with nothing after it. PEE-19 had already made the same
  argument for a link; this finishes it.
*/
const serializeToText = serializeTiptapToText


const DEFAULT_DRAFTS = browserDrafts()

/**
 * The box for writing a new message or reply, with text formatting, files,
 * highlights and a send button; unsent text is kept for later.
 */
export function ComposeBox({ onSend, placeholder = 'default', contextLabel, draftKey, drafts = DEFAULT_DRAFTS, resolvedObjects, className }: ComposeBoxProps) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [hasUrgent, setHasUrgent] = useState(false)
  const [hasHighlight, setHasHighlight] = useState(false)
  const uploads = usePendingAttachments()
  // Fixed for the composer's life: the conversation around it decides it.
  const canUpload = useCanUpload()
  const composeRef = useRef<HTMLDivElement>(null)

  const sendFnRef = useRef(onSend)
  sendFnRef.current = onSend

  /* Read inside the editor's stable handlers, which close over their first
     render — the same reason `sendFnRef` exists. */
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  /* The paste handler lives in `editorProps`, a closure from the first render
     — the same reason `sendFnRef` exists. */
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  /*
    Send what is written — Enter and the Send button alike (OPT-7). Read
    through refs only, because Enter calls it from the editor's first-render
    closure.

    Cleared now, put back if it did not land — CON-10. Ship waits for the
    write and clears only on success. Peek cannot: the message appears in the
    list the instant it is sent (OPT-6), so holding the text in the composer
    would show it twice. Clearing and restoring keeps that and still honours
    the rule that a refused send does not lose what was typed. The Send
    button used to ignore the outcome, so a refused send by click lost it.
  */
  const send = (ed: NonNullable<ReturnType<typeof useEditor>>): boolean => {
    const text = serializeToText(ed)
    const resolution = extractResolution(ed)
    const files = uploadsRef.current.ready()
    if (!text && !resolution.hasResolution && files.length === 0) return false
    const urgent = extractUrgent(ed)
    const sent = sendFnRef.current?.({
      text,
      resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
      highlightType: extractHighlightType(ed),
      urgent,
      files: files.length > 0 ? files : undefined,
    })
    ed.commands.clearContent(true)
    const key = draftKeyRef.current
    if (key) draftsRef.current.clear(key)
    uploadsRef.current.clear()
    void Promise.resolve(sent).then((outcome) => {
      if (outcome !== false && !isRefusal(outcome)) return
      const filesLost = !putBack(key, ed, text, urgent, files)
      if (isRefusal(outcome)) outcome.say(filesLost && files.length > 0)
    })
    return true
  }

  /*
    Put an unsent message back where it was written, above anything written
    there since: nothing is overwritten (OPT-7, decided 7 Oct). True when its
    files came back too.

    Into this editor while it is still that conversation's. Once the person
    has moved on, the editor is gone or shows another conversation, so the
    text goes into the conversation's draft instead, and comes back when they
    return. A draft keeps only text, so the files stay behind then.
  */
  const putBack = (key: string | undefined, ed: NonNullable<ReturnType<typeof useEditor>>, text: string, urgent: string[] | undefined, files: UploadedFile[]): boolean => {
    const restored = withUrgentMentions(textToTiptapContent(text), urgent)
    if (!ed.isDestroyed && draftKeyRef.current === key) {
      if (serializeToText(ed).trim()) ed.chain().insertContentAt(0, restored.content ?? []).run()
      else ed.commands.setContent(restored, { emitUpdate: true })
      // The draft first, always: it survives the tab, and it is the half that cannot be undone by what the person does next.
      if (key) draftsRef.current.write(key, serializeToText(ed), extractUrgent(ed))
      uploadsRef.current.restore(files)
      return true
    }
    if (!key) return false
    const since = draftsRef.current.readDraft(key)
    draftsRef.current.write(key, since?.text ? `${text}\n${since.text}` : text, [...new Set([...(urgent ?? []), ...(since?.urgent ?? [])])])
    return false
  }

  const editor = useEditor({
    extensions: peekEditorExtensions,
    editorProps: {
      attributes: {
        class: PEEK_EDITOR_CLASSES,
        style: 'caret-color: var(--text-primary)',
      },
      /**
       * A screenshot on the clipboard becomes an attachment — PEE-20.
       *
       * Uploads need storage, so a paste is inert without a deployment, for
       * the same reason the paperclip is hidden there: an action only where
       * it can succeed. `pastedImages` decides what is an image and what is
       * a copy that merely carries one (text wins), and returning true keeps
       * the picture out of the document — it belongs in a chip, not in the
       * text. Anything it declines falls through untouched, which is how a
       * pasted link stays a link.
       */
      handlePaste: (_view, event) => {
        if (!canUpload) return false
        const images = pastedImages(event.clipboardData)
        if (images.length === 0) return false
        uploadsRef.current.add(images)
        return true
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          // Hold Enter until in-flight uploads settle, so files aren't dropped.
          if (uploadsRef.current.isUploading) return true
          send(editorRef.current!)
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
      /*
        Keep the draft as the MARKER TEXT, not the editor's document — CON-10.

        A Tiptap doc is shaped by this app's schema at this version, so a draft
        stored as JSON could fail to load after a release that changes a node.
        Marker text is what would be sent (SPEC §13.2) and what the other app
        reads, so it survives both.
      */
      // With whom it names urgently, which the text cannot say (CON-31).
      if (draftKeyRef.current) draftsRef.current.write(draftKeyRef.current, serializeToText(editor), extractUrgent(editor))
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

    },
  })

  /*
    Seed from the draft, and re-seed when the destination changes — CON-10.

    Keyed on `draftKey` rather than run once: this composer is reused as the
    route changes, so mounting is not the moment the destination changes.
    Seeding only on mount is exactly PEE-7's first symptom — "you switch to a
    different topic, the text is kept there, which is weird".

    Restored through `textToTiptapContent`, the same parser a pasted message
    goes through, so a draft with a heading or a list comes back as one rather
    than as its marker characters.
  */
  // What the address chips read instead of asking the relay: set before the
  // draft below loads, so a chip is drawn resolved from its first paint.
  useLayoutEffect(() => {
    if (!editor) return
    const storage = (editor.storage as unknown as { objectMention?: { supplied?: Record<string, ForeignObject> } }).objectMention
    if (storage) storage.supplied = resolvedObjects
  }, [editor, resolvedObjects])

  useEffect(() => {
    if (!editor) return
    const draft = draftKey ? drafts.readDraft(draftKey) : undefined
    const text = draft?.text ?? ''
    // The urgent chips come back urgent: the text alone gives ordinary mentions (CON-31).
    editor.commands.setContent(
      text ? withUrgentMentions(textToTiptapContent(text), draft?.urgent) : { type: 'doc', content: [{ type: 'paragraph' }] },
    )
    setIsEmpty(!text)
    // Any urgent chip, keyed or not — the rule `onUpdate` draws the border by.
    let urgent = false
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'urgentMention') urgent = true
    })
    setHasUrgent(urgent)
    // `drafts` is deliberately not a dependency: a caller passing a fresh store
    // object each render would otherwise re-seed and wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, editor])

  editorRef.current = editor

  // Register with the global composer registry so the command launcher can
  // insert into "the compose box the user last touched" (focus wins; the most
  // recently mounted composer is the fallback).
  useEffect(() => {
    if (!editor) return
    const handle = { editor, label: contextLabel }
    registerActiveComposer(handle)
    const onFocus = () => registerActiveComposer(handle)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
      unregisterComposer(editor)
    }
  }, [editor, contextLabel])



  const handleSend = () => {
    if (!editor) return
    if (uploads.isUploading) return // wait for in-flight uploads
    if (!send(editor)) return
    editor.commands.focus()
    setIsEmpty(true)
    setHasUrgent(false)
    setHasHighlight(false)
  }


  return (
    <div ref={composeRef} className={cn('relative', className)}>

      <div className={cn(WRITING_BOX_CLASSES, 'focus-within:border-border-strong transition-colors')}>
        {/* Editable area - left border when urgent or highlight */}
        <div data-composer-editor className={cn(
          'relative min-h-[20px] transition-all',
          hasUrgent && 'border-l-4 border-border-strong pl-2',
          !hasUrgent && hasHighlight && 'border-l-4 border-border-strong pl-2'
        )}>
          <EditorContent editor={editor} />
          {/* Bold / italic / underline / link over a selection. Rendered here
              rather than in the `/` menu because those marks need something
              selected, and typing `/` replaces a selection. (It is not that the
              menu needs an empty composer — it stopped needing that at PEE-18,
              and the note here still said so.) */}
          <SelectionToolbar editor={editor} link />
          {isEmpty && !hasHighlight && (
            <div className="absolute inset-0 pointer-events-none flex items-center gap-1 text-body-2 text-text-muted flex-wrap">
              {placeholder === 'reply' ? (
                <span>Reply...</span>
              ) : (
                <>
                  <span>Start a new conversation or type</span>
                  <Kbd>/</Kbd>
                  <span>for commands</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Attached frames - preview cards below the text, removable, click to view */}
        {/* Pending / uploaded files — removable chips below the text. */}
        {uploads.files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uploads.files.map((f) => (
              <AttachmentCard
                key={f.localId}
                pending
                name={f.name}
                size={f.size}
                contentType={f.contentType}
                src={f.uploaded?.previewUrl}
                onRemove={() => uploads.remove(f.localId)}
                {...pendingAttachmentNote({ status: f.status, error: f.error })}
              />
            ))}
          </div>
        )}

        {/* The row under the editor. The three things you do to a draft are
            one strip — one Tab stop, arrows along it (§4.2, D29) — and Send,
            which is the answer rather than a tool, keeps its own stop.
            `surface={false}`: the composer already draws the box these sit in. */}
        <div className="flex items-center justify-between">
          <Toolbar aria-label="Compose tools" surface={false} className="flex items-center gap-1">
            <AttachFileButton onPick={uploads.add} />
            <HighlightButton editor={editor} container={composeRef} />
          </Toolbar>

          {(() => {
            const hasReadyFile = uploads.files.some((f) => f.status === 'done')
            const canSend = (!isEmpty || hasReadyFile) && !uploads.isUploading
            return (
              <div className="flex items-center gap-2.5">
              <span className="hidden signal:inline font-mono text-menu font-normal tracking-wider text-text-muted select-none">
                Enter to send · Shift+Enter new line
              </span>
              {/* The shared IconButton's `primary`, which this button was a
                  hand-written copy of, class for class, with the package's
                  Signal `glow` (UIG-9) — a disabled send button does not glow.
                  Focus must not leave the editor, so the press is onMouseDown
                  with the default prevented.

                  The keyboard's press is the click (UIG-14, C5): Enter or Space
                  on the focused button fires a click with no pointer behind it
                  (`detail` 0), and that sends. A mouse press has already sent
                  on its way down, so its click (`detail` 1 or more) does
                  nothing — a click never sends twice. */}
              <IconButton
                variant="primary"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                onClick={(e) => {
                  if (e.detail === 0) handleSend()
                }}
                disabled={!canSend}
                aria-label="Send"
                // Icon-only, so it says its word, and the key that does the same.
                tooltip="Send"
                tooltipShortcut="Enter"
                glow={canSend}
              >
                <IconArrowUp size={16} stroke={1.5} />
              </IconButton>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
