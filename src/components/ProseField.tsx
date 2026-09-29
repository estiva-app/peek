import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { SelectionToolbar } from '@estiva-app/ui/editor'
import { WRITING_BOX_CLASSES } from '@/components/ui/looks'
import { PEEK_EDITOR_CLASSES, peekProseExtensions } from '@/extensions/peekEditor'
import { serializeTiptapToText, textToTiptapContent } from '@/lib/textParsing'
import { cn } from '@/lib/utils'

/**
 * A form field whose owner accepts a block document — the `prose` control
 * (MAN-1, RIC-13): Ship's `add-issue` description, filed from a conversation.
 *
 * **Peek's one editor, not a second.** The grammar is the composer's
 * (`peekProseExtensions`), the box is the one Peek writes in
 * (`WRITING_BOX_CLASSES`), and the marks over a selection are the package's
 * `SelectionToolbar`. What it holds is marker text, as every Peek editor does;
 * `proseSubmission` turns that into the §13.3 document on the way out, so the
 * issue Ship reads is blocks.
 *
 * **Controlled by the draft, which the launcher owns** (R1 A). Typing hands the
 * text back; a value arriving from outside — a prefill (PEE-5), or coming back
 * into the form — is loaded into the editor.
 *
 * **Told apart by everything this editor has emitted, not only the last.**
 * Keys pressed faster than React renders reach the editor before the draft
 * from the previous one comes back as `value`. Compared with the last emission
 * alone, that older value looked like an outside one and was loaded over the
 * newer text — bold and whole paragraphs vanished on production when the keys
 * came back-to-back (RIC-13's probe). A value this editor wrote is never an
 * outside value, however late it arrives; the set is emptied once the draft
 * has caught up, so it holds only the edits still in flight.
 *
 * Enter is a new paragraph: a description has several. Ctrl+Enter reaches the
 * palette's form untouched, which is what submits. No Link button: §13.3's
 * document has no link mark, so a link typed here could only arrive as
 * brackets.
 */

/** What a prose field is handed: the draft's marker text, and where edits go. */
export interface ProseFieldProps {
  value: string
  onChange: (value: string) => void
  /** Read by a screen reader; the visible label is the surrounding `Field`'s. */
  label: string
  placeholder?: string
}

const EMPTY = { type: 'doc', content: [{ type: 'paragraph' }] }

const contentFor = (value: string) => (value ? textToTiptapContent(value) : EMPTY)

/** A form field written in Peek's editor and sent as a block document. */
export function ProseField({ value, onChange, label, placeholder }: ProseFieldProps) {
  /** What this editor has handed back and the draft has not yet caught up with. */
  const inFlight = useRef(new Set([value]))
  /** The newest of them — the draft has caught up when `value` equals it. */
  const latest = useRef(value)
  /** The latest `onChange`, so the editor subscribes once rather than every render. */
  const changed = useRef(onChange)
  useEffect(() => {
    changed.current = onChange
  }, [onChange])
  // Read once: the editor takes `content` only when it is created.
  const [initial] = useState(() => contentFor(value))

  const editor = useEditor({
    extensions: peekProseExtensions,
    content: initial,
    editorProps: {
      attributes: {
        class: cn(PEEK_EDITOR_CLASSES, 'min-h-12'),
        style: 'caret-color: var(--text-primary)',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const handler = () => {
      const text = serializeTiptapToText(editor)
      latest.current = text
      inFlight.current.add(text)
      changed.current(text)
    }
    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    if (inFlight.current.has(value)) {
      // Our own edit coming round, possibly late. Once it is the newest, the
      // draft has caught up and nothing older can still arrive.
      if (value === latest.current) inFlight.current = new Set([value])
      return
    }
    inFlight.current = new Set([value])
    latest.current = value
    editor.commands.setContent(contentFor(value), { emitUpdate: false })
  }, [editor, value])

  return (
    <div className={cn(WRITING_BOX_CLASSES, 'w-full')}>
      <div className="relative">
        <EditorContent editor={editor} />
        <SelectionToolbar editor={editor} />
        {!value && placeholder && (
          <div className="absolute inset-0 pointer-events-none text-body-2 text-text-muted">{placeholder}</div>
        )}
      </div>
    </div>
  )
}
