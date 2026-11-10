import { Popover, SectionLabel } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { useReadStateSize, type ReadStateSize } from '@/nostr/useReadStateSync'

/**
 * The Read state panel from the account menu: how full read state is, and
 * whether anything has been dropped to keep it under the ceiling.
 *
 * It also held the dual-run comparison with Convex (CRO-7) until REM-5 made the
 * NIP-RS blob the only store, leaving nothing to compare it with.
 *
 * A `Popover` rather than a `Menu`: it holds a readout, and a menu is a list of
 * verbs you choose one of (P26).
 *
 * Rendered always and opened with `open`, as the package's Popover page asks
 * (UIG-14): mounted only while open, Base UI's exits go with it, and Escape
 * and re-opening become intermittent. What it reads is read inside, so a
 * closed panel reads nothing.
 */
export function ReadStatePanel({ anchor, open, onClose }: { anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  return (
    <Popover
      anchor={anchor}
      open={open && anchor !== null}
      onOpenChange={(next) => { if (!next) onClose() }}
      side="bottom"
      align="right"
      ariaLabel="Read state"
      // No padding here: the package pads the content 8px, and a `p-2` on the
      // panel was added to it from 0.12.6 on (migration docs D68, Finding 60).
      className="w-[300px] gap-2"
    >
      <SectionLabel>Read state</SectionLabel>
      <Size />
    </Popover>
  )
}

/** The size readout, wired to the tab's merged frontier. */
function Size() {
  return <SizeReadout {...useReadStateSize()} />
}

/**
 * How close read state is to the ceiling, and whether anything has been dropped
 * to keep it there (SHR-4).
 *
 * **This is the visible half of the cap, and the reason it is not a `console.warn`.**
 * The blob is replaced whole or not at all, so one context past the 65,535-byte
 * plaintext limit stops *every* later read marker from advancing, not just that
 * one. SHR-4 made that impossible by dropping the oldest markers instead — which
 * trades a silent, total failure for a small, local loss, and a loss nobody can
 * see is how the first failure would have gone unnoticed too.
 *
 * It needs no relay fetch of its own — it reads what the last merge left behind.
 *
 * Pure, and takes what {@link useReadStateSize} returns, so the three states a
 * person can be in are a story rather than a thing to wait for.
 */
export function SizeReadout({ contexts, bytes, pctOfCeiling, ceilingBytes, slotBytes, evicted }: ReadStateSize) {
  // 80 % is the point worth saying something at: the measured production slot
  // sits at 37 %, and the gap between them is hundreds of `thread:` keys.
  const pressured = pctOfCeiling >= 80
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-caption text-text-secondary">
        {contexts.toLocaleString()} contexts · {bytes.toLocaleString()} of{' '}
        {ceilingBytes.toLocaleString()} bytes
        {slotBytes === undefined ? '' : ` · this slot ${slotBytes.toLocaleString()}`}
      </p>
      <p
        className={cn('text-caption', evicted > 0 || pressured ? 'text-warning-default' : 'text-text-muted')}
      >
        {evicted > 0
          ? `${pctOfCeiling}% of the ceiling · ${evicted} oldest marker${evicted === 1 ? '' : 's'} dropped to stay under it`
          : pressured
            ? `${pctOfCeiling}% of the ceiling · the oldest markers will start dropping`
            : `${pctOfCeiling}% of the ceiling`}
      </p>
    </div>
  )
}
