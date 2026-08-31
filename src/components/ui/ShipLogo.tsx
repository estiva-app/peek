import { cn } from '@/lib/utils'

/**
 * A mark for Ship, drawn here because Ship has none: the repo ships no icon,
 * no favicon and no logo component anywhere (checked 2026-08-31 — `ship/` and
 * `ship/web/` both). The launcher's app rows need one, so this is a simple
 * sail-and-hull glyph in `text-logo`, sized like `PeekLogoMark`.
 *
 * A PLACEHOLDER on purpose: when Ship gets a real identity, this file is the
 * only place to swap it.
 */
export function ShipLogoMark({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <svg
      width={height}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-logo shrink-0', className)}
      aria-label="Ship"
      role="img"
    >
      {/* Main sail */}
      <path d="M13 2.5C13 2.5 19.5 6.5 20 13H13V2.5Z" fill="currentColor" />
      {/* Foresail */}
      <path d="M11 5.5V13H5.5C6.5 9 9 6.5 11 5.5Z" fill="currentColor" />
      {/* Hull */}
      <path
        d="M2.5 15.5H21.5L19 20C18.6 20.9 17.7 21.5 16.7 21.5H7.3C6.3 21.5 5.4 20.9 5 20L2.5 15.5Z"
        fill="currentColor"
      />
    </svg>
  )
}
