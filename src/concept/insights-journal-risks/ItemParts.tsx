/**
 * CONCEPT — the parts Ship's Insights, Journal and Risks tabs draw. One entry and one timeline for all three
 * (Miky, 16 Nov: "simplify our UX elements so we don't have so many different UX concepts"):
 * - an item reads as a conversation message: face, name, its tag (as Peek's mark label), when and where in the
 *   header; its title and summary below (an Update's whole text); Accept and ✕ while Proposed;
 * - the list is one unbroken line with a square at each entry, as a thread's marks in Peek; no date headers;
 * - the conversation's "New" line where what you have seen begins.
 * Reuses: the kit's Card, StatusMark, Button, IconButton, Avatar, MetaText, EmptyState, Tabs.
 */
import { Fragment, useState, type ReactNode } from 'react'
import { IconExternalLink, IconFileText, IconTrash, IconX } from '@tabler/icons-react'
import { Avatar, Button, Card, EmptyState, IconButton, MetaText, SkeletonList, StatusMark, Tabs } from '@estiva-app/ui'
import { QUESTION_COLOUR, TYPE_META, statusOption, wordIcon, wordTone, type ItemType, type Status } from './MarkAs'
import { CATEGORIES, type Item, type Source } from './fixtures'

export function StatusOf({ item }: { item: Pick<Item, 'type' | 'status'> }) {
  const o = statusOption(item.type, item.status)
  return <StatusMark status={{ label: o.label, colour: o.colour ?? 'neutral' }} />
}

/** "From Katerina's message in Peek · Universal Navigation" — or "Typed by hand" for an item with no source. */
export function sourceLine(source?: Source) {
  if (!source) return 'Typed by hand'
  return `From ${source.author.name}’s ${source.what} in ${source.app} · ${source.place}`
}

/** Where it came from, by whom, when: the item panel's line. */
export function metaLine(item: Item) {
  const by = item.decidedBy ? `decided by ${item.decidedBy.name}, written by ${item.markedBy.name}` : item.source ? `marked by ${item.markedBy.name}` : `by ${item.markedBy.name}`
  return `${sourceLine(item.source)} · ${by} · ${item.at}`
}

/**
 * Accept (primary) and a secondary ✕ on a Proposed item, signed as you (Miky, 16 Nov, in place of Yes / No). A
 * suggested insight says Add: it is added to the Insights, not accepted (Miky, 17 Nov).
 */
export function AcceptReject({ onAnswer, waitingOn, label = 'Add' }: { onAnswer?: (accept: boolean) => void; waitingOn?: string; label?: string }) {
  if (waitingOn) return <MetaText tone="muted">Waiting for {waitingOn}</MetaText>
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="small" variant="primary" onClick={() => onAnswer?.(true)}>
        {label}
      </Button>
      <IconButton variant="muted" tooltip="Reject" aria-label="Reject" onClick={() => onAnswer?.(false)}>
        <IconX size={16} stroke={1.5} />
      </IconButton>
    </div>
  )
}

export const acceptedStatus = (item: Pick<Item, 'type'>): Status => (item.type === 'risk' || item.type === 'todo' ? 'open' : 'accepted')

/** An item's tag in its header, as Peek's mark label sits after the name: the type's icon and colour, an Insight's category or the word. */
export function ItemTag({ item }: { item: Item }) {
  const word = item.type === 'insight' ? (item.category ?? 'Insight') : item.word
  return (
    <span className="flex shrink-0 items-center gap-1 text-caption" style={wordTone(item.word)}>
      {wordIcon(item.word, 14)}
      {word}
    </span>
  )
}

/** Who the header names: whoever wrote the words, or typed the item when it has no source. */
const authorOf = (item: Item) => item.source?.author ?? item.markedBy

/**
 * One item as a conversation message (Miky, 16 Nov: "more aligned with how conversation is structured"): the header
 * is the face, the name, the tag, when and where from; the body its title and summary, an Update's whole text;
 * Accept and ✕ at the header's end while Proposed. The same entry in all three tabs and on the issue page.
 */
export function ItemEntry({ item, me = 'miky', onOpen, selected }: { item: Item; me?: string; onOpen?: () => void; selected?: boolean }) {
  const [status, setStatus] = useState<Status>(item.status)
  const proposed = status === 'proposed'
  // A Decision naming someone else waits for them (Decided, 16 Nov).
  const waitingOn = proposed && item.decidedBy && item.decidedBy.key !== me ? item.decidedBy.name : undefined
  const ended = ENDED.includes(status)
  // In a list, two lines at most (review, 17 Nov: a long Update read as a whole page); the rest opens with the entry.
  const body = item.summary ?? item.details
  const where = item.source ? `${item.source.app} · ${item.source.place}` : item.decision ? 'From an open question' : 'Typed by hand'
  return (
    <Card fill="none" hover="fill" quietUntilHover onPress={onOpen} selected={selected}>
      <div className="flex flex-col gap-1 p-2">
        <div className="flex h-6 min-w-0 items-center gap-2">
          <Avatar name={authorOf(item).name} size={20} />
          <span className="shrink-0 text-body-2 font-medium text-text-primary">{authorOf(item).name}</span>
          <ItemTag item={item} />
          <span className="min-w-0 truncate">
            <MetaText tone="muted">
              {item.at} · {where}
            </MetaText>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {proposed ? (
              <AcceptReject waitingOn={waitingOn} label={item.type === 'insight' ? 'Add' : undefined} onAnswer={(yes) => setStatus(yes ? acceptedStatus(item) : 'rejected')} />
            ) : LIVE.includes(status) ? null : (
              <StatusOf item={{ type: item.type, status }} />
            )}
          </span>
        </div>
        <div className={`flex flex-col gap-0.5 pl-7 ${ended ? 'opacity-60' : ''}`}>
          <span className={`text-body-2 font-medium text-text-primary ${status === 'superseded' ? 'line-through' : ''}`}>
            {item.title}
            <NewDot on={item.isNew} />
          </span>
          {body && <span className="line-clamp-2 text-body-2 text-text-secondary">{body}</span>}
          {/* A Decision's Chosen and Not chosen stay; an Update's measures and open lines open with the entry. */}
          {item.word !== 'Update' && <JournalExtras item={item} />}
        </div>
      </div>
    </Card>
  )
}

/** What a Journal entry carries past its words, the same in the Journal and in its detail: an Update's measures and what it leaves open, a Decision's brief. */
export function JournalExtras({ item }: { item: Item }) {
  return (
    <>
      {item.decision && <Chosen decision={item.decision} />}
      {item.measures && <Measures measures={item.measures} />}
      {item.stillOpen && (
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-caption font-medium text-text-primary">Still open</span>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-2 text-text-secondary">
            {item.stillOpen.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {item.artifact && <Artifact artifact={item.artifact} />}
    </>
  )
}

/** A Decision that answered a Question: the option chosen, the ones not, and the question it closed. */
function Chosen({ decision }: { decision: NonNullable<Item['decision']> }) {
  return (
    <div className="grid w-fit grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-0.5 pt-1 text-body-2">
      <span className="text-text-muted">Chosen</span>
      <span className="font-medium text-success-default">{decision.chosen}</span>
      {decision.notChosen.length > 0 && (
        <>
          <span className="text-text-muted">Not chosen</span>
          <span className="text-text-secondary">{decision.notChosen.join(' · ')}</span>
        </>
      )}
      <span className="text-text-muted">Question</span>
      <span className="text-text-secondary">{decision.question}</span>
    </div>
  )
}

/** An Update's numbers as before → after, the after in green: what changed, readable at a glance. */
function Measures({ measures }: { measures: NonNullable<Item['measures']> }) {
  return (
    <div className="flex flex-col gap-1 pt-1">
      <span className="text-caption text-text-muted">{measures.caption}</span>
      <div className="grid w-fit grid-cols-[auto_auto_auto_auto] items-baseline gap-x-3 gap-y-0.5 text-body-2 tabular-nums">
        {measures.rows.map(([label, before, after]) => (
          <Fragment key={label}>
            <span className="text-text-secondary">{label}</span>
            <span className="text-right text-text-muted">{before}</span>
            <span className="text-text-muted">→</span>
            <span className="font-medium text-success-default">{after}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/** The brief or diagram a Decision was made on, as an attachment: the picture, then its page's title. */
function Artifact({ artifact }: { artifact: NonNullable<Item['artifact']> }) {
  return (
    <Card fill="inset" clip className="mt-1 flex max-w-[560px] flex-col">
      <img src={artifact.image} alt={artifact.caption} className="max-h-48 w-full object-cover object-left-top" />
      <div className="flex items-center gap-2 px-3 py-2">
        <IconFileText size={16} stroke={1.5} className="shrink-0 text-text-secondary" />
        <span className="shrink-0 text-body-2 font-medium text-text-primary">{artifact.title}</span>
        <span className="min-w-0 truncate">
          <MetaText tone="muted">{artifact.caption}</MetaText>
        </span>
      </div>
    </Card>
  )
}

/** What is new since your last visit: one blue dot right after the title, the same in every list and the Journal (Miky, 16 Nov). */
export function NewDot({ on }: { on?: boolean }) {
  return on ? <span aria-label="New" className="ml-1.5 inline-block size-1.5 shrink-0 rounded-full bg-accent-primary align-middle" /> : null
}

/** The square on the line: the type's colour, hollow while Proposed, grey once ended. */
const MARKER: Record<ItemType, { border: string; fill: string }> = {
  insight: { border: 'border-warning-default', fill: 'bg-warning-default' },
  journal: { border: 'border-info-default', fill: 'bg-info-default' },
  risk: { border: 'border-error-default', fill: 'bg-error-default' },
  todo: { border: 'border-success-default', fill: 'bg-success-default' },
  highlight: { border: 'border-border-strong', fill: 'bg-border-strong' },
}
/** A Question's square is orange, not its type's red (Miky, 18 Nov), until it ends and goes grey. */
const markerOrange = (item: Item) =>
  item.word !== 'Question' || ENDED.includes(item.status) ? undefined : { borderColor: QUESTION_COLOUR, ...(item.status === 'proposed' ? {} : { backgroundColor: QUESTION_COLOUR }) }
const markerClass = (item: Item) =>
  item.status === 'proposed' ? `${MARKER[item.type].border} bg-bg-surface` : ENDED.includes(item.status) ? 'border-border-strong bg-border-strong' : `${MARKER[item.type].border} ${MARKER[item.type].fill}`

/**
 * Insights, Journal and Risks as one timeline, newest first: one unbroken line, a square at each entry level with its
 * name, as a thread's marks in Peek. No date headers: each entry says its date. What is new has the blue dot after
 * its title, as in every other list: no New line (Miky, 16 Nov: one marker).
 */
export function ItemTimeline({ items, onOpen, openId, me = 'miky', label }: { items: Item[]; onOpen?: (item: Item) => void; openId?: string; me?: string; label: string }) {
  const sorted = [...items].sort((a, b) => b.day.localeCompare(a.day))
  return (
    <ol className="ml-2 flex flex-col border-l-2 border-border-strong pl-5" aria-label={label}>
      {sorted.map((item) => (
        <li key={item.id} className="relative">
          <span aria-hidden className={`absolute -left-[25px] top-4 size-2 rounded-sm border-2 ${markerClass(item)}`} style={markerOrange(item)} />
          <ItemEntry item={item} me={me} selected={item.id === openId} onOpen={() => onOpen?.(item)} />
        </li>
      ))}
    </ol>
  )
}

/** The filter row above a list. Insights: by category; Journal: Decided, Updates, To decide; Risks: by status (Miky, 16 Nov). */
export function FilterRow({ type, value, onChange, items }: { type: ItemType; value: string; onChange: (v: string) => void; items: Item[] }) {
  if (type === 'insight') {
    const tabs = [{ id: 'all', label: 'All', count: items.length }, ...CATEGORIES.map((c) => ({ id: c, label: c, count: items.filter((i) => i.category === c).length }))]
    return <Tabs tabs={tabs} active={value} onChange={onChange} size="small" />
  }
  if (type === 'journal') {
    // Journal: what was decided, what was reported, what waits for a yes (Miky, 16 Nov); All keeps the rejected ones.
    const tabs = [{ id: 'all', label: 'All', count: items.length }, ...JOURNAL_FILTERS.map((f) => ({ id: f.id, label: f.label, count: filterItems(items, f.id).length }))]
    return <Tabs tabs={tabs} active={value} onChange={onChange} size="small" />
  }
  const end = { insight: 'Outdated', journal: 'Superseded', risk: 'Resolved', todo: 'Done, dropped', highlight: 'Sorted' }[type]
  const live = type === 'risk' || type === 'todo' ? 'Open' : 'Accepted'
  const tabs = [
    { id: 'all', label: 'All', count: items.length },
    { id: 'live', label: live, count: filterItems(items, 'live').length },
    { id: 'proposed', label: 'Proposed', count: filterItems(items, 'proposed').length },
    { id: 'ended', label: `${end} and rejected`, count: filterItems(items, 'ended').length },
  ]
  return <Tabs tabs={tabs} active={value} onChange={onChange} size="small" />
}

export const LIVE: Status[] = ['accepted', 'open']
export const ENDED: Status[] = ['outdated', 'superseded', 'resolved', 'rejected', 'done', 'dropped']
const JOURNAL_FILTERS = [
  { id: 'decided', label: 'Decided' },
  { id: 'updates', label: 'Updates' },
]
export function filterItems(items: Item[], filter: string) {
  if (filter === 'decided') return items.filter((i) => i.word === 'Decision' && (i.status === 'accepted' || i.status === 'superseded'))
  if (filter === 'updates') return items.filter((i) => i.word === 'Update' && i.status !== 'rejected')
  if (filter === 'to-decide') return items.filter((i) => i.status === 'proposed')
  if (filter === 'live') return items.filter((i) => LIVE.includes(i.status))
  if (filter === 'proposed') return items.filter((i) => i.status === 'proposed')
  if (filter === 'ended') return items.filter((i) => ENDED.includes(i.status))
  if ((CATEGORIES as string[]).includes(filter)) return items.filter((i) => i.category === filter)
  return items
}

/** A list's state: what to draw while it loads, when it failed, when it is empty. */
export type ListState = 'ready' | 'loading' | 'error' | 'empty'
export function ListStateView({ state, type, children }: { state: ListState; type: ItemType; children: ReactNode }) {
  if (state === 'loading') return <SkeletonList rows={4} />
  if (state === 'error') return <EmptyState scope="section" message={`Couldn’t load the ${TYPE_META[type].plural.toLowerCase()}. Try again.`} />
  if (state === 'empty')
    return (
      <EmptyState
        scope="section"
        icon={TYPE_META[type].icon(24)}
        message={
          {
            insight: 'No insights yet. Mark a message, a comment or a block as an Insight and it shows here.',
            journal: 'Nothing in the journal yet. Mark a message, a comment or a block as a Decision or an Update.',
            risk: 'No risks yet. Mark a message, a comment or a block as a Concern or a Question.',
            todo: 'No to-dos yet. Mark a message, a comment or a block as a To-do.',
            highlight: 'Nothing to sort.',
          }[type]
        }
      />
    )
  return <>{children}</>
}

/** The source as it read when marked, pinned; "edited since marked" opens the words now (record #448). */
export function SourceAsMarked({ source }: { source?: Source }) {
  const [showNow, setShowNow] = useState(false)
  if (!source)
    return <MetaText tone="muted">Typed by hand — no message, comment or block behind it.</MetaText>
  return (
    <figure className="flex flex-col gap-2 rounded-lg border border-border-default p-3">
      {/* Two lines beside the avatar and an icon to open it, so it fits the 384px panel (it was cramped on one line). */}
      <figcaption className="flex items-start gap-2">
        <span className="mt-0.5 flex shrink-0">
          <Avatar name={source.author.name} size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-2 text-text-primary">
            {source.author.name}’s {source.what}
          </span>
          <span className="min-w-0 truncate">
            <MetaText tone="muted">
              in {source.app} · {source.place}
            </MetaText>
          </span>
        </span>
        {!source.gone && (
          <IconButton variant="muted" tooltip={`Open in ${source.app}`} aria-label={`Open in ${source.app}`} onClick={() => {}}>
            <IconExternalLink size={16} stroke={1.5} />
          </IconButton>
        )}
      </figcaption>
      {/* An item points, never copies (record #448): a deleted source shows that it was deleted, and no words. */}
      {source.gone ? (
        <MetaText tone="muted">
          <IconTrash size={12} stroke={1.5} className="mr-1 inline" />
          This {source.what} was deleted. The item keeps its own title and details.
        </MetaText>
      ) : (
        <blockquote className="border-l-2 border-border-default pl-3 text-body-2 text-text-primary">{showNow && source.now ? source.now : source.quote}</blockquote>
      )}
      {source.gone ? null : source.now ? (
        <Button size="small" variant="muted" onClick={() => setShowNow((v) => !v)}>
          {showNow ? 'Show as marked' : 'Edited since marked — show it now'}
        </Button>
      ) : (
        <MetaText tone="muted">As marked</MetaText>
      )}
    </figure>
  )
}
