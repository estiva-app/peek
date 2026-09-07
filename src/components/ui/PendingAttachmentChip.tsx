/**
 * A file in the composer, on its way to a message.
 *
 * Three states and nothing else: **uploading** (spinner), **ready** (an image
 * shows itself, anything else shows its type), and **failed** (why, in place
 * of the size). Removing one is the corner X, which appears on hover.
 *
 * Lifted out of `ComposeBox` with its markup unchanged — COMPONENTS-PEEK F15,
 * where this chip is one of four hand-drawn copies of the same card. It was
 * inline, so the only way to see any of its states was a live app with a
 * backend behind it. It has stories now, which is how it gets reviewed.
 */
import { IconAlertCircle, IconLoader2, IconX } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { formatBytes, fileTypeLabel, isImageAttachment } from '@/lib/fileAttachments'

export interface PendingAttachmentChipProps {
  name: string
  size: number
  contentType?: string
  status: 'uploading' | 'done' | 'error'
  /** Shown in place of the size when the upload failed. */
  error?: string
  /** A local object URL: the image is there before the server resolves one. */
  previewUrl?: string
  onRemove: () => void
}

/**
 * The round X on the corner of an attachment.
 *
 * Shared with the frame card beside it in the composer, where the same class
 * string was written a second time (F15). It fades in with the hover of the
 * card it sits on, so that card must be `group relative`.
 */
export function AttachmentRemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    >
      <IconX size={11} stroke={1.75} />
    </button>
  )
}

export function PendingAttachmentChip({
  name,
  size,
  contentType,
  status,
  error,
  previewUrl,
  onRemove,
}: PendingAttachmentChipProps) {
  const isImage = isImageAttachment(name, contentType)
  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 w-[200px] rounded-lg border bg-bg-elevated p-1.5 pr-3',
        status === 'error' ? 'border-error-default' : 'border-border-default',
      )}
    >
      <div className="size-9 rounded-md bg-bg-active flex items-center justify-center shrink-0 overflow-hidden text-text-secondary">
        {status === 'uploading' ? (
          <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
        ) : status === 'error' ? (
          <IconAlertCircle size={16} stroke={1.5} className="text-error-default" />
        ) : isImage && previewUrl ? (
          <img src={previewUrl} alt={name} className="size-full object-cover" />
        ) : (
          <span className="text-[9px] font-semibold">{fileTypeLabel(name)}</span>
        )}
      </div>
      <div className="flex flex-col gap-[1px] min-w-0">
        <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{name}</span>
        <span
          className={cn(
            'text-[10px] leading-[1.2] truncate',
            status === 'error' ? 'text-error-default' : 'text-text-secondary',
          )}
        >
          {status === 'error' ? error : status === 'uploading' ? 'Uploading…' : formatBytes(size)}
        </span>
      </div>
      <AttachmentRemoveButton label={`Remove ${name}`} onRemove={onRemove} />
    </div>
  )
}
