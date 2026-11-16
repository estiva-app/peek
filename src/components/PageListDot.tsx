import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState, IconButton, MenuSection, PreviewCard, SkeletonRow, UnreadDot, isPlainClick, type UnreadDotTone } from '@estiva-app/ui'
import { usePageLines, useReactionsSeenOnClose, type PageDot as PageDotState, type PageLine } from '@/api'
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
        {/* In an icon's 16px, not the dot's own 24px slot: the button is the 24px every icon button beside it is (Katerina, 15 November: it measured 32px). */}
        <UnreadDot quiet={!lit} className="h-4 w-4" {...(lit ? { tone } : {})} />
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
  /** What the list draws while it is open (it is mounted only then); its New lines are what closing it sees. */
  const [listed, setListed] = useState<readonly PageLine[] | undefined>(undefined)
  const fresh = useMemo(() => (listed ?? dot.held).filter((line) => !line.seen), [listed, dot.held])
  // A page's list draws every line, not a card's five.
  const { onPreviewOpenChange } = useReactionsSeenOnClose(fresh, Infinity)
  const onOpenChange = useCallback(
    (open: boolean) => {
      onPreviewOpenChange(open)
      if (!open) setListed(undefined)
    },
    [onPreviewOpenChange],
  )
  return <PageListDot lit={dot.lit} tone={dot.tone} onOpenChange={onOpenChange} list={<PageListRead dot={dot} onListed={setListed} {...(onOpen ? { onOpen } : {})} />} />
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
  /*
    A max height, then it scrolls (Katerina, 6 November, PL-06: "let's have a max height and then it starts scrolling"):
    the card's own, the kit's PreviewCard, whose body is a ScrollArea capped at 300px. No scroll box of its own here: one
    inside the card's drew a second scrollbar beside the card's (Katerina, 16 November).
    As the navigation prototype draws it (Katerina, 17 November: "should follow the prototype's left and right
    paddings", then yes to its room above and below): the rows' box is 4px in from the card's own 4px on every side, so
    a row's background sits 8px from the card's edges, and its two parts are 4px apart.
    New and Earlier are each the kit's MenuSection, as ActivityLine's page says: its heading in the kit's secondary
    text, the quieter one (Katerina, 17 November: "the quieter grey as long as it is a token of the kit").
  */
  return (
    <div className="flex flex-col gap-1 p-1" data-page-list>
      {lines && all.length === 0 ? (
        /*
          Nothing to list: the kit's line for rows, in the rows' own box, level with where the lines would be, saying
          what would show here (Katerina, 15–16 November, PL-05: "Improve empty state activity panel").
        */
        <EmptyState scope="rows" message="Nothing for you here yet. Replies to you, mentions and reactions to your messages show here." />
      ) : (
        <>
          {fresh.length > 0 && (
            <div data-page-list-part="new">
              <MenuSection label="New">{fresh.map(line)}</MenuSection>
            </div>
          )}
          {(earlier.length > 0 || !lines) && (
            <div data-page-list-part="earlier">
              <MenuSection label="Earlier">
                {lines ? earlier.map(line) : failed ? <EmptyState scope="section" message="Earlier could not be read." /> : <SkeletonRow />}
              </MenuSection>
            </div>
          )}
        </>
      )}
    </div>
  )
}
