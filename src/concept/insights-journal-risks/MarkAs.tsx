/**
 * CONCEPT — Insights, Journal and Risks (prototype issue 009bc509). The one Mark as… and the one marked line, drawn
 * the same in Peek, Ship and Leaf: this file is copied unchanged into each app's concept folder, standing in for
 * the shared conversation menu and block menu in @estiva-app/ui that the build would add.
 *
 * Decided at kickoff (Miky, 16 Nov): Mark as… is one submenu of five words and marks at once, with the source's
 * team, its issue or project, and a title from its first line; a notice offers Open. A marked block or message
 * has a thin line in its type's colour; "changed since your last visit" a neutral grey one.
 */
import type { ReactNode } from 'react'
import { IconAlertTriangle, IconBulb, IconExternalLink, IconNotebook, IconX } from '@tabler/icons-react'
import { MenuItem, MenuSub, Toast, WithTooltip, type PickerOption } from '@estiva-app/ui'

export type ItemType = 'insight' | 'journal' | 'risk'
/** The five words a person picks; each makes one of the three types. */
export type MarkWord = 'Insight' | 'Decision' | 'Update' | 'Concern' | 'Question'

export const TYPE_OF: Record<MarkWord, ItemType> = { Insight: 'insight', Decision: 'journal', Update: 'journal', Concern: 'risk', Question: 'risk' }
export const WORDS: MarkWord[] = ['Insight', 'Decision', 'Update', 'Concern', 'Question']

export const TYPE_META: Record<ItemType, { label: string; plural: string; tab: string; line: string; text: string; icon: (size?: number) => ReactNode }> = {
  insight: { label: 'Insight', plural: 'Insights', tab: 'Insights', line: 'border-warning-default', text: 'text-warning-default', icon: (s = 16) => <IconBulb size={s} stroke={1.5} /> },
  journal: { label: 'Journal entry', plural: 'Journal entries', tab: 'Journal', line: 'border-info-default', text: 'text-info-default', icon: (s = 16) => <IconNotebook size={s} stroke={1.5} /> },
  risk: { label: 'Risk', plural: 'Risks', tab: 'Risks', line: 'border-error-default', text: 'text-error-default', icon: (s = 16) => <IconAlertTriangle size={s} stroke={1.5} /> },
}

/** Each type's own statuses on the shared stages (record every-app-relies-on-an-items-stage…): Rejected from Proposed for all three. */
export type Status = 'proposed' | 'accepted' | 'open' | 'outdated' | 'superseded' | 'resolved' | 'rejected'
export const STATUSES: Record<ItemType, PickerOption[]> = {
  insight: [
    { value: 'proposed', label: 'Proposed', colour: 'neutral' },
    { value: 'accepted', label: 'Accepted', colour: 'green' },
    { value: 'outdated', label: 'Outdated', colour: 'muted' },
    { value: 'rejected', label: 'Rejected', colour: 'muted' },
  ],
  journal: [
    { value: 'proposed', label: 'Proposed', colour: 'neutral' },
    { value: 'accepted', label: 'Accepted', colour: 'green' },
    { value: 'superseded', label: 'Superseded', colour: 'muted' },
    { value: 'rejected', label: 'Rejected', colour: 'muted' },
  ],
  risk: [
    { value: 'proposed', label: 'Proposed', colour: 'neutral' },
    { value: 'open', label: 'Open', colour: 'blue' },
    { value: 'resolved', label: 'Resolved', colour: 'green' },
    { value: 'rejected', label: 'Rejected', colour: 'muted' },
  ],
}
export const statusLabel = (type: ItemType, status: Status) => STATUSES[type].find((o) => o.value === status)?.label ?? status
export const statusOption = (type: ItemType, status: Status) => STATUSES[type].find((o) => o.value === status) ?? STATUSES[type][0]

/** What a marked source points at. A Rejected item leaves its source unmarked: no line. */
export interface Mark {
  type: ItemType
  word: MarkWord
  title: string
  href: string
  status: Status
}
export const drawsLine = (mark?: Mark) => !!mark && mark.status !== 'rejected'

/**
 * The menu rows: on an unmarked source, Mark as ▸ the five words; on a marked one, Open and Unmark.
 * `refused` is a source whose readers differ from any team's (a DM, a private team): no row at all, never a refusal after.
 */
export function MarkAsRows({ mark, onMark, onOpen, onUnmark, refused = false }: { mark?: Mark; onMark?: (word: MarkWord) => void; onOpen?: () => void; onUnmark?: () => void; refused?: boolean }) {
  if (refused) return null
  if (drawsLine(mark) && mark)
    return (
      <>
        <MenuItem label={`Open ${mark.word}`} leading={<span className={TYPE_META[mark.type].text}>{TYPE_META[mark.type].icon()}</span>} trailing={<IconExternalLink size={14} stroke={1.5} className="text-text-secondary" />} onClick={onOpen} />
        <MenuItem label="Unmark" leading={<IconX size={16} stroke={1.5} className="text-text-secondary" />} onClick={onUnmark} />
      </>
    )
  return (
    <MenuSub label="Mark as" leading={<IconBulb size={16} stroke={1.5} className="text-text-secondary" />}>
      {WORDS.map((word) => (
        <MenuItem key={word} label={word} leading={<span className={TYPE_META[TYPE_OF[word]].text}>{TYPE_META[TYPE_OF[word]].icon()}</span>} onClick={() => onMark?.(word)} />
      ))}
    </MenuSub>
  )
}

/**
 * The notice after Mark as…: it says where it went and offers Open; the item's title is taken from the source's
 * first line and is the one thing the item keeps (record #448), so the notice says so.
 */
export function MarkedNotice({ word, team, about, onOpen, onClose }: { word: MarkWord; team: string; about?: string; onOpen?: () => void; onClose?: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <Toast label={`Marked as ${word} in ${about ?? team}. Its title is kept; change it on its page.`} type="success" actionLabel="Open" onAction={() => (onOpen?.(), onClose?.())} />
    </div>
  )
}

/** The thin line beside a marked block or message, in its type's colour; hover names it. */
export function MarkedLine({ mark, children }: { mark?: Mark; children: ReactNode }) {
  if (!drawsLine(mark) || !mark) return <>{children}</>
  return (
    <WithTooltip label={`${mark.word} · ${mark.title}`} wrapperClassName="block">
      <div className={`border-l-2 pl-3 ${TYPE_META[mark.type].line}`} data-marked={mark.type}>
        {children}
      </div>
    </WithTooltip>
  )
}

/** The neutral line beside what changed since your last visit — told apart from a mark by colour (grey) and by being dashed. */
export function ChangedLine({ children }: { children: ReactNode }) {
  return (
    <WithTooltip label="Changed since your last visit" wrapperClassName="block">
      <div className="border-l-2 border-dashed border-border-strong pl-3" data-changed>
        {children}
      </div>
    </WithTooltip>
  )
}

/** The CSS for marking blocks inside a document editor, by block id — the editor draws blocks itself, so a story marks them by attribute. */
export function blockLineCss(marks: Record<string, ItemType>, changed: string[] = []): string {
  const colour: Record<ItemType, string> = { insight: 'var(--warning-default)', journal: 'var(--info-default)', risk: 'var(--error-default)' }
  const rule = (id: string, c: string, style: string) =>
    `[data-block-id="${id}"]{box-shadow:none;border-left:2px ${style} ${c};padding-left:10px;margin-left:-12px}`
  return [...Object.entries(marks).map(([id, t]) => rule(id, colour[t], 'solid')), ...changed.map((id) => rule(id, 'var(--border-strong)', 'dashed'))].join('\n')
}
