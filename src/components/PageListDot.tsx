import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { EmptyState, IconButton, PreviewCard, SectionHeader, SkeletonRow, UnreadDot, isPlainClick, type UnreadDotTone } from '@estiva-app/ui'
import { seeReactions, usePageLines, type PageDot as PageDotState, type PageLine } from '@/api'
import { useNewsLineDetails } from '@/components/newsLineDetails'
import { NewsLine } from '@/components/RowNewsCard'

export type { PageLine }

/**
 * The dot beside a page's title (ACT-4; the activity indicator prototype Miky approved on 10 November, as the 29 October
 * navigation prototype drew it): blue with something new for you here, a quiet ring with nothing new. Resting on it, or
 * a tap on a touch screen, opens the page's list. `list` is drawn only while it is open, so its read waits for that.
 */
export function PageListDot({ lit, tone = 'blue', list, onOpenChange }: {
  lit: boolean
  /** Its colour when lit, as the page's row's (ACT-7). */
  tone?: UnreadDotTone
  list: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <PreviewCard side="bottom" openOnTap contentClassName="p-1" content={list} {...(onOpenChange ? { onOpenChange } : {})}>
      <IconButton aria-label={lit ? 'Something new here; show what' : 'Show what happened here'} data-page-dot={lit ? 'lit' : 'quiet'}>
        <UnreadDot quiet={!lit} {...(lit ? { tone } : {})} />
      </IconButton>
    </PreviewCard>
  )
}

/**
 * A page's title dot with its list, from the page's {@link PageDotState}: the list reads only once it is open. Opening
 * the list counts as resting on the place's row (SPEC §11.8): when it closes, the new reactions to you it listed are
 * seen (ACT-7), and stay under Earlier.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
export function PageDot({ dot, onOpen }: { dot: PageDotState; onOpen?: (line: PageLine) => void }) {
  /** The new reaction lines the list drew since it opened: it is mounted only while open. */
  const listed = useRef<PageLine[]>([])
  const onOpenChange = useCallback((open: boolean) => {
    if (open) return
    const lines = listed.current
    listed.current = []
    if (lines.length) seeReactions(lines)
  }, [])
  const onListed = useCallback((lines: readonly PageLine[]) => {
    listed.current = [...listed.current, ...lines.filter((line) => line.reaction && !line.seen)]
  }, [])
  return <PageListDot lit={dot.lit} tone={dot.tone} onOpenChange={onOpenChange} list={<PageListRead dot={dot} onListed={onListed} {...(onOpen ? { onOpen } : {})} />} />
}

/** The list's content: mounted only while the card is open, so this is when its read is asked. */
function PageListRead({ dot, onOpen, onListed }: { dot: PageDotState; onOpen?: (line: PageLine) => void; onListed?: (lines: readonly PageLine[]) => void }) {
  const lines = usePageLines(dot.sources, dot.held)
  const shown = lines === 'failed' || lines === undefined ? dot.held : lines
  useEffect(() => {
    onListed?.(shown)
  }, [shown, onListed])
  return <PageList lines={lines === 'failed' ? undefined : lines} failed={lines === 'failed'} held={dot.held} {...(onOpen ? { onOpen } : {})} />
}

/**
 * A page's list: New on top, everything that lights the place for you now, the same lines as its row's card; then
 * Earlier, what was about you and is seen now. Newest first in each. `lines` undefined is still reading: New's lines
 * already held draw at once, and Earlier waits with a skeleton line; "Nothing here yet." only once the read returned
 * empty.
 */
export function PageList({ lines, held, onOpen, failed = false }: {
  lines: readonly PageLine[] | undefined
  /** The read was refused: New's held lines, and Earlier says it could not be read rather than waiting for good. */
  failed?: boolean
  /** The New lines the page already holds, drawn while `lines` is read. */
  held?: readonly PageLine[]
  /** What a plain click on a line does before its link opens (a topic keeps the column beside it). */
  onOpen?: (line: PageLine) => void
}) {
  const all = [...(lines ?? held ?? [])].sort((a, b) => b.at - a.at)
  const fresh = all.filter((line) => !line.seen)
  const earlier = all.filter((line) => line.seen)
  const details = useNewsLineDetails(all, all.length)
  const line = (item: PageLine) => (
    <NewsLine
      key={item.id}
      item={item}
      details={details}
      href={item.href}
      seen={item.seen}
      {...(item.where ? { where: item.where } : {})}
      onClick={(event) => {
        if (isPlainClick(event)) onOpen?.(item)
      }}
    />
  )
  if (lines && all.length === 0) return <EmptyState scope="section" message="Nothing here yet." />
  return (
    <div className="flex flex-col gap-2" data-page-list>
      {fresh.length > 0 && (
        <div className="flex flex-col gap-0.5" data-page-list-part="new">
          <SectionHeader title="New" />
          {fresh.map(line)}
        </div>
      )}
      {(earlier.length > 0 || !lines) && (
        <div className="flex flex-col gap-0.5" data-page-list-part="earlier">
          <SectionHeader title="Earlier" />
          {lines ? earlier.map(line) : failed ? <EmptyState scope="section" message="Earlier could not be read." /> : <SkeletonRow />}
        </div>
      )}
    </div>
  )
}
