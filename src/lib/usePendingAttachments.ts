/**
 * One picked file's journey from the disk to a message — PEE-16.
 *
 * This was `ComposeBox`'s, and only `ComposeBox`'s, until the message-edit
 * boxes needed the same thing (the paperclip and the paste there did nothing
 * at all: COMPONENTS-PEEK F3). Three callers pasting the same sixty lines is
 * how `ConversationCard`, `ReplyCard` and `HuddleCard` became one card
 * drawn three times (F4), so the lines moved here first and the callers were
 * wired to them afterwards.
 *
 * What it knows: check the file, upload it, keep a row per file so the chip
 * can show uploading / done / failed, and never leave a blob in storage that
 * no message will ever own.
 *
 * `clear` and `discard` are the two ends a picked file can come to and they
 * are NOT the same. After a send or a save the message owns the blobs, so the
 * rows are forgotten and storage is left alone — `clear`. After a cancel, or
 * a chip removed by hand, nothing will ever own them, so they are deleted —
 * `discard`. Calling `clear` where `discard` belongs leaks a blob per cancel.
 */
import { useRef, useState } from 'react'
import { useUploadActions, type UploadedFile } from '@/api'
import { validateFile } from '@/lib/fileAttachments'

/** One picked file's lifecycle. */
export interface PendingUpload {
  localId: string
  name: string
  size: number
  contentType: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  uploaded?: UploadedFile
}

let uploadSeq = 0

export interface PendingAttachments {
  /** Render these as chips, in order. */
  files: PendingUpload[]
  /** The same list, readable from an editor closure that captured render one. */
  ref: React.MutableRefObject<PendingUpload[]>
  /** Validate and start uploading each; failures become an error chip. */
  add: (files: File[]) => void
  /** Remove one chip and delete its blob if it had already landed. */
  remove: (localId: string) => void
  /** Descriptors that finished uploading, ready to attach. */
  ready: () => UploadedFile[]
  /** True while any upload is in flight — hold the send/save until it settles. */
  isUploading: boolean
  /** Forget the rows; the blobs now belong to a message. */
  clear: () => void
  /** Forget the rows AND delete their blobs; nothing will own them. */
  discard: () => void
}

export function usePendingAttachments(): PendingAttachments {
  const [files, setFiles] = useState<PendingUpload[]>([])
  const { uploadFile, deleteUpload } = useUploadActions()

  // The editors' `handlePaste` and `handleKeyDown` are closures from the first
  // render, so they read the list through a ref rather than through `files`.
  const ref = useRef<PendingUpload[]>([])
  ref.current = files

  const add = (picked: File[]) => {
    for (const file of picked) {
      const localId = `u_${++uploadSeq}`
      const err = validateFile(file)
      if (err) {
        setFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'error', error: err }])
        continue
      }
      setFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'uploading' }])
      uploadFile(file).then(
        (uploaded) => setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'done', uploaded } : f))),
        (e: unknown) =>
          setFiles((prev) =>
            prev.map((f) => (f.localId === localId ? { ...f, status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' } : f)),
          ),
      )
    }
  }

  const remove = (localId: string) => {
    setFiles((prev) => {
      const slot = prev.find((f) => f.localId === localId)
      // A successfully-uploaded blob that never got sent must be cleaned up.
      if (slot?.uploaded) deleteUpload(slot.uploaded.storageId)
      return prev.filter((f) => f.localId !== localId)
    })
  }

  const discard = () => {
    setFiles((prev) => {
      for (const f of prev) if (f.uploaded) deleteUpload(f.uploaded.storageId)
      return []
    })
  }

  return {
    files,
    ref,
    add,
    remove,
    ready: () => ref.current.filter((f) => f.status === 'done' && f.uploaded).map((f) => f.uploaded!),
    isUploading: files.some((f) => f.status === 'uploading'),
    clear: () => setFiles([]),
    discard,
  }
}
