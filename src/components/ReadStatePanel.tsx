import { Checkbox, Popover, SectionLabel } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { useDebug } from '@/lib/debug'
import { needsAttention } from '@/nostr/readStateDiff'
import { useReadStateSize, type ReadStateSize } from '@/nostr/useReadStateSync'

/**
 * The dual-run read-state comparison (Jan, CRO-7 step 1, 2026-09-01).
 *
 * **It used to live in the debug panel, and D48 deleted that panel with it.**
 * That was a miss rather than the ruling: the panel's other sections drove the
 * mock dataset and were the reason it went, while this is a diagnostic on real
 * data — the only readout for whether read state can be cut over to the relay.
 * The dual run itself never stopped: it has kept running on every sync and
 * writing a report nothing could display (Katerina noticed the row was gone,
 * 2026-09-11).
 *
 * It is back on its own, reached from the same place it was reached from — the
 * "Read state" row in the account menu, which is the only way in on the real app
 * because the debug button was always hidden there.
 *
 * A `Popover` rather than a `Menu`: it holds a switch and a readout, and a menu
 * is a list of verbs you choose one of (P26, the same reason the selection
 * toolbar stopped being one).
 */
export function ReadStatePanel({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { state, setReadState } = useDebug()
  return (
    <Popover
      anchor={anchor}
      open={anchor !== null}
      onOpenChange={(next) => { if (!next) onClose() }}
      side="bottom"
      align="right"
      ariaLabel="Read state"
      // No padding here: the package pads the content 8px, and a `p-2` on the
      // panel was added to it from 0.12.6 on (migration docs D68, Finding 60).
      className="w-[300px] gap-2"
    >
      <SectionLabel>Read state</SectionLabel>
      {/* The words are the Checkbox's own `label` (UIG-7): part of the target, and its name. */}
      <Checkbox
        checked={state.readState.dualRun}
        onChange={(next) => setReadState('dualRun', next)}
        label="Compare with the relay on every sync"
      />
      <Size />
      <Report />
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
 * Shown whether or not the dual run is on: it is a fact about this person's read
 * state rather than about the comparison. Unlike `Report` below it needs no relay
 * fetch of its own — it reads what the last merge left behind.
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

/**
 * What the last comparison found.
 *
 * Two classes are expected forever — `relay-ahead` is the feature working, and
 * `local-ahead-recent` is a debounced publish still in flight — so they are
 * counted quietly. What is called out is the pair the cutover is gated on: a
 * persistent local-ahead (a lost publish, or a context id under the wrong
 * scheme) and a regression (the merge going backwards, which §11.4 forbids).
 */
function Report() {
  const { state, readStateDiff: report } = useDebug()
  if (!state.readState.dualRun) return null
  if (!report) return <p className="text-caption text-text-muted">No comparison yet — it needs one relay fetch.</p>
  const persistent = report.divergences.filter((d) => d.kind === 'local-ahead-persistent')
  const benign = report.divergences.length - persistent.length
  const attention = needsAttention(report)
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-caption text-text-secondary">
        {report.localCount} local · {report.relayCount} relay · {benign} benign
      </p>
      <p className={cn('text-caption', attention ? 'text-warning-default' : 'text-text-muted')}>
        {attention
          ? `${persistent.length} unpublished · ${report.regressions.length} regressed`
          : 'Nothing outside the benign classes'}
      </p>
      {/* The context ids themselves, because "which one" is the whole question
          when a publish is being lost. Capped — a long list is a diff, not a panel. */}
      {persistent.slice(0, 3).map((d) => (
        <p key={d.context} className="truncate font-mono text-caption text-text-muted">
          {d.context.slice(0, 24)}… +{d.deltaSeconds}s
        </p>
      ))}
    </div>
  )
}
