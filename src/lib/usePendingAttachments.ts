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
 * What it knows: check the file, upload it, and keep a row per file so the
 * chip can show uploading / done / failed.
 *
 * `clear` and `discard` are the two ends a picked file can come to: after a
 * send or a save the message owns the blobs (`clear`); after a cancel nothing
 * will (`discard`). They do the same thing since REM-7. `discard` used to
 * delete the Convex copy, and the relay's blob store has no delete, so an
 * unsent blob stays there unreferenced — as the relay's copy always did.
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
  /** Remove one chip. */
  remove: (localId: string) => void
  /** Descriptors that finished uploading, ready to attach. */
  ready: () => UploadedFile[]
  /** True while any upload is in flight — hold the send/save until it settles. */
  isUploading: boolean
  /** Forget the rows; the blobs now belong to a message. */
  clear: () => void
  /** Forget the rows; nothing will own the blobs. */
  discard: () => void
  /** Put back files a refused send took (OPT-7), first, as finished uploads: the relay holds them already. */
  restore: (uploaded: readonly UploadedFile[]) => void
}

export function usePendingAttachments(): PendingAttachments {
  const [files, setFiles] = useState<PendingUpload[]>([])
  const { uploadFile } = useUploadActions()

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

  const remove = (localId: string) => setFiles((prev) => prev.filter((f) => f.localId !== localId))

  return {
    files,
    ref,
    add,
    remove,
    ready: () => ref.current.filter((f) => f.status === 'done' && f.uploaded).map((f) => f.uploaded!),
    isUploading: files.some((f) => f.status === 'uploading'),
    clear: () => setFiles([]),
    discard: () => setFiles([]),
    restore: (uploaded) => {
      if (uploaded.length === 0) return
      const back = uploaded.map((u): PendingUpload => ({ localId: `u_${++uploadSeq}`, name: u.name, size: u.size, contentType: u.contentType, status: 'done', uploaded: u }))
      setFiles((prev) => [...back, ...prev])
    },
  }
}
