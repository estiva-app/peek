import { useState, type MouseEvent, type ReactNode } from 'react'
import { IconUsers } from '@tabler/icons-react'
import { Link } from 'react-router-dom'
import { EmptyState, IconButton, ListColumn, NavItem, NavTree, PageHeader, PreviewCard, SectionHeader } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { TreeRow } from '@/components/views/FileTreeView'
import { PersonItem } from '@/components/ui/PersonItem'
import { useToast } from '@/lib/toast'
import { ActivityLine, ActivityRow, type BothLook } from './ActivityCard'
import { lit } from './rules'
import { allPlaces, peopleColumn, teamsColumn, topicFile, topicsColumn, type ActivityItem, type Place } from './fixtures'

export type Column = 'topics' | 'teams' | 'people'

export interface ActivityScreenProps {
  column: Column
  /** How a row with both blue and orange draws its dot. */
  look?: BothLook
  /** A phone or tablet: no hover, so no card. */
  touch?: boolean
  /** The place open on the right, by id. */
  open?: string
  /** Items already seen (orange the hover cleared, blue that was opened), by id. */
  cleared?: string[]
}

/**
 * Peek's frame with one column, every row carrying the dot that explains
 * itself. Hover a lit row for its card of what is new; leave it and its orange
 * is seen. Open a row, or a team's name, and its page has a dot beside the
 * title: hover it for the place's whole list, new and earlier.
 */
export function ActivityScreen({ column, look = 'blue-wins', touch = false, open: openAt, cleared: clearedAt = [] }: ActivityScreenProps) {
  const { showToast } = useToast()
  const [cleared, setCleared] = useState<ReadonlySet<string>>(() => new Set(clearedAt))
  const [openId, setOpenId] = useState<string | undefined>(openAt)
  const place = allPlaces.find((p) => p.id === openId)

  const clear = (ids: string[]) => setCleared((now) => new Set([...now, ...ids]))
  // Hovering clears the orange, never the blue.
  const hovered = (p: Place) => clear(p.items.filter((i) => i.colour === 'orange').map((i) => i.id))
  // Opening a place shows its own conversation: what was said there is read, and its orange seen. Blue on a listed
  // file stays until that file's conversation is opened.
  const openPlace = (p: Place) => {
    setOpenId(p.id)
    if (p.kind !== 'team') clear(p.items.filter((i) => i.colour === 'orange' || !i.file).map((i) => i.id))
  }
  const openItem = (p: Place, i: ActivityItem) => {
    if (p.kind !== 'team') openPlace(p)
    clear([i.id])
    showToast({ label: `Opens ${i.file ? `“${i.file}”` : (i.in ?? p.name)} at ${i.who}’s message`, type: 'neutral' })
  }

  const row = (p: Place, drawn: ReactNode) => (
    <div
      key={p.id}
      // The prototype opens the place itself, on the right, in place of following the row's link.
      onClickCapture={(event: MouseEvent) => {
        event.preventDefault()
        openPlace(p)
      }}
    >
      <ActivityRow place={p} cleared={cleared} look={look} touch={touch} onHovered={hovered} onOpenItem={openItem} onForYou={openPlace}>
        {drawn}
      </ActivityRow>
    </div>
  )
  const isLit = (p: Place) => {
    const l = lit(p, cleared)
    return l.blue || l.orange
  }
  const treeRow = (p: Place) => {
    const file = topicFile(p.id, p.name)
    return row(p, <TreeRow file={file} unread={{ [file.ref]: isLit(p) }} selectedRef={openId ? topicFile(openId, '').ref : undefined} nested />)
  }

  const left =
    column === 'topics' ? (
      <ListColumn title="Topics">
        <NavTree>{topicsColumn.map(treeRow)}</NavTree>
      </ListColumn>
    ) : column === 'teams' ? (
      <ListColumn title="Teams">
        <NavTree>
          <div className="flex flex-col pb-2">
            <SectionHeader title="My teams" />
            {teamsColumn.map(({ team, places }) => (
              <div key={team} className="flex flex-col gap-0.5 pb-2">
                {/* The team's name opens its page, as on main; its page has the dot beside its title. */}
                <div
                  onClickCapture={(event: MouseEvent) => {
                    event.preventDefault()
                    setOpenId(`team:${team}`)
                  }}
                >
                  <SectionHeader title={team} look="quiet" render={<Link to="#" aria-label={`Open ${team}`} />} />
                </div>
                {places.map((p) =>
                  p.kind === 'chat'
                    ? row(p, <NavItem href="#" label={p.name} icon={<IconUsers size={16} stroke={1.5} aria-hidden />} unread={isLit(p)} active={openId === p.id} />)
                    : treeRow(p),
                )}
              </div>
            ))}
          </div>
        </NavTree>
      </ListColumn>
    ) : (
      <ListColumn title="People">
        <NavTree>
          {peopleColumn.map((p) =>
            row(p, <PersonItem id={p.id} name={p.name} unread={isLit(p)} urgent={p.urgent && lit(p, cleared).blue} active={openId === p.id} />),
          )}
        </NavTree>
      </ListColumn>
    )

  const right = place ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={place.kind === 'chat' ? `# ${place.name}` : place.name}
        after={<TitleDot place={place} cleared={cleared} touch={touch} onHovered={hovered} onOpen={(i) => openItem(place, i)} />}
      />
      <div className="flex flex-1 items-center justify-center p-4">
        <span className="text-caption text-text-muted">{place.kind === 'team' ? `${place.name}’s page, as today` : `${place.name}’s conversation, as today`}</span>
      </div>
    </div>
  ) : (
    <div className="flex flex-1 items-center justify-center p-4">
      <span className="text-caption text-text-muted">{touch ? 'Tap a row to open it' : 'Rest the pointer on a row with a dot'}</span>
    </div>
  )

  return <PeekFrame leftPanel={left} rightPanel={right} />
}

/**
 * The dot beside a page's title, as the navigation prototype drew it (estiva-ui `concept/cross-app-navigation`,
 * `ActivityDot`; Miky, 10 Nov): blue with something new to read, orange with only a reaction to you, a quiet ring with
 * nothing new. Hovering it shows the place's whole list, new and earlier. On a touch screen a tap opens it.
 */
export function TitleDot({ place, cleared, touch, onHovered, onOpen }: { place: Place; cleared: ReadonlySet<string>; touch: boolean; onHovered: (p: Place) => void; onOpen: (item: ActivityItem) => void }) {
  const { blue, orange } = lit(place, cleared)
  const dot = blue ? 'bg-accent-primary' : orange ? 'bg-warning-default' : 'border border-border-strong'
  return (
    <span onPointerLeave={() => onHovered(place)}>
      <PreviewCard side="bottom" delay={touch ? 0 : undefined} contentClassName="p-1" content={<PlaceList place={place} cleared={cleared} onOpen={onOpen} />}>
        <IconButton aria-label={blue || orange ? 'Something new here; show what' : 'Show what happened here'} tooltip="">
          <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
        </IconButton>
      </PreviewCard>
    </span>
  )
}

/** A place's whole list: New on top, then Earlier, which keeps what a hover cleared. */
export function PlaceList({ place, cleared, onOpen }: { place: Place; cleared: ReadonlySet<string>; onOpen?: (item: ActivityItem) => void }) {
  const fresh = place.items.filter((i) => !cleared.has(i.id))
  const earlier = [...place.items.filter((i) => cleared.has(i.id)), ...(place.seen ?? [])]
  return (
    <div className="flex flex-col gap-2">
      {fresh.length + earlier.length === 0 && <EmptyState scope="section" message="Nothing here yet." />}
      {fresh.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <SectionHeader title="New" />
          {fresh.map((i) => (
            <ActivityLine key={i.id} item={i} onOpen={onOpen} />
          ))}
        </div>
      )}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <SectionHeader title="Earlier" />
          {earlier.map((i) => (
            <ActivityLine key={i.id} item={i} onOpen={onOpen} quiet />
          ))}
        </div>
      )}
    </div>
  )
}
