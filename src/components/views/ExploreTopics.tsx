import { useState, type ReactNode } from 'react'
import { IconTarget } from '@tabler/icons-react'
import { AvatarGroup, Button, EmptyState, KindIcon, ListTable, ListTableRow, Panel, SearchInput, SkeletonList, Tabs, type ListTableColumn } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { findsTopic, formatActive, useExploreTopics, type ExploreRow, type ExploreState, type ExploreTab } from '@/api'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'

const TAB_ORDER: ExploreTab[] = ['all', 'yours', 'others', 'archived']

/** Its team stays longest; who is in it and when it was last active give way first in a narrow window (Katerina, 16 November). */
const COLUMNS: ListTableColumn[] = [
  { label: 'Team', width: 'large' },
  { label: 'Members', width: 'small', keep: 'low' },
  { label: 'Active', width: 'medium', keep: 'low' },
]

/** Every word the page says about what it lists: Peek's topics by default; the navigation prototype passes its initiatives' (Katerina, 16 November). */
export interface ExploreWords {
  title: string
  tabs: Record<ExploreTab, string>
  /** What an empty tab says, in Ship's and Leaf's words; with nothing shown at all, every open tab says `all`'s. */
  empty: Record<ExploreTab, string>
  find: string
  noMatch: (asked: string) => string
  failed: string
  signedOut: string
}

const TOPIC_WORDS: ExploreWords = {
  title: 'Explore topics',
  tabs: { all: 'All', yours: 'Your topics', others: 'Other topics', archived: 'Archived' },
  empty: {
    all: 'No topics yet.',
    yours: 'You’re in no topics yet.',
    others: 'No other topics.',
    archived: 'No archived topics.',
  },
  find: 'Find a topic',
  noMatch: (asked) => `No topic matches “${asked}”.`,
  failed: 'Topics didn’t load.',
  signedOut: 'Sign in to see topics.',
}

/** The page in the new word (Katerina, 16 November, I-10: "renaming the title should work too"), as the navigation prototype words it. */
const INITIATIVE_WORDS: ExploreWords = {
  title: 'Explore initiatives',
  tabs: { all: 'All', yours: 'Your initiatives', others: 'Other initiatives', archived: 'Archived' },
  empty: {
    all: 'No initiatives yet.',
    yours: 'You’re in no initiatives yet.',
    others: 'No other initiatives.',
    archived: 'No archived initiatives.',
  },
  find: 'Find an initiative',
  noMatch: (asked) => `No initiative matches “${asked}”.`,
  failed: 'Initiatives didn’t load.',
  signedOut: 'Sign in to see initiatives.',
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
  // Explore initiatives (Katerina, 16 November): its words, and ◎ on every row, the icon of the column beside it (I-11).
  return (
    <ExploreTopicsView
      state={state}
      tab={tab}
      onTab={setTab}
      onRetry={retry}
      onJoin={(topic) => onControl('join', topic)}
      now={now}
      words={INITIATIVE_WORDS}
      icon={<IconTarget size={16} stroke={1.5} aria-hidden />}
    />
  )
}

/** `ExploreTopics` handed what it draws — the half a story can show. */
export function ExploreTopicsView({
  state,
  tab,
  onTab,
  onRetry,
  onJoin,
  now,
  words = TOPIC_WORDS,
  icon = <KindIcon kind="topic" />,
}: {
  state: ExploreState
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  onRetry: () => void
  onJoin: (topic: ForeignObject) => void
  /** What Active counts back from, in ms: when the page opened. */
  now: number
  /** What it calls what it lists. Default Peek's topics. */
  words?: ExploreWords
  /** Each row's icon, its kind's: the same as the column beside it draws (Katerina, 16 November). Default a topic's. */
  icon?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const asked = query.trim()
  return (
    // 24px between the tabs and the list, the kit's step between a page's parts (Katerina, 16 November: 16 was too tight).
    <Panel title={words.title} bodyClassName="flex flex-col gap-6 px-6 py-5">
      {state === 'loading' ? (
        <SkeletonList rows={8} />
      ) : state === 'signedOut' ? (
        <EmptyState scope="page" message={words.signedOut} />
      ) : 'failed' in state ? (
        <EmptyState icon={<IconTarget size={16} stroke={1.5} />} scope="page" message={words.failed} action={{ label: 'Try again', onClick: onRetry }} />
      ) : (
        <ExploreBody lists={state} tab={tab} onTab={onTab} query={query} asked={asked} onQuery={setQuery} onJoin={onJoin} now={now} words={words} icon={icon} />
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
  words,
  icon,
}: {
  lists: Record<ExploreTab, ExploreRow[]>
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  query: string
  asked: string
  onQuery: (query: string) => void
  onJoin: (topic: ForeignObject) => void
  now: number
  words: ExploreWords
  icon: ReactNode
}) {
  const rows = asked ? lists[tab].filter((row) => findsTopic(row.title, asked)) : lists[tab]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<ExploreTab> aria-label={words.title} tabs={TAB_ORDER.map((id) => ({ id, label: words.tabs[id], count: lists[id].length }))} active={tab} onChange={onTab} />
        <div className="w-64">
          <SearchInput placeholder={words.find} aria-label={words.find} value={query} onChange={(event) => onQuery(event.target.value)} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          scope="section"
          message={asked ? words.noMatch(asked) : lists.all.length === 0 && tab !== 'archived' ? words.empty.all : words.empty[tab]}
        />
      ) : (
        <ListTable aria-label={words.title} columns={COLUMNS} end>
          {rows.map((row) => (
            <TopicRow key={row.address} row={row} now={now} icon={icon} onJoin={!row.yours && !row.archived ? () => onJoin(row.topic) : undefined} />
          ))}
        </ListTable>
      )}
    </>
  )
}

/**
 * One topic, as Ship's and Leaf's `TopicRow`: its name and summary, its team,
 * who is in it, when anything last happened in it, and Join on a live topic
 * you are not in — the kit's list row, which draws the row, the dashes and the
 * columns giving way. Who is in it is their faces with the number where the
 * faces are known, else the number. The Archived tab says it is archived; the
 * row no longer does it again inside its date. It opens the topic's page with
 * the Topics column beside it, an archived one read-only.
 */
function TopicRow({ row, now, icon, onJoin }: { row: ExploreRow; now: number; icon: ReactNode; onJoin?: (() => void) | undefined }) {
  return (
    <ListTableRow
      data-topic={row.address}
      href={row.href}
      label={row.title}
      {...(row.summary ? { description: row.summary } : {})}
      icon={icon}
      onClick={() => rememberOpenedFrom(row.address, 'topics')}
      cells={[
        row.team,
        row.members === undefined ? undefined : (
          <>
            {row.people && row.people.length > 0 && <AvatarGroup members={row.people} size={20} />}
            {row.members}
          </>
        ),
        row.active ? formatActive(row.active * 1000, now) : undefined,
      ]}
      end={
        // Outlined on a list's rows, where many are on screen; a place's own header has it primary (kit Button, 16 November).
        onJoin && (
          <Button size="small" variant="outlined" onClick={onJoin}>
            Join
          </Button>
        )
      }
    />
  )
}
