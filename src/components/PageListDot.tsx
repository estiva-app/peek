import type { ReactNode } from 'react'
import { EmptyState, IconButton, PreviewCard, SectionHeader, SkeletonRow, UnreadDot, isPlainClick } from '@estiva-app/ui'
import { usePageLines, type PageDot as PageDotState, type PageLine } from '@/api'
import { useNewsLineDetails } from '@/components/newsLineDetails'
import { NewsLine } from '@/components/RowNewsCard'

export type { PageLine }

/**
 * The dot beside a page's title (ACT-4; the activity indicator prototype Miky approved on 10 November, as the 29 October
 * navigation prototype drew it): blue with something new for you here, a quiet ring with nothing new. Resting on it, or
 * a tap on a touch screen, opens the page's list. `list` is drawn only while it is open, so its read waits for that.
 */
export function PageListDot({ lit, list }: { lit: boolean; list: ReactNode }) {
  return (
    <PreviewCard side="bottom" openOnTap contentClassName="p-1" content={list}>
      <IconButton aria-label={lit ? 'Something new here; show what' : 'Show what happened here'} data-page-dot={lit ? 'lit' : 'quiet'}>
        <UnreadDot quiet={!lit} />
      </IconButton>
    </PreviewCard>
  )
}

/** A page's title dot with its list, from the page's {@link PageDotState}: the list reads only once it is open. */
export function PageDot({ dot, onOpen }: { dot: PageDotState; onOpen?: (line: PageLine) => void }) {
  return <PageListDot lit={dot.lit} list={<PageListRead dot={dot} {...(onOpen ? { onOpen } : {})} />} />
}

/** The list's content: mounted only while the card is open, so this is when its read is asked. */
function PageListRead({ dot, onOpen }: { dot: PageDotState; onOpen?: (line: PageLine) => void }) {
  const lines = usePageLines(dot.sources, dot.held)
  return <PageList lines={lines} held={dot.held} {...(onOpen ? { onOpen } : {})} />
}

/**
 * A page's list: New on top, everything that lights the place for you now, the same lines as its row's card; then
 * Earlier, what was about you and is seen now. Newest first in each. `lines` undefined is still reading: New's lines
 * already held draw at once, and Earlier waits with a skeleton line; "Nothing here yet." only once the read returned
 * empty.
 */
export function PageList({ lines, held, onOpen }: {
  lines: readonly PageLine[] | undefined
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
          {lines ? earlier.map(line) : <SkeletonRow />}
        </div>
      )}
    </div>
  )
}
