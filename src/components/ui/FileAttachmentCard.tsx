import { useEffect, useState } from 'react'
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
import { blobObjectUrl } from '@/nostr/media'

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

/**
 * The bytes of a relay-hosted attachment, as an object URL — CON-12.
 *
 * Peek's own files need none of this: Convex hands back a URL an `<img>` can
 * load. A file that arrived from another app has only a relay path, and media
 * GET is authenticated — so it is a *request*, which is why something that
 * looks like a plain image has a loading state and a way to fail.
 *
 * `undefined` for `mediaUrl` means "not this kind of file", so the hook is
 * called unconditionally and simply does nothing.
 */
function useRelayBlob(mediaUrl: string | undefined) {
  /*
    One state, and it remembers which file it is *about*.

    The obvious shape — a `url` and a `failed`, both cleared at the top of the
    effect — sets state synchronously during an effect, which the lint rejects
    for a good reason: it is a second render every time this card is handed a
    different file. Recording the URL the result belongs to costs nothing and
    lets a stale answer be ignored during render instead of erased afterwards.
  */
  const [result, setResult] = useState<{ for?: string; url?: string; failed?: boolean }>({})

  useEffect(() => {
    if (!mediaUrl) return
    let live = true
    blobObjectUrl(mediaUrl)
      .then((url) => {
        if (live) setResult({ for: mediaUrl, url })
      })
      .catch(() => {
        if (live) setResult({ for: mediaUrl, failed: true })
      })
    return () => {
      live = false
    }
  }, [mediaUrl])

  // An answer about a file this card is no longer showing is not an answer.
  const current = result.for === mediaUrl
  return { url: current ? result.url : undefined, failed: current ? !!result.failed : false }
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
  const local = file.url ?? file.previewUrl
  /*
    A file from another app — CON-12. It has a relay path and no blob here, so
    its bytes are fetched with the viewer's own authorization.

    The card draws the **thumbnail** the relay generated, and the full image is
    fetched only when the lightbox opens: a thread of screenshots would
    otherwise pull every original at full size to show them at 180px.
  */
  const fromRelay = !local && !!file.mediaUrl
  const preview = useRelayBlob(fromRelay ? (file.thumbUrl ?? file.mediaUrl) : undefined)
  const full = useRelayBlob(fromRelay && lightbox ? file.mediaUrl : undefined)

  const href = local ?? preview.url
  // While the original loads, the lightbox shows the thumbnail rather than
  // nothing: a moment of a smaller image beats a moment of an empty screen.
  const fullHref = local ?? full.url ?? preview.url
  const isImage = isImageAttachment(file.name, file.contentType)

  /** Download control (shared IconButton) — only when the file has a URL.
   *  Fades in on card hover (or keyboard focus); it keeps its layout slot so
   *  revealing it never shifts the row. */
  const downloadButton = href || fromRelay ? (
    <IconButton
      variant="muted"
      tooltip="Download"
      aria-label={`Download ${file.name}`}
      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation()
        /*
          A relay file downloads the **original**, never the thumbnail that is
          on screen — `href` may be the thumb. Fetching it here rather than
          reusing `full` keeps the download off the lightbox's state: someone
          can save a file they never opened.
        */
        if (fromRelay && file.mediaUrl) {
          // The rejection handler is not decoration: without it a refused read
          // is an unhandled rejection in the page rather than a download that
          // did not happen.
          void blobObjectUrl(file.mediaUrl).then(
            (resolved) => downloadFile(resolved, file.name),
            () => {},
          )
          return
        }
        if (href) void downloadFile(href, file.name)
      }}
    >
      <IconDownload size={16} stroke={1.5} />
    </IconButton>
  ) : null

  /*
    An image from the relay that is not on screen yet, and one that will not be.

    Both are said rather than shown as a gap. The message *claims* an image is
    attached, so a card that quietly rendered nothing would read as a sender who
    forgot it — and the likeliest refusal here is `relay_membership_required`,
    which is a real answer about a channel this viewer is not in rather than a
    bug. Falling through to the compact file row would say "this is a document",
    which it is not.
  */
  if (isImage && fromRelay && !href) {
    if (preview.failed) {
      return (
        <div
          data-attachment="unreadable"
          className={cn(
            'flex items-center gap-2 w-[240px] rounded-lg border border-border-subtle bg-bg-inset p-1.5 opacity-70',
            className,
          )}
        >
          <div className="size-9 rounded-md bg-bg-active flex items-center justify-center shrink-0 text-text-secondary">
            <FileIcon name={file.name} />
          </div>
          <div className="flex flex-col gap-[1px] min-w-0 text-left">
            <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{file.name}</span>
            <span className="text-[10px] leading-[1.2] text-text-secondary truncate">Could not be loaded</span>
          </div>
        </div>
      )
    }
    return (
      <div
        data-attachment="loading"
        aria-busy="true"
        aria-label={`Loading ${file.name}`}
        className={cn('w-[180px] h-28 rounded-lg border border-border-subtle bg-bg-inset animate-pulse', className)}
      />
    )
  }

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
        {lightbox && fullHref && <ImageLightbox src={fullHref} alt={file.name} onClose={() => setLightbox(false)} />}
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
