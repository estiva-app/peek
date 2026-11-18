/**
 * CONCEPT — Insights, Journal and Risks (prototype issue 009bc509). The one Mark as… and the one marked line, drawn
 * the same in Peek, Ship and Leaf: this file is copied unchanged into each app's concept folder, standing in for
 * the shared conversation menu and block menu in @estiva-app/ui that the build would add.
 *
 * Decided at kickoff (Miky, 16 Nov): Mark as… is one submenu of five words and marks at once, with the source's
 * team, its issue or project, and a title from its first line; a notice offers Open. A marked block or message
 * has a thin line in its type's colour; "changed since your last visit" a neutral grey one.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { IconAlertTriangle, IconBarrierBlock, IconBulb, IconExternalLink, IconHelpCircle, IconNotebook, IconX } from '@tabler/icons-react'
import { MenuItem, MenuSub, Toast, Tooltip, WithTooltip, type PickerOption } from '@estiva-app/ui'

export type ItemType = 'insight' | 'journal' | 'risk'
/** The six words a person picks; each makes one of the three types (Blocker added for Risks, Miky, 16 Nov). */
export type MarkWord = 'Insight' | 'Decision' | 'Update' | 'Concern' | 'Question' | 'Blocker'

export const TYPE_OF: Record<MarkWord, ItemType> = { Insight: 'insight', Decision: 'journal', Update: 'journal', Concern: 'risk', Question: 'risk', Blocker: 'risk' }
export const WORDS: MarkWord[] = ['Insight', 'Decision', 'Update', 'Concern', 'Question', 'Blocker']

export const TYPE_META: Record<ItemType, { label: string; plural: string; tab: string; line: string; text: string; icon: (size?: number) => ReactNode }> = {
  insight: { label: 'Insight', plural: 'Insights', tab: 'Insights', line: 'border-warning-default', text: 'text-warning-default', icon: (s = 16) => <IconBulb size={s} stroke={1.5} /> },
  journal: { label: 'Journal entry', plural: 'Journal entries', tab: 'Journal', line: 'border-info-default', text: 'text-info-default', icon: (s = 16) => <IconNotebook size={s} stroke={1.5} /> },
  risk: { label: 'Risk', plural: 'Risks', tab: 'Risks & questions', line: 'border-error-default', text: 'text-error-default', icon: (s = 16) => <IconAlertTriangle size={s} stroke={1.5} /> },
}

/**
 * Each type's colour as a CSS value, and a Question's own orange (Miky, 18 Nov: red reads as a problem, and an open
 * question is just a question; a Concern and a Blocker stay red). The kit has no orange token yet: the concept mixes it
 * from its amber and red, and the build asks Katerina for one.
 */
const TYPE_COLOUR: Record<ItemType, string> = { insight: 'var(--warning-default)', journal: 'var(--info-default)', risk: 'var(--error-default)' }
export const QUESTION_COLOUR = 'color-mix(in srgb, var(--warning-default) 45%, var(--error-default))'
export const wordColour = (word: MarkWord): string => (word === 'Question' ? QUESTION_COLOUR : TYPE_COLOUR[TYPE_OF[word]])
/**
 * The style that paints a word in its colour. @estiva-escape: a computed palette (the lint's own allowed case): the
 * colour is picked per word and the orange has no token class yet; the build gets a kit token and a class.
 */
export const wordTone = (word: MarkWord, prop: 'color' | 'borderColor' | 'backgroundColor' = 'color') => ({ [prop]: wordColour(word) })

/** A word's own icon where its type's would blur them (Miky, 16 Nov: Concern, Question and Blocker each need their own). */
export const wordIcon = (word: MarkWord, size = 16): ReactNode =>
  word === 'Question' ? <IconHelpCircle size={size} stroke={1.5} /> : word === 'Blocker' ? <IconBarrierBlock size={size} stroke={1.5} /> : TYPE_META[TYPE_OF[word]].icon(size)

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
        <MenuItem label={`Open ${mark.word}`} leading={<span style={wordTone(mark.word)}>{wordIcon(mark.word)}</span>} trailing={<IconExternalLink size={14} stroke={1.5} className="text-text-secondary" />} onClick={onOpen} />
        <MenuItem label="Unmark" leading={<IconX size={16} stroke={1.5} className="text-text-secondary" />} onClick={onUnmark} />
      </>
    )
  return (
    <MenuSub label="Mark as" leading={<IconBulb size={16} stroke={1.5} className="text-text-secondary" />}>
      {WORDS.map((word) => (
        <MenuItem key={word} label={word} leading={<span style={wordTone(word)}>{wordIcon(word)}</span>} onClick={() => onMark?.(word)} />
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
      <div className="border-l-2 pl-3" style={wordTone(mark.word, "borderColor")} data-marked={mark.type}>
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

/**
 * The CSS for marking blocks inside a document editor, by block id — the editor draws blocks itself, so a story marks
 * them by attribute. A marked block wears its word as a small label in the right margin, level with its first line,
 * like a message's label beside its time (Miky, 16 Nov: a line on the left collided with the block handle); what
 * changed since your last visit says "Changed" in grey in the same place. The label opens the item beside the page.
 */
export function blockLineCss(marks: Record<string, ItemType | MarkWord>, changed: string[] = [], place: 'inside' | 'gutter' = 'inside'): string {
  // `gutter`: in the page's right margin, where a page has one (Leaf); `inside`: the block's own right 96px (Ship's description, whose column meets the side panel).
  // `inside` keeps a 40px column for the label at the block's right, with the edge on its inner side, so the label sits
  // right of the edge as Leaf's does in its margin (Miky, 18 Nov: Ship had it left of the edge).
  const where = place === 'gutter' ? 'position:relative}' : 'position:relative;padding-right:40px}'
  const at = place === 'gutter' ? 'left:calc(100% + 12px)' : 'right:4px'
  // What is marked (Miky, 16 Nov: "not clear what is marked"): a faint edge down the block's right side, beside the
  // label, fading as it goes down, and a wash that fades in from that edge — the block's whole height, never its left
  // side, where the handle is.
  const edge = place === 'gutter' ? 'right:-4px' : 'right:32px'
  // The label is the word's icon alone, the same line icon Ship's lists draw, in its type's colour (Miky, 18 Nov: the word
  // is not needed, people learn the icon quickly; emoji were "too realistic"). The editor draws the blocks, so the icon is
  // the React one rendered to SVG and used as a mask. Hover on the block's label opens the item, which names it.
  // "Changed" stays a grey word.
  const edgeAndWash = (id: string, c: string, wash: boolean) =>
    `[data-block-id="${id}"]{${where}` +
    `[data-block-id="${id}"]{background:linear-gradient(to left, color-mix(in srgb, ${c} ${wash ? 7 : 4}%, transparent), transparent 45%)}` +
    `[data-block-id="${id}"]::before{content:"";position:absolute;top:0;bottom:0;${edge};width:2px;border-radius:1px;pointer-events:none;background:linear-gradient(to bottom, color-mix(in srgb, ${c} ${wash ? 70 : 45}%, transparent), transparent)}`
  const icon = (id: string, svg: string, c: string) => {
    const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
    return edgeAndWash(id, c, true) + `[data-block-id="${id}"]::after{content:"";position:absolute;top:3px;${at};width:16px;height:16px;background:${c};-webkit-mask:${url} center/contain no-repeat;mask:${url} center/contain no-repeat;cursor:pointer}`
  }
  const word = (id: string, text: string, c: string) =>
    edgeAndWash(id, c, false) + `[data-block-id="${id}"]::after{content:"${text}";position:absolute;top:1px;${at};font-size:12px;line-height:20px;font-weight:500;white-space:nowrap;color:${c}}`
  return [
    ...Object.entries(marks).map(([id, m]) => {
      const t = (m in TYPE_META ? m : TYPE_OF[m as MarkWord]) as ItemType
      return m in TYPE_META
        ? icon(id, renderToStaticMarkup(TYPE_META[t].icon(16)), TYPE_COLOUR[t])
        : icon(id, renderToStaticMarkup(wordIcon(m as MarkWord, 16)), wordColour(m as MarkWord))
    }),
    ...changed.filter((id) => !marks[id]).map((id) => word(id, 'Changed', 'var(--text-secondary)')),
  ].join('\n')
}

/**
 * The word above a marked block's icon while the pointer is on it (Miky, 18 Nov: hover says "Insight"), in the kit's
 * tooltip pill. The icon is drawn by CSS, so no WithTooltip can wrap it; the concept watches the pointer instead, and
 * the build gives the editor a real icon to wrap.
 */
export function useMarkHover(marks: Record<string, ItemType | MarkWord>, place: 'inside' | 'gutter' = 'inside'): ReactNode {
  const [at, setAt] = useState<{ word: string; x: number; y: number }>()
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-block-id]') as HTMLElement | null
      const m = el?.dataset.blockId ? marks[el.dataset.blockId] : undefined
      if (!el || !m) return setAt(undefined)
      const r = el.getBoundingClientRect()
      // The icon's centre: 20px past the block in the gutter, 12px in from its right edge inside it.
      const x = place === 'gutter' ? r.right + 20 : r.right - 12
      const onIcon = Math.abs(e.clientX - x) <= 12 && e.clientY >= r.top && e.clientY <= r.top + 24
      setAt(onIcon ? { word: m in TYPE_META ? TYPE_META[m as ItemType].label : m, x, y: r.top } : undefined)
    }
    document.addEventListener('mousemove', move)
    return () => document.removeEventListener('mousemove', move)
  }, [marks, place])
  if (!at) return null
  // @estiva-escape(no-rebuilt-behaviour): concept only: the icon is a CSS pseudo-element nothing can wrap; the build draws a real icon inside WithTooltip
  return createPortal(
    <span className="pointer-events-none fixed z-50" style={{ left: at.x, top: at.y - 4, transform: 'translate(-50%, -100%)' }}>
      <Tooltip label={at.word} />
    </span>,
    document.body,
  )
}

/** The marked block whose label was clicked, if any: a click on `::after` lands on the block, in its right 96px or past it. */
export function markedBlockAt(e: { target: EventTarget; clientX: number }, marks: Record<string, unknown>): string | undefined {
  const el = (e.target as HTMLElement).closest?.('[data-block-id]') as HTMLElement | null
  const id = el?.dataset.blockId
  if (!el || !id || !marks[id]) return undefined
  return e.clientX > el.getBoundingClientRect().right - 96 ? id : undefined
}
