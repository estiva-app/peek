import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { hasConvex } from '@/api'
import { useDebug } from '@/lib/debug'
import { needsAttention } from '@/nostr/readStateDiff'
import { cn } from '@/lib/utils'

interface DebugMenuProps {
  anchorEl: HTMLElement | null
  onClose: () => void
}

export function DebugMenu({ anchorEl, onClose }: DebugMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { state, setDesk, setUnreads, setHuddles, setReadState } = useDebug()

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (anchorEl?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', click)
      document.removeEventListener('keydown', key)
    }
  }, [anchorEl, onClose])

  if (!anchorEl) return null
  const rect = anchorEl.getBoundingClientRect()

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
        zIndex: 50,
      }}
      className="w-[300px] bg-bg-elevated border border-border-default rounded-lg shadow-lg p-2 flex flex-col gap-1"
    >
      {/* Desk, Unreads and Huddles drive the MOCK dataset — on the real app they
          toggle nothing, and showing them would suggest otherwise (issue #6). */}
      {!hasConvex && <DebugSection title="Desk">
        <DebugRow
          label="Screener"
          options={[
            { label: 'Hidden', value: false },
            { label: 'Visible', value: true },
          ]}
          value={state.desk.showScreener}
          onChange={(v) => setDesk('showScreener', v)}
        />
        <DebugRow
          label="Screener items"
          options={[
            { label: '1', value: 1 as const },
            { label: '2', value: 2 as const },
          ]}
          value={state.desk.screenerItemsCount}
          onChange={(v) => setDesk('screenerItemsCount', v)}
        />
        <DebugRow
          label="Urgent"
          options={[
            { label: 'Hidden', value: false },
            { label: 'Visible', value: true },
          ]}
          value={state.desk.showUrgent}
          onChange={(v) => setDesk('showUrgent', v)}
        />
        <DebugRow
          label="Urgent items"
          options={[
            { label: '1', value: 1 as const },
            { label: '2', value: 2 as const },
          ]}
          value={state.desk.urgentItemsCount}
          onChange={(v) => setDesk('urgentItemsCount', v)}
        />
        <DebugRow
          label="Open work"
          options={[
            { label: 'Empty', value: false },
            { label: 'Data', value: true },
          ]}
          value={state.desk.openWorkHasData}
          onChange={(v) => setDesk('openWorkHasData', v)}
        />
        <DebugRow
          label="Starred"
          options={[
            { label: 'Empty', value: false },
            { label: 'Data', value: true },
          ]}
          value={state.desk.starredHasData}
          onChange={(v) => setDesk('starredHasData', v)}
        />
      </DebugSection>}

      {!hasConvex && <DebugSection title="Unreads">
        <DebugRow
          label="Topics"
          options={[
            { label: 'Hidden', value: false },
            { label: 'Visible', value: true },
          ]}
          value={state.unreads.topics}
          onChange={(v) => setUnreads('topics', v)}
        />
        <DebugRow
          label="People"
          options={[
            { label: 'Hidden', value: false },
            { label: 'Visible', value: true },
          ]}
          value={state.unreads.people}
          onChange={(v) => setUnreads('people', v)}
        />
      </DebugSection>}

      <DebugSection title="Read state">
        <DebugRow
          label="Dual-run vs relay"
          options={[
            { label: 'Off', value: false },
            { label: 'On', value: true },
          ]}
          value={state.readState.dualRun}
          onChange={(v) => setReadState('dualRun', v)}
        />
        <ReadStateDiffRow />
      </DebugSection>

      {!hasConvex && <DebugSection title="Huddles">
        <DebugRow
          label="Variant"
          options={[
            { label: 'Tabs', value: 1 as const },
            { label: 'Tree', value: 2 as const },
            { label: 'Inline', value: 3 as const },
          ]}
          value={state.huddles.variant}
          onChange={(v) => setHuddles('variant', v)}
        />
      </DebugSection>}
    </div>,
    document.body
  )
}

/**
 * The dual-run result (CRO-7 step 1).
 *
 * Two benign classes are expected forever — `relay-ahead` is the feature
 * working, and `local-ahead-recent` is a debounced publish in flight — so they
 * are counted quietly. What gets called out is the pair the cutover is gated on:
 * a persistent local-ahead (a lost publish, or a context id under the wrong
 * scheme) and a regression (the merge going backwards, which §11.4 forbids).
 */
function ReadStateDiffRow() {
  const { state, readStateDiff: report } = useDebug()
  if (!state.readState.dualRun) return null
  if (!report) {
    return (
      <div className="px-2 py-1.5 text-[11px] text-text-muted">
        No comparison yet — needs one relay fetch.
      </div>
    )
  }
  const persistent = report.divergences.filter((d) => d.kind === 'local-ahead-persistent')
  const benign = report.divergences.length - persistent.length
  const attention = needsAttention(report)
  return (
    <div className="px-2 py-1.5 flex flex-col gap-0.5 text-[11px]">
      <div className="text-text-secondary">
        {report.localCount} local · {report.relayCount} relay · {benign} benign
      </div>
      <div className={cn(attention ? 'text-warning-default' : 'text-text-muted')}>
        {attention
          ? `${persistent.length} unpublished · ${report.regressions.length} regressed`
          : 'Nothing outside the benign classes'}
      </div>
      {/* The context ids themselves, because "which one" is the whole question
          when a publish is being lost. Capped — a long list is a diff, not a menu. */}
      {persistent.slice(0, 3).map((d) => (
        <div key={d.context} className="text-text-muted font-mono truncate">
          {d.context.slice(0, 24)}… +{d.deltaSeconds}s
        </div>
      ))}
    </div>
  )
}

function DebugSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center h-7 px-2">
        <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide signal:font-mono signal:text-[10px] signal:tracking-[0.14em]">{title}</span>
      </div>
      {children}
    </div>
  )
}

interface DebugRowProps<T> {
  label: string
  options: { label: string; value: T }[]
  value: T
  onChange: (value: T) => void
}

function DebugRow<T>({ label, options, value, onChange }: DebugRowProps<T>) {
  return (
    <div className="flex items-center justify-between gap-2 h-9 px-2">
      <span className="text-[14px] text-text-primary">{label}</span>
      <div className="flex gap-0.5 rounded-md bg-bg-inset p-0.5 shrink-0">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2 py-0.5 rounded-sm text-[11px] font-medium transition-colors cursor-pointer',
              value === opt.value
                ? 'bg-bg-elevated text-text-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
