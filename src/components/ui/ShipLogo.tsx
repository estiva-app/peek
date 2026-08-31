import { cn } from '@/lib/utils'

/**
 * A mark for Ship, drawn here because Ship has none: the repo ships no icon,
 * no favicon and no logo component anywhere (checked 2026-08-31 — `ship/` and
 * `ship/web/` both). A plain letter-S stroke in `text-logo`, sized like
 * `PeekLogoMark` (Katerina 2026-08-31: a lettermark, not a pictogram).
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
      <path
        d="M16.6 7c0-2.1-2.1-3.4-4.6-3.4S7.4 4.9 7.4 7c0 4.8 9.2 3 9.2 10 0 2.1-2.1 3.4-4.6 3.4S7.4 19.1 7.4 17"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
