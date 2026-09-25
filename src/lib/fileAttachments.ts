/**
 * Upload policy + presentation helpers for real file attachments (Phase 5).
 *
 * The gate is by file EXTENSION, not MIME: browsers report `File.type` as ''
 * or an inconsistent value for `.md`, `.json`, `.zip`, so extension is the
 * only reliable signal. A hard executable blocklist wins over everything —
 * even if the allowlist broadens later, those never get through.
 */

/** 25 MB — 5× the avatar limit; documents/zips are legitimately larger. */
export const FILE_MAX_BYTES = 25 * 1024 * 1024

/** Extensions we accept (see the product ruling 2026-07-17). */
export const ALLOWED_EXTENSIONS = [
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg',
  // documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md', 'rtf',
  // data / archive
  'json', 'zip',
] as const

/** Always rejected, regardless of the allowlist — executables / scripts. */
export const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'msi', 'sh', 'app', 'scr', 'jar', 'ps1', 'vbs', 'dll',
] as const

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'svg'])

/** Lowercased extension without the dot (''/no-dot filenames → ''). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isImageAttachment(name: string, contentType?: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(name)) || (contentType?.startsWith('image/') ?? false)
}

/** `'2.4 MB'`, `'812 KB'`, `'340 bytes'`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/** A short type label for the chip (`'PDF'`, `'ZIP'`, `'DOCX'`, `'FILE'`). */
export function fileTypeLabel(name: string): string {
  const ext = fileExtension(name)
  return ext ? ext.toUpperCase() : 'FILE'
}

/**
 * What a file waiting in a composer says, in the terms the package's
 * `AttachmentCard` takes (`pending`, UIG-27) — the part of the old
 * `PendingAttachmentChip` that is Peek's own.
 *
 * Three states: **uploading**, **ready** (the card shows the size), and
 * **failed** (why, in place of the size).
 *
 * There was a fourth, **warning**, for a file that uploaded to Convex and not
 * to the relay (CON-12). The relay is the only destination since REM-7, so a
 * file it refused has failed.
 */
export function pendingAttachmentNote(file: { status: 'uploading' | 'done' | 'error'; error?: string }): {
  state: 'uploading' | 'ready' | 'failed'
  note?: string
} {
  if (file.status === 'error') return { state: 'failed', note: file.error }
  if (file.status === 'uploading') return { state: 'uploading' }
  return { state: 'ready' }
}

/**
 * A file on a sent message, in the terms the package's `AttachmentCard` takes
 * (UIG-35). Peek's own card is gone: the fetch, the full-screen viewer and the
 * save are the package's now, and this says which file, in Peek's words.
 *
 * **A relay file is a request, not a URL** — CON-12. Media GET is
 * authenticated, so an `<img src={mediaUrl}>` answers 401; `blobObjectUrl`
 * signs a `kind:24242` first, and is what the card is handed as `fetchImage`.
 * The card draws the *thumbnail* the relay generated and asks for the original
 * only when somebody opens it, so a thread of screenshots does not pull every
 * full-size file to draw them at 112px.
 *
 * During the optimistic window a file needs none of that: `previewUrl` is a
 * local object URL an `<img>` can load.
 */
export function postedAttachment(file: {
  name: string
  size: number
  contentType: string
  previewUrl?: string
  mediaUrl?: string
  thumbUrl?: string
}): {
  name: string
  size: number
  contentType: string
  src?: string
  href?: string
  remoteSrc?: string
  remoteFullSrc?: string
} {
  const local = file.previewUrl
  const image = isImageAttachment(file.name, file.contentType)
  if (local) return { name: file.name, size: file.size, contentType: file.contentType, src: image ? local : undefined, href: local }
  return {
    name: file.name,
    size: file.size,
    contentType: file.contentType,
    remoteSrc: file.thumbUrl ?? file.mediaUrl,
    remoteFullSrc: file.mediaUrl,
  }
}

/**
 * Client-side validation. Returns an error message to surface, or null when
 * the file is acceptable. The server trusts the client here (uploads are
 * viewer-gated) — this is UX, not a security boundary.
 */
export function validateFile(file: File): string | null {
  const ext = fileExtension(file.name)
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `${file.name} is an executable and can't be attached.`
  }
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `${fileTypeLabel(file.name)} files aren't supported.`
  }
  if (file.size > FILE_MAX_BYTES) {
    return `${file.name} is larger than ${formatBytes(FILE_MAX_BYTES)}.`
  }
  return null
}

/** `accept` attribute for the <input type=file> (dot-prefixed extensions). */
export const FILE_ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

/* ── Pasting an image (PEE-20) ─────────────────────────────────────────────
   A screenshot on the clipboard is a file with no name of its own, so the
   name has to be made here before `validateFile` — which judges by
   EXTENSION — can say anything about it. */

/** MIME → extension for the images the allowlist already accepts. */
const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
}

/** Names the browser invents for a clipboard image. Ours are better. */
const GENERIC_IMAGE_STEMS = new Set(['image', 'blob', 'unknown', 'untitled', 'screenshot'])

/**
 * An unlisted type falls back to its MIME subtype rather than to `png`, so an
 * image we do not accept refuses itself through the ordinary message instead
 * of arriving disguised as something we do.
 */
function extensionForImageType(contentType: string): string {
  const type = contentType.toLowerCase()
  return PASTED_IMAGE_EXTENSIONS[type] ?? type.split('/')[1]?.split('+')[0] ?? 'png'
}

/** `'Screenshot 2026-09-07 14-32-05.png'` — sortable, and legible in a chip. */
export function pastedImageName(contentType: string, at: Date = new Date(), index = 0): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  const nth = index > 0 ? ` (${index + 1})` : ''
  return `Screenshot ${stamp}${nth}.${extensionForImageType(contentType)}`
}

/** A real filename is kept; `image.png`, `blob` and '' are not names. */
function hasUsableName(name: string): boolean {
  const ext = fileExtension(name)
  if (!ext) return false
  const stem = name.slice(0, name.length - ext.length - 1).toLowerCase()
  return stem !== '' && !GENERIC_IMAGE_STEMS.has(stem)
}

/** As much of a `DataTransfer` as the paste path reads. */
export interface ClipboardSource {
  files?: ArrayLike<File> | null
  getData(format: string): string
}

/**
 * The images on the clipboard, named — `[]` when there is nothing to attach.
 *
 * **Text wins.** Copying a range from Excel, or anything from Word, puts a
 * rendered picture of it on the clipboard *beside* the text; attaching that
 * picture instead of pasting the text is the wrong answer every time. So
 * anything carrying text is left to the editor. A screenshot carries none and
 * lands here.
 *
 * Images only, per the ticket. A pasted PDF is not attached — the paperclip
 * takes those.
 */
export function pastedImages(source: ClipboardSource | null | undefined, at: Date = new Date()): File[] {
  if (!source) return []
  if (source.getData('text/plain').trim() !== '') return []
  const images = Array.from(source.files ?? []).filter((f) => f.type.toLowerCase().startsWith('image/'))
  let generated = 0
  return images.map((file) =>
    hasUsableName(file.name)
      ? file
      : new File([file], pastedImageName(file.type, at, generated++), {
          type: file.type,
          lastModified: file.lastModified,
        }),
  )
}
