import type { ResolvedSlot } from '@estiva-app/interop'
import { cn } from '@/lib/utils'

/**
 * Manifest colour names → Peek's own tokens. The mapping is Peek's business.
 *
 * A status is coloured text, not a pill.
 *
 * These four names are the manifest's, not Peek's: an owning app declares
 * `neutral | blue | green | muted` and the consumer decides what that means
 * here. Ship's vocabularies map Todo and Planned to neutral, In Progress to
 * blue, Done and Completed to green, Cancelled to muted.
 *
 * The backgrounds that used to be here — `bg-surface-raised`, `bg-info-subtle`,
 * `bg-success-subtle` — are not tokens this app defines, so Tailwind never
 * emitted them and no pill was ever drawn. Removed rather than replaced: text
 * is the intended treatment (2026-08-19), so the classes were describing
 * something nobody wanted.
 *
 * `text-text-tertiary` was dead in the same way, and that one *was* visible as a
 * fault: `muted` inherited the surrounding colour, so a cancelled item looked
 * ordinary. It maps to `--text-muted`, which is the token that name meant.
 */
const COLOUR: Record<string, string> = {
  neutral: 'text-text-secondary',
  blue: 'text-info-default',
  green: 'text-success-default',
  muted: 'text-text-muted',
}

/**
 * The status of an item from another app, such as In Progress or Done, shown as
 * coloured words.
 */
export function StatusPill({ slot, className }: { slot: ResolvedSlot; className?: string }) {
  return (
    <span
      className={cn(
        // 12px suits the row widget and the panel's dense property rows; the
        // details dialog reads its properties at body size, so the size is the
        // caller's to set.
        'inline-flex items-center text-caption font-medium',
        COLOUR[slot.colour ?? 'muted'] ?? COLOUR.muted,
        className,
      )}
    >
      {slot.value}
    </span>
  )
}
