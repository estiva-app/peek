import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconFile,
  IconFileTypePdf,
  IconFileTypeDocx,
  IconFileTypeXls,
  IconFileTypePpt,
  IconFileTypeCsv,
  IconFileTypeZip,
  IconFileTypeTxt,
  IconJson,
  IconMarkdown,
  IconX,
  IconDownload,
} from '@tabler/icons-react'
import { fileExtension, isImageAttachment, formatBytes, fileTypeLabel } from '@/lib/fileAttachments'
import type { FileAttachment } from '@/api'
import { IconButton } from './IconButton'
import { cn } from '@/lib/utils'

/** Force a real save of a (possibly cross-origin) storage file: fetch the
 *  blob, hand it to a temporary <a download>, revoke. Falls back to opening
 *  in a new tab if the fetch is blocked (e.g. CORS). */
async function downloadFile(url: string, name: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

const ICON_BY_EXT: Record<string, React.FC<{ size?: number; stroke?: number; className?: string }>> = {
  pdf: IconFileTypePdf,
  doc: IconFileTypeDocx,
  docx: IconFileTypeDocx,
  xls: IconFileTypeXls,
  xlsx: IconFileTypeXls,
  ppt: IconFileTypePpt,
  pptx: IconFileTypePpt,
  csv: IconFileTypeCsv,
  txt: IconFileTypeTxt,
  rtf: IconFileTypeTxt,
  zip: IconFileTypeZip,
  json: IconJson,
  md: IconMarkdown,
}

function FileIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_BY_EXT[fileExtension(name)] ?? IconFile
  return <Icon size={20} stroke={1.5} className={className} />
}

/** A simple full-screen viewer for uploaded images (mirrors FrameLightbox). */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return createPortal(
    /* eslint-disable-next-line better-tailwindcss/no-restricted-classes -- the
       same black scrim as FrameLightbox, for the same reason, and it goes the
       same way when the package gains a Lightbox (ADOPTION B22, stage 7). */
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-8" onClick={onClose}>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        aria-label="Close"
        className="absolute top-4 right-4 size-8 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary"
        onClick={onClose}
      >
        <IconX size={16} stroke={1.5} />
      </button>
    </div>,
    document.body,
  )
}

interface FileAttachmentCardProps {
  file: FileAttachment
  className?: string
}

/**
 * A rendered file attachment on a message/reply card. Images show a thumbnail
 * and open in a lightbox; other types show a type icon + name + size and open
 * in a new tab (download). `url` is the resolved storage URL; during the
 * optimistic window only `previewUrl` (a local object URL) may exist.
 */
export function FileAttachmentCard({ file, className }: FileAttachmentCardProps) {
  const [lightbox, setLightbox] = useState(false)
  const href = file.url ?? file.previewUrl
  const isImage = isImageAttachment(file.name, file.contentType)

  /** Download control (shared IconButton) — only when the file has a URL.
   *  Fades in on card hover (or keyboard focus); it keeps its layout slot so
   *  revealing it never shifts the row. */
  const downloadButton = href ? (
    <IconButton
      variant="muted"
      tooltip="Download"
      aria-label={`Download ${file.name}`}
      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation()
        void downloadFile(href, file.name)
      }}
    >
      <IconDownload size={16} stroke={1.5} />
    </IconButton>
  ) : null

  if (isImage && href) {
    return (
      <>
        <div
          data-interactive
          className={cn(
            'group relative flex flex-col w-[180px] rounded-lg border border-border-subtle overflow-hidden bg-bg-inset hover:border-border-default transition-colors',
            className,
          )}
        >
          <button
            type="button"
            className="block w-full"
            aria-label={`Preview ${file.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setLightbox(true)
            }}
          >
            <img src={href} alt={file.name} className="w-full h-28 object-cover" />
          </button>
          <div className="flex items-center gap-1 pl-2 pr-1 py-1 min-w-0">
            <span className="flex-1 text-[12px] leading-[1.3] text-text-primary truncate">{file.name}</span>
            {downloadButton}
          </div>
        </div>
        {lightbox && <ImageLightbox src={href} alt={file.name} onClose={() => setLightbox(false)} />}
      </>
    )
  }

  // Non-image (or image without a URL yet): a compact file row. The body opens
  // the file in a new tab (preview); the trailing IconButton downloads it.
  const body = (
    <>
      <div className="size-9 rounded-md bg-bg-active flex items-center justify-center shrink-0 text-text-secondary">
        <FileIcon name={file.name} />
      </div>
      <div className="flex flex-col gap-[1px] min-w-0 text-left">
        <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{file.name}</span>
        <span className="text-[10px] leading-[1.2] text-text-secondary truncate">
          {fileTypeLabel(file.name)} · {formatBytes(file.size)}
        </span>
      </div>
    </>
  )

  return (
    <div
      data-interactive
      className={cn(
        'group flex items-center gap-2 w-[240px] rounded-lg border border-border-subtle bg-bg-inset p-1.5 pr-1 transition-colors',
        href ? 'hover:border-border-default' : 'opacity-70',
        className,
      )}
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </a>
      ) : (
        <div className="flex items-center gap-2 min-w-0 flex-1">{body}</div>
      )}
      {downloadButton}
    </div>
  )
}
