/**
 * CONCEPT — Insights, Journal and Risks (prototype issue 009bc509). The parts a kind of item is drawn with, the same in
 * its list and in its detail (Miky, 16 Nov: the detail must feel like the list it was opened from): a tool's chart or
 * customer quote, a risk's severity, a question's options and phase, a blocker's wait. Copied unchanged into Leaf.
 */
import { useState } from 'react'
import { IconAlertSquareRoundedFilled, IconCircleCheckFilled, IconAntennaBars3, IconAntennaBars4, IconAntennaBars5, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react'
import { AvatarGroup, Card, Field, FormDialog, MetaText, Textarea, WithTooltip, cn } from '@estiva-app/ui'
import type { Item, Severity, Visual } from './fixtures'

/** A chart's range over it, as an analytics tool labels its tiles ("LAST 12 WEEKS"), and the latest value on the right. */
function ChartHead({ range, now }: { range: string; now?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-menu font-medium uppercase tracking-widest text-text-muted">{range}</span>
      {now && <span className="text-body-2 font-medium tabular-nums text-text-primary">{now}</span>}
    </div>
  )
}

/** A chart's two end dates under it. */
function ChartEnds({ labels }: { labels: [string, string] }) {
  return (
    <div className="flex justify-between">
      <MetaText tone="muted">{labels[0]}</MetaText>
      <MetaText tone="muted">{labels[1]}</MetaText>
    </div>
  )
}

/**
 * What an insight from another tool shows (Miky, 16 Nov: "make it more live"): PostHog's big number, bars or line,
 * drawn small in the accent colour, with the moment that changed it marked; a support desk's customer, in their words.
 */
export function InsightVisual({ visual }: { visual: Visual }) {
  if (visual.kind === 'number')
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-4">
        <ChartHead range={visual.range} />
        <span className="text-h2 font-semibold leading-none tabular-nums text-text-primary">{visual.value}</span>
        <span className={cn('flex items-center gap-1 text-body-2', (visual.good ?? visual.up) ? 'text-success-default' : 'text-error-default')}>
          {visual.up ? <IconTrendingUp size={16} stroke={1.5} /> : <IconTrendingDown size={16} stroke={1.5} />}
          {visual.change}
        </span>
      </div>
    )
  if (visual.kind === 'quote')
    return (
      <figure className="flex flex-1 flex-col justify-center gap-2 py-1">
        <blockquote className="text-body-1 font-normal leading-snug text-text-primary">“{visual.quote}”</blockquote>
        <figcaption>
          <MetaText tone="muted">
            {visual.customer}, {visual.company}
          </MetaText>
        </figcaption>
      </figure>
    )
  const max = Math.max(...visual.points) * 1.1
  const n = visual.points.length
  const last = visual.points[n - 1]
  const x = (i: number) => (visual.kind === 'bars' ? (i + 0.5) * (300 / n) : (i * 300) / (n - 1))
  const y = (v: number) => 100 - (v / max) * 100
  return (
    <div className="flex flex-col gap-1">
      <ChartHead range={visual.range} now={`${last}${visual.unit ?? ''} now`} />
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-28 w-full text-accent-primary" aria-label={`${visual.range}: ${visual.points.join(', ')}`}>
        {visual.kind === 'bars'
          ? visual.points.map((v, i) => (
              <rect key={i} x={x(i) - 300 / n / 2 + 3} width={300 / n - 6} y={y(v)} height={100 - y(v)} rx={1.5} fill="currentColor" opacity={visual.marker && i < visual.marker.at ? 0.35 : 1} />
            ))
          : (
            <>
              <polygon points={`0,100 ${visual.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} 300,100`} fill="currentColor" opacity={0.12} />
              <polyline points={visual.points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </>
          )}
        {visual.marker && <line x1={x(visual.marker.at) - (visual.kind === 'bars' ? 300 / n / 2 : 0)} x2={x(visual.marker.at) - (visual.kind === 'bars' ? 300 / n / 2 : 0)} y1={0} y2={100} stroke="currentColor" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="text-text-muted" />}
      </svg>
      <ChartEnds labels={visual.labels} />
      {visual.marker && <MetaText tone="muted">┆ {visual.marker.label}</MetaText>}
    </div>
  )
}

/**
 * A risk's severity as one icon, no word, as Linear shows priority (Miky, 16 Nov: "too many labels"): Critical a filled
 * red square with "!", the rest bars as a signal's strength; hover names it.
 */
export function SeverityMark({ severity }: { severity?: Severity }) {
  if (!severity) return <span className="text-text-muted">—</span>
  const look = {
    Critical: { icon: <IconAlertSquareRoundedFilled size={16} />, text: 'text-error-default' },
    High: { icon: <IconAntennaBars5 size={16} stroke={1.5} />, text: 'text-warning-default' },
    Medium: { icon: <IconAntennaBars4 size={16} stroke={1.5} />, text: 'text-text-secondary' },
    Low: { icon: <IconAntennaBars3 size={16} stroke={1.5} />, text: 'text-text-muted' },
  }[severity]
  return (
    <WithTooltip label={severity}>
      <span role="img" aria-label={severity} className={cn('flex items-center', look.text)}>
        {look.icon}
      </span>
    </WithTooltip>
  )
}

/** How long a blocker has been waiting, counted to the prototype's today. */
export const waited = (day: string) => {
  const n = Math.round((Date.parse('2026-11-16') - Date.parse(day)) / 864e5)
  return n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`
}

/** The question's phase in words, in the box's footer (Miky, 16 Nov: the footer says where it is, no row of steps): raised, options ready, in review, ready to decide. */
export const needs = (item: Item, me: string) => {
  const who = (p?: { key: string; name: string }) => (p ? (p.key === me ? 'you' : p.name) : 'someone')
  switch (item.step ?? 'raised') {
    case 'raised':
      return 'Needs its options researched'
    case 'options':
      return 'Options ready: needs your review'
    case 'review':
      return `In review · ${who(item.decider)} decide${who(item.decider) === 'you' ? '' : 's'} when it settles`
    case 'decide':
      return `Ready for ${who(item.decider)} to decide`
  }
}

/** An open question's options: a letter, the option and its one line, the one leaned to, who added it, and in review who favours it. */
export function QuestionOptions({ options, full = false }: { options: NonNullable<Item['options']>; full?: boolean }) {
  const letters = 'ABCDEF'
  return (
      <ol className="flex flex-col gap-2" aria-label="Options">
        {options.map((o, n) => (
          <li key={o.label} className="flex gap-2 text-body-2">
            <span className="w-4 shrink-0 font-medium text-text-muted">{letters[n]}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 font-medium">
                {o.label}
                {o.lean && <span className="text-caption text-accent-primary">Leaning</span>}
                {o.addedBy && <span className="text-caption font-normal text-text-muted">added by {o.addedBy.name}</span>}
              </span>
              <span className={cn('text-text-secondary', !full && 'line-clamp-2')}>{o.gist}</span>
            </span>
            {/* In review: who favours this option. */}
            {o.favouredBy && o.favouredBy.length > 0 && (
              <span className="mt-0.5 shrink-0">
                <AvatarGroup members={o.favouredBy.map((p) => ({ name: p.name, bot: p.bot }))} size={16} />
              </span>
            )}
          </li>
        ))}
      </ol>
  )
}

/**
 * Decide (Miky, 16 Nov: draw what happens after Decide): the kit's FormDialog, as Resolve is. Pick an option, the one
 * leant towards already picked, and say why if the gist does not; Decide writes the Decision into the Journal with
 * the options not chosen, and resolves the question.
 */
export function DecideDialog({ item, onDecide, onClose }: { item: Item; onDecide: (choice: number, why: string) => void; onClose: () => void }) {
  const options = item.options ?? []
  const [choice, setChoice] = useState(Math.max(0, options.findIndex((o) => o.lean)))
  const [why, setWhy] = useState('')
  const letters = 'ABCDEF'
  return (
    <FormDialog title="Decide" submitLabel="Decide" submitVariant="resolve" onSubmit={() => onDecide(choice, why)} onClose={onClose}>
      <span className="text-body-2 font-medium text-text-primary">{item.title}</span>
      {/* New here: the kit has no radio group yet, so each option is a card you press, the picked one selected. */}
      <div className="flex flex-col gap-2" aria-label="Options">
        {options.map((o, n) => (
          <Card key={o.label} fill="surface" hover="hairline" selected={n === choice} onPress={() => setChoice(n)} aria-label={`${letters[n]}: ${o.label}${n === choice ? ', chosen' : ''}`} className="flex gap-2 px-3 py-2">
            <span className="w-4 shrink-0 text-body-2 font-medium text-text-muted">{letters[n]}</span>
            <span className="flex min-w-0 flex-1 flex-col text-body-2">
              <span className="flex items-center gap-2 font-medium text-text-primary">
                {o.label}
                {o.lean && <span className="text-caption text-accent-primary">Leaning</span>}
              </span>
              <span className="text-text-secondary">{o.gist}</span>
            </span>
            {n === choice && <IconCircleCheckFilled size={18} className="shrink-0 text-accent-primary" />}
          </Card>
        ))}
      </div>
      <Field label="Why" helper="Optional. Goes into the Journal with the Decision.">
        <Textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={options[choice]?.gist} />
      </Field>
      <span className="text-caption text-text-muted">
        Writes “{options[choice]?.decision ?? options[choice]?.label}” into the Journal, decided by {item.decider?.name ?? 'you'}, with the {options.length - 1 === 1 ? 'option' : 'options'} not chosen. The question is resolved.
      </span>
    </FormDialog>
  )
}
