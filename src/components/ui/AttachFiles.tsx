/**
 * The two pieces every box that can hold a file needs — PEE-16.
 *
 * The composer had both written inline; the two message-edit boxes had a
 * paperclip with no handler behind it at all (COMPONENTS-PEEK F3, "ten
 * controls render and do nothing"). Rather than write the working version
 * twice more, it is here once and all three call it.
 */
import { useRef } from 'react'
import { IconPaperclip } from '@tabler/icons-react'
import { AttachmentCard, FilePicker, ToolbarButton } from '@estiva-app/ui'
import { FILE_ACCEPT_ATTR, pendingAttachmentNote } from '@/lib/fileAttachments'
import { hasConvex } from '@/api'
import type { EditAttachmentChip } from '@/lib/useEditAttachments'

/**
 * The paperclip, with the file picker it needs to mean anything.
 *
 * Uploads need storage, so it renders only against a live backend — the demo
 * build has none, and an action is offered only where it can succeed. That is
 * also why it returns null rather than rendering disabled: there is nothing
 * to explain to somebody who will never have the option.
 */
export function AttachFileButton({ onPick }: { onPick: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  if (!hasConvex) return null
  return (
    <>
      {/* Clears itself, so the same file can be re-picked; calls onPick only when something was chosen. */}
      <FilePicker ref={inputRef} multiple accept={FILE_ACCEPT_ATTR} onPick={onPick} />
      <ToolbarButton tooltip="Attach file" aria-label="Attach file" onClick={() => inputRef.current?.click()}>
        <IconPaperclip size={16} stroke={1.5} />
      </ToolbarButton>
    </>
  )
}

/** The chips under the text, in the order they were attached. */
export function AttachmentChips({ chips }: { chips: EditAttachmentChip[] }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <AttachmentCard
          key={c.key}
          pending
          name={c.name}
          size={c.size}
          contentType={c.contentType}
          src={c.previewUrl}
          onRemove={c.onRemove}
          {...pendingAttachmentNote(c)}
        />
      ))}
    </div>
  )
}
