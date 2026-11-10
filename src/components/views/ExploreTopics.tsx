import { useState } from 'react'
import { IconArchive, IconTarget } from '@tabler/icons-react'
import { Button, EmptyState, KindIcon, Link, Panel, SearchInput, SkeletonList, Tabs } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { findsTopic, formatActive, useExploreTopics, type ExploreRow, type ExploreState, type ExploreTab } from '@/api'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'

const TABS: Record<ExploreTab, string> = { all: 'All', yours: 'Your topics', others: 'Other topics', archived: 'Archived' }
const TAB_ORDER: ExploreTab[] = ['all', 'yours', 'others', 'archived']

/** What an empty tab says, in Ship's and Leaf's words; with no topic shown at all, every open tab says the first. */
const EMPTY: Record<ExploreTab, string> = {
  all: 'No topics yet.',
  yours: 'You’re in no topics yet.',
  others: 'No other topics.',
  archived: 'No archived topics.',
}

/**
 * **Explore topics** (TOPI-6): the page Peek's Topics column ends in, in place
 * of its Other topics and Archived sections (Miky, 3 Nov: "one button like
 * 'Explore topics' that would open dedicated page where you can see all the
 * topics and even find the archived one", like Slack's browse channels).
 * Built from the approved story (peek `concept/topics-level-up`,
 * `ExplorePage.tsx`), in the shape of Ship's Topics page and Leaf's Explore
 * topics: tabs All, Your topics, Other topics and Archived with their counts,
 * a search, and one row per topic with its team, members and last active, and
 * Join on a topic you are not in. It opens on All (Miky, 10 Nov).
 */
export function ExploreTopics({ onControl }: { onControl: (control: FileControl, file: ForeignObject) => void }) {
  // Opens on All, as the approved story and Slack's browse channels do (Miky, 10 Nov, at /land): the column beside it already lists yours.
  const [tab, setTab] = useState<ExploreTab>('all')
  const { state, retry } = useExploreTopics(tab)
  // Active counts back from when the page opened, as Ship's and Leaf's do.
  const [now] = useState(() => Date.now())
  // Join is Peek's own (its toast says what happened); the row turns yours at once, and back if the relay refuses.
  return <ExploreTopicsView state={state} tab={tab} onTab={setTab} onRetry={retry} onJoin={(topic) => onControl('join', topic)} now={now} />
}

/** `ExploreTopics` handed what it draws — the half a story can show. */
export function ExploreTopicsView({
  state,
  tab,
  onTab,
  onRetry,
  onJoin,
  now,
}: {
  state: ExploreState
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  onRetry: () => void
  onJoin: (topic: ForeignObject) => void
  /** What Active counts back from, in ms: when the page opened. */
  now: number
}) {
  const [query, setQuery] = useState('')
  const asked = query.trim()
  return (
    <Panel title="Explore topics" bodyClassName="flex flex-col gap-4 px-6 py-5">
      {state === 'loading' ? (
        <SkeletonList rows={8} />
      ) : 'failed' in state ? (
        <EmptyState icon={<IconTarget size={16} stroke={1.5} />} scope="page" message="Topics didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
      ) : (
        <ExploreBody lists={state} tab={tab} onTab={onTab} query={query} asked={asked} onQuery={setQuery} onJoin={onJoin} now={now} />
      )}
    </Panel>
  )
}

function ExploreBody({
  lists,
  tab,
  onTab,
  query,
  asked,
  onQuery,
  onJoin,
  now,
}: {
  lists: Record<ExploreTab, ExploreRow[]>
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  query: string
  asked: string
  onQuery: (query: string) => void
  onJoin: (topic: ForeignObject) => void
  now: number
}) {
  const rows = asked ? lists[tab].filter((row) => findsTopic(row.title, asked)) : lists[tab]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<ExploreTab> aria-label="Topics" tabs={TAB_ORDER.map((id) => ({ id, label: TABS[id], count: lists[id].length }))} active={tab} onChange={onTab} />
        <div className="w-64">
          <SearchInput placeholder="Find a topic" aria-label="Find a topic" value={query} onChange={(event) => onQuery(event.target.value)} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          scope="section"
          message={asked ? `No topic matches “${asked}”.` : lists.all.length === 0 && tab !== 'archived' ? EMPTY.all : EMPTY[tab]}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="hidden items-center gap-3 px-3 text-caption text-text-muted sm:flex">
            <span className="flex-1 pl-7">Name</span>
            <span className="w-28">Team</span>
            <span className="w-20">Members</span>
            <span className="w-24">Active</span>
            <span className="w-16" />
          </div>
          <div className="flex flex-col gap-px">
            {rows.map((row) => (
              <TopicRow key={row.address} row={row} now={now} onJoin={!row.yours && !row.archived ? () => onJoin(row.topic) : undefined} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * One topic, as Ship's and Leaf's `TopicRow`: its name and summary, its team,
 * how many people it lists, when anything last happened in it, and Join on a
 * live topic you are not in. A dash while a column is read; on a phone only
 * the name stays. It opens the topic's page with the Topics column beside it,
 * an archived one read-only.
 */
function TopicRow({ row, now, onJoin }: { row: ExploreRow; now: number; onJoin?: () => void }) {
  return (
    <div data-topic={row.address} className="relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-bg-hover">
      <KindIcon kind="topic" />
      <Link href={row.href} variant="plain" cover className="flex min-w-0 flex-1" onClick={() => rememberOpenedFrom(row.address, 'topics')}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-2 font-medium text-text-primary">{row.title}</span>
          {row.summary && <span className="truncate text-caption text-text-secondary">{row.summary}</span>}
        </span>
      </Link>
      <span className="hidden w-28 shrink-0 truncate text-caption text-text-secondary sm:block">{row.team ?? '–'}</span>
      <span className="hidden w-20 shrink-0 text-caption text-text-secondary sm:block">{row.members ?? '–'}</span>
      <span className="hidden w-24 shrink-0 items-center gap-1 text-caption text-text-secondary sm:flex">
        {row.archived && <IconArchive size={14} stroke={1.5} aria-label="Archived" />}
        {row.active ? formatActive(row.active * 1000, now) : '–'}
      </span>
      {/* After the covering link, `relative`, so it stays its own button. */}
      <span className="relative flex w-16 shrink-0 justify-end">
        {onJoin && (
          <Button size="small" variant="outlined" onClick={onJoin}>
            Join
          </Button>
        )}
      </span>
    </div>
  )
}
