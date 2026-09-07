/**
 * The files of a message being edited — PEE-16.
 *
 * An edit box holds two kinds of file at once: the ones the message already
 * has, which can be removed, and the ones just picked or pasted, which are
 * still uploading. This keeps both and can answer the only question the save
 * path asks — what is the list now.
 *
 * It exists as a hook, rather than as state in a card, because there are two
 * edit boxes (`ConversationCard` and `ThreadReplyCard`) and they are already
 * the same file written twice (COMPONENTS-PEEK F4). One hook and one chip row
 * is the version of this that does not make F4 worse.
 *
 * `begin`, `cancel` and `commit` are the three moments. Cancel is the one
 * worth reading twice: it puts the removed files back AND deletes the blobs
 * of anything attached during the edit, because a cancelled edit leaves
 * nothing behind — not on screen and not in storage.
 */
import { useState } from 'react'
import type { FileAttachment } from '@/api'
import { usePendingAttachments } from '@/lib/usePendingAttachments'

/** One file in the edit box, in the shape the chip renders. */
export interface EditAttachmentChip {
  key: string
  name: string
  size: number
  contentType?: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  previewUrl?: string
  onRemove: () => void
}

export interface EditAttachments {
  /** Render these, the message's own files first. */
  chips: EditAttachmentChip[]
  /** Validate and upload — the paperclip and the paste handler both call it. */
  add: (files: File[]) => void
  /** True while an upload is in flight: Save waits, so nothing is dropped. */
  isUploading: boolean
  /** How many files the message would have if saved now. */
  count: number
  /** The list to save, or undefined when this edit did not change it. */
  result: () => FileAttachment[] | undefined
  /** Entering edit: start from the message's files. */
  begin: () => void
  /** Cancelling: put the removed back, delete what was added. */
  cancel: () => void
  /** Saved: the message owns these blobs now, so leave storage alone. */
  commit: () => void
}

/** Same identity the message card uses for its own file list. */
const fileKey = (f: FileAttachment, i: number) => f.storageId ?? `${f.name}_${i}`

export function useEditAttachments(files: FileAttachment[] | undefined): EditAttachments {
  const [kept, setKept] = useState<FileAttachment[]>(files ?? [])
  const uploads = usePendingAttachments()

  const added = uploads.files
    .filter((f) => f.status === 'done' && f.uploaded)
    .map((f) => f.uploaded!)

  const current = (): FileAttachment[] => [
    ...kept,
    ...added.map((f) => ({
      storageId: f.storageId,
      previewUrl: f.previewUrl,
      name: f.name,
      contentType: f.contentType,
      size: f.size,
    })),
  ]

  const chips: EditAttachmentChip[] = [
    ...kept.map((f, i) => ({
      key: fileKey(f, i),
      name: f.name,
      size: f.size,
      contentType: f.contentType,
      status: 'done' as const,
      // A file already on the message has a resolved storage URL; during the
      // optimistic window only the local object URL exists (FileAttachmentCard
      // reads the same pair, in the same order).
      previewUrl: f.url ?? f.previewUrl,
      onRemove: () => setKept((prev) => prev.filter((_, j) => j !== i)),
    })),
    ...uploads.files.map((f) => ({
      key: f.localId,
      name: f.name,
      size: f.size,
      contentType: f.contentType,
      status: f.status,
      error: f.error,
      previewUrl: f.uploaded?.previewUrl,
      onRemove: () => uploads.remove(f.localId),
    })),
  ]

  return {
    chips,
    add: uploads.add,
    isUploading: uploads.isUploading,
    count: chips.length,
    result: () => {
      const next = current()
      const before = (files ?? []).map((f, i) => fileKey(f, i)).join('|')
      const after = next.map((f, i) => fileKey(f, i)).join('|')
      return before === after ? undefined : next
    },
    begin: () => setKept(files ?? []),
    cancel: () => {
      setKept(files ?? [])
      uploads.discard()
    },
    commit: () => uploads.clear(),
  }
}
