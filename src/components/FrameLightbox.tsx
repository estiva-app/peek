import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { FrameArt } from './ui/FrameArt'
import { frameBreadcrumb, type FigmaFrame } from '@/api'
import figmaIcon from '@/assets/figma icon.svg'

interface FrameLightboxProps {
  frame: FigmaFrame
  onClose: () => void
  /** Optional primary action (e.g. "Insert" from the launcher's find flow). */
  actionLabel?: string
  onAction?: () => void
}

/* eslint-disable better-tailwindcss/no-restricted-classes --
   A lightbox is a black scrim with white type on it, whatever theme the app is
   wearing: the thing being looked at is the picture, and a surface token would
   tint it. There is no token for this because the package has no Lightbox yet
   — ADOPTION B22, stage 7 — and when it does, this file goes. */

/** Full-screen preview of a Figma frame - opened from the launcher's frame
 *  picker or by clicking an attachment on a message. */
export function FrameLightbox({ frame, onClose, actionLabel, onAction }: FrameLightboxProps) {
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/80" onClick={onClose}>
      {/* Header */}
      <div
        className="h-14 flex items-center justify-between pl-5 pr-4 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <img src={figmaIcon} width={20} height={20} alt="Figma" className="rounded-[4px] shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-medium leading-[1.3] text-white truncate">{frame.name}</span>
            <span className="text-[12px] leading-[1.2] text-white/60 truncate">{frameBreadcrumb(frame)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actionLabel && onAction && (
            <Button variant="primary" size="small" onClick={onAction}>{actionLabel}</Button>
          )}
          <IconButton tooltip="Close" tooltipPlacement="bottom" aria-label="Close preview" onClick={onClose} className="text-white">
            <IconX size={16} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      {/* Frame */}
      <div className="flex-1 flex items-center justify-center p-8 min-h-0">
        <div onClick={(e) => e.stopPropagation()}>
          <FrameArt
            frame={frame}
            className={frame.kind === 'mobile' ? 'h-[70vh]' : 'w-[70vw] max-w-[900px]'}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
