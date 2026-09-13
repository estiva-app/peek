import { Checkbox, Popover, SectionLabel } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { useDebug } from '@/lib/debug'
import { needsAttention } from '@/nostr/readStateDiff'

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
      {/* The box carries the switch, the label names it, and the `<label>` makes
          the words part of the target — the package's Checkbox draws the box and
          nothing else, by design (her "checkbox in a row" ruling). */}
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={state.readState.dualRun}
          onChange={(next) => setReadState('dualRun', next)}
        />
        <span className="text-body-2 text-text-primary">Compare with the relay on every sync</span>
      </label>
      <Report />
    </Popover>
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
