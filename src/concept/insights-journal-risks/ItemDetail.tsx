/**
 * CONCEPT — Insights, Journal and Risks (prototype issue 009bc509). An item's detail, beside its list or on its own
 * page, drawn from the same parts as the list it was opened from (Miky, 16 Nov: the details felt "out of touch"):
 * an Insight's category and its tool's chart or customer quote; an Update's measures and what it leaves open; a
 * Decision's brief; a Question's phase, options and decider; a Blocker's wait; a severity as its icon. Copied
 * unchanged into Leaf.
 */
import { useState } from 'react'
import { IconArchive, IconExternalLink, IconHourglass, IconSparkles, IconUsers } from '@tabler/icons-react'
import { Button, Card, Link, LinkPickers, MetaText, Select } from '@estiva-app/ui'
import { STATUSES, type Status } from './MarkAs'
import { AcceptReject, ItemTag, JournalExtras, SourceAsMarked, acceptedStatus } from './ItemParts'
import { DecideDialog, InsightVisual, QuestionOptions, SeverityMark, needs, waited } from './ItemKinds'
import { CATEGORIES, SEVERITIES, PEOPLE, type Item } from './fixtures'

/** An Insight sent by another tool on the protocol: its chart or quote is the source, live. */
export const fromTool = (item: Item) => item.source?.app === 'PostHog' || item.source?.app === 'Intercom'

/**
 * Where an item was used (Miky, 19 Nov: "memory shows where it was used"): each answer, summary or loop run that read
 * it into what it did, newest first, so a person sees why the AI said what it said and can fix the memory behind it.
 */
export interface Use { by: string; what: string; where: string; days: number }
export function usesOf(item: Item): Use[] {
  if (item.id.startsWith('peek-')) return []
  if (item.status === 'proposed')
    return item.category === 'Customer' ? [{ by: 'Claude', what: 'Answer to Katerina about the sidebar', where: 'Peek · Design', days: 2 }] : []
  if (fromTool(item)) return [{ by: 'Claude', what: 'Answer to Miky about activation', where: 'Peek · Direct messages', days: 1 }]
  if (item.type === 'journal')
    return [
      { by: 'Claude', what: 'Plan for Teams in Ship', where: 'Ship · Teams stage', days: 3 },
      { by: 'Leaf’s review loop', what: 'Checked Universal Navigation against it', where: 'Leaf · Estiva HQ', days: 6 },
    ]
  if (item.type === 'risk') return [{ by: 'Claude', what: 'Friday summary', where: 'Peek · Friday Meetings', days: 0 }]
  return [
    { by: 'Claude', what: 'Friday summary', where: 'Peek · Friday Meetings', days: 1 },
    { by: 'Ship’s triage loop', what: 'Filed “Sidebar folders collapse” under it', where: 'Ship · Bugs', days: 4 },
  ]
}
const ago = (days: number) => (days === 0 ? 'today' : `${days}d ago`)

/**
 * Proposed items fade (Miky, 19 Nov, as Linear archives what nobody touches): one nobody used or added for this long is
 * archived, out of every list and of what agents read, and anyone can restore it. Accepted items never fade; a person
 * or a dreaming loop marks them Outdated.
 */
export const FADE_DAYS = 30
const daysSince = (day: string) => Math.floor((Date.parse('2026-11-19') - Date.parse(day)) / 86_400_000)
const fadesIn = (item: Item) => FADE_DAYS - Math.min(daysSince(item.day), ...usesOf(item).map((u) => u.days))

/**
 * A loop's change to the item (Miky, 19 Nov: a loop may change an Accepted item, and someone is told to review it):
 * who changed it, what and why, with Undo. Whoever added the item gets an Activity line that opens it here.
 */
function LoopChange({ change }: { change: NonNullable<Item['changed']> }) {
  const [undone, setUndone] = useState(false)
  if (undone) return <MetaText tone="muted">Undone: it is back as it was.</MetaText>
  return (
    <Card fill="inset" className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-body-2 text-text-primary">
          <IconSparkles size={14} stroke={1.5} className="mr-1 inline" />
          {change.by} {change.what}
        </span>
        <span className="text-caption text-text-muted">{`${change.why} · ${change.ago}`}</span>
      </span>
      <Button variant="outlined" size="small" onClick={() => setUndone(true)}>
        Undo
      </Button>
    </Card>
  )
}

/** A Proposed item's fading: how long it has left, or, once archived, that it was and a way back. */
function Fading({ item }: { item: Item }) {
  const [restored, setRestored] = useState(false)
  const left = restored ? FADE_DAYS : fadesIn(item)
  if (left > 0)
    return (
      <MetaText tone="muted">
        <IconHourglass size={12} stroke={1.5} className="mr-1 inline" />
        Fades in {left} days unless used or added
      </MetaText>
    )
  return (
    <Card fill="inset" className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-body-2 text-text-primary">
          <IconArchive size={14} stroke={1.5} className="mr-1 inline" />
          Archived {-left} days ago
        </span>
        <span className="text-caption text-text-muted">{`Nobody used or added it in ${FADE_DAYS} days, so agents no longer read it.`}</span>
      </span>
      <Button variant="outlined" size="small" onClick={() => setRestored(true)}>
        Restore
      </Button>
    </Card>
  )
}

/** The item's receipts, under its content: every use, each a link to where it happened. */
export function ItemUses({ item }: { item: Item }) {
  const uses = usesOf(item)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-medium text-text-primary">Used{uses.length ? ` · ${uses.length}` : ''}</span>
      {uses.length ? (
        uses.map((u) => (
          <span key={u.what} className="flex min-w-0 flex-col">
            <Link href="#" variant="quiet">
              {u.what}
            </Link>
            <MetaText tone="muted">
              {u.by} · {u.where} · {ago(u.days)}
            </MetaText>
          </span>
        ))
      ) : (
        <MetaText tone="muted">Not used yet</MetaText>
      )}
    </div>
  )
}

/** What the detail is, as the list labels it: the word or category with its icon, and a risk's severity icon before it. */
export function ItemIdentity({ item }: { item: Item }) {
  return (
    <span className="flex items-center gap-2">
      {item.type === 'risk' && item.word !== 'Blocker' && <SeverityMark severity={item.severity} />}
      <ItemTag item={item} />
    </span>
  )
}

/**
 * An item's fields, each where the list showed it: the status with its type's words; the person a kind turns on (who
 * decided a Decision, who decides a Question, who a Blocker waits on); an Insight's category; a Concern's or a
 * Question's severity. Then one quiet line of where it lives and who marked it.
 */
export function ItemFields({ item, me = 'miky' }: { item: Item; me?: string }) {
  const [status, setStatus] = useState<Status>(item.status)
  const person = item.word === 'Decision' ? { p: item.decidedBy, label: 'Decided by' } : item.word === 'Question' ? { p: item.decider, label: 'Decides' } : item.word === 'Blocker' ? { p: item.waitingOn, label: 'Waiting on' } : undefined
  const [who, setWho] = useState(person?.p?.key)
  const [category, setCategory] = useState<string>(item.category ?? '')
  const [severity, setSeverity] = useState<string>(item.severity ?? '')
  const people = PEOPLE.map((p) => ({ value: p.key, label: p.name }))
  const waitingOn = status === 'proposed' && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LinkPickers
          status={{ value: status, options: STATUSES[item.type], onChange: (v) => setStatus(v as Status) }}
          {...(person ? { owner: { value: who, options: people, onChange: setWho }, ownerLabel: person.label } : {})}
        />
        {item.type === 'insight' && (
          <span className="w-32">
            <Select size="small" ariaLabel="Category" placeholder="Category" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </span>
        )}
        {item.type === 'risk' && item.word !== 'Blocker' && (
          <span className="w-32">
            <Select size="small" ariaLabel="Severity" placeholder="Severity" value={severity} onChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
          </span>
        )}
        {/* Whoever may answer a suggested item gets the button here too, not only in the list (review, 17 Nov). */}
        {status === 'proposed' && !waitingOn && (
          <span className="ml-auto">
            <AcceptReject onAnswer={(yes) => setStatus(yes ? acceptedStatus(item) : 'rejected')} />
          </span>
        )}
      </div>
      {/* Two short lines, never one long one: where it lives, then who added it. */}
      <div className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate">
          <MetaText tone="muted">
            <IconUsers size={12} stroke={1.5} className="mr-1 inline" />
            {item.team} · {item.about ? item.about.title : 'the team’s own'}
          </MetaText>
        </span>
        <span className="min-w-0 truncate">
          <MetaText tone="muted">
            Suggested by {item.markedBy.name}, {item.at}
            {item.acceptedBy && status !== 'proposed' ? ` · added by ${item.acceptedBy.name}` : ''}
          </MetaText>
        </span>
        {/* Why the AI marked it, in its own words: the black box opened (Miky, 19 Nov). */}
        {item.why && (
          <span className="min-w-0">
            <MetaText tone="muted">
              <IconSparkles size={12} stroke={1.5} className="mr-1 inline" />
              {item.why}
            </MetaText>
          </span>
        )}
      </div>
      {item.changed && <LoopChange change={item.changed} />}
      {waitingOn && <MetaText tone="muted">Waiting for {waitingOn} to add it</MetaText>}
      {status === 'proposed' && <Fading item={item} />}
    </div>
  )
}

/**
 * A Question's phase and next step, as its box's footer says it (Miky, 16 Nov), with Decide for its decider. Once
 * decided, the Decision it ended in.
 */
function QuestionPhase({ item, me, onDecide, deciding = false }: { item: Item; me: string; onDecide?: (choice: number, why: string) => void; deciding?: boolean }) {
  const [open, setOpen] = useState(deciding)
  if (item.decidedIn)
    return (
      <Card fill="inset" className="flex flex-col gap-0.5 px-3 py-2">
        <span className="text-body-2 text-text-muted">Decided, in the Journal</span>
        <Link href="#" variant="quiet">
          {item.decidedIn}
        </Link>
      </Card>
    )
  return (
    <Card fill="inset" className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-body-2 font-medium text-text-primary">{needs(item, me)}</span>
      {item.step === 'decide' && item.decider?.key === me && (
        <Button variant="primary" size="small" onClick={() => setOpen(true)}>
          Decide
        </Button>
      )}
      {(item.step ?? 'raised') === 'raised' && (
        <Button variant="outlined" size="small" leadingIcon={<IconSparkles size={14} stroke={1.5} />} onClick={() => undefined}>
          Research options
        </Button>
      )}
      {open && <DecideDialog item={item} onDecide={(c, why) => onDecide?.(c, why)} onClose={() => setOpen(false)} />}
    </Card>
  )
}

/** A Blocker's wait: what stops, and who has to act, for how long. */
function BlockerWait({ item }: { item: Item }) {
  return (
    <Card fill="inset" className="flex flex-col gap-1 px-3 py-2">
      {item.blocks && (
        <span className="text-body-2">
          <span className="text-text-muted">Stops: </span>
          {item.blocks}
        </span>
      )}
      {item.waitingOn && <span className="text-body-2 text-text-muted">Waiting {waited(item.day)}</span>}
    </Card>
  )
}

/**
 * The item's own content under its fields, kind by kind, as its list shows it. `words`: draw the summary and details
 * here (the side panel); the item page leaves them to its header and description.
 */
export function ItemContent({ item, me = 'miky', words = true, onDecide, deciding }: { item: Item; me?: string; words?: boolean; onDecide?: (choice: number, why: string) => void; deciding?: boolean }) {
  const tool = fromTool(item)
  const quote = item.visual?.kind === 'quote'
  return (
    <div className="flex flex-col gap-3">
      {item.word === 'Question' && item.status !== 'proposed' && <QuestionPhase item={item} me={me} onDecide={onDecide} deciding={deciding} />}
      {item.word === 'Blocker' && item.status !== 'proposed' && <BlockerWait item={item} />}
      {item.visual && (
        <Card fill="inset" className="flex flex-col p-3">
          <InsightVisual visual={item.visual} />
        </Card>
      )}
      {words && item.summary && !quote && !(item.word === 'Update' && item.details) && <span className="text-body-2 text-text-primary">{item.summary}</span>}
      {words && item.details && <span className="whitespace-pre-line text-body-2 text-text-secondary">{item.details}</span>}
      <JournalExtras item={item} />
      {item.word === 'Question' &&
        (item.options ? (
          <div className="flex flex-col gap-2">
            <span className="text-caption font-medium text-text-primary">Options{item.optionsBy ? ` · researched by ${item.optionsBy.name}` : ''}</span>
            <QuestionOptions options={item.options} full />
          </div>
        ) : (
          <MetaText tone="muted">No options yet.</MetaText>
        ))}
      {/* A tool's insight: its chart or quote is the source, so a link to it, not a copy as marked. */}
      {tool && item.source ? (
        <MetaText tone="muted">
          <span className="inline-flex items-center gap-1">
            {item.source.app} · {item.source.place}
            {!quote && ' · Updated 5 min ago'}
            <IconExternalLink size={12} stroke={1.5} />
          </span>
        </MetaText>
      ) : item.decision ? null : (
        <SourceAsMarked source={item.source} />
      )}
      <ItemUses item={item} />
    </div>
  )
}
