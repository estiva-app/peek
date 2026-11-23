import { useState, type ReactNode } from 'react'
import { Button, EmptyState, KindIcon, exploreWords, ListTable, ListTableRow, MembersPill, Panel, SearchInput, SkeletonList, Tabs, type AvatarGroupMember, type ListTableColumn } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { findsTopic, formatActive, useExploreTopics, useFaceOf, type ExploreRow, type ExploreState, type ExploreTab } from '@/api'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'
import { useReportFailure } from '@/lib/failureReports'

const TAB_ORDER: ExploreTab[] = ['all', 'yours', 'others', 'archived']

/** Nobody Peek can name: a dash, as the team page draws them. */
const NO_FACE = (): AvatarGroupMember => ({ name: '—' })

/** Its team stays longest; who is in it and when it was last active give way first in a narrow window (Katerina, 16 November). */
const COLUMNS: ListTableColumn[] = [
  { label: 'Team', width: 'large' },
  // The members pill's width: three faces and the number (Katerina, 17 November).
  { label: 'Members', width: 'large', keep: 'low' },
  { label: 'Active', width: 'medium', keep: 'low' },
]

/** Every word the page says about what it lists: the kit's for an initiative, as Ship's and Leaf's Explore say them, so its story shows what people see (review of 23 November, E1). */
const WORDS = exploreWords({ one: 'initiative', many: 'initiatives', a: 'an' })

/** Each row's ◎, the kit's KindIcon, the icon of the Initiatives column beside it (Katerina, 16 November, I-11; review of 23 November, C7). */
const ICON = <KindIcon kind="topic" tone="inherit" />

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
  useReportFailure(typeof state === 'object' && 'failed' in state ? 'not-loaded' : undefined)
  // Active counts back from when the page opened, as Ship's and Leaf's do.
  const [now] = useState(() => Date.now())
  const faceOf = useFaceOf()
  // Join is Peek's own (its toast says what happened); the row turns yours at once, and back if the relay refuses.
  return (
    <ExploreTopicsView
      state={state}
      tab={tab}
      onTab={setTab}
      onRetry={retry}
      onJoin={(topic) => onControl('join', topic)}
      now={now}
      faceOf={faceOf}
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
  faceOf = NO_FACE,
}: {
  state: ExploreState
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  onRetry: () => void
  onJoin: (topic: ForeignObject) => void
  /** What Active counts back from, in ms: when the page opened. */
  now: number
  /** A person's face by their key, for each row's members pill. Default a dash: the number alone tells. */
  faceOf?: (pubkey: string) => AvatarGroupMember
}) {
  const [query, setQuery] = useState('')
  const asked = query.trim()
  return (
    // 24px between the tabs and the list, the kit's step between a page's parts (Katerina, 16 November: 16 was too tight).
    <Panel title={WORDS.title} bodyClassName="flex flex-col gap-6 px-6 py-5">
      {state === 'loading' ? (
        <SkeletonList rows={8} />
      ) : state === 'signedOut' ? (
        <EmptyState scope="page" message={WORDS.signedOut} />
      ) : 'failed' in state ? (
        <EmptyState icon={ICON} scope="page" message={WORDS.failed} action={{ label: 'Try again', onClick: onRetry }} />
      ) : (
        <ExploreBody lists={state} tab={tab} onTab={onTab} query={query} asked={asked} onQuery={setQuery} onJoin={onJoin} now={now} faceOf={faceOf} />
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
  faceOf,
}: {
  lists: Record<ExploreTab, ExploreRow[]>
  tab: ExploreTab
  onTab: (tab: ExploreTab) => void
  query: string
  asked: string
  onQuery: (query: string) => void
  onJoin: (topic: ForeignObject) => void
  now: number
  faceOf: (pubkey: string) => AvatarGroupMember
}) {
  const rows = asked ? lists[tab].filter((row) => findsTopic(row.title, asked)) : lists[tab]
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<ExploreTab> aria-label={WORDS.title} tabs={TAB_ORDER.map((id) => ({ id, label: WORDS.tabs[id], count: lists[id].length }))} active={tab} onChange={onTab} />
        <div className="w-64">
          <SearchInput placeholder={WORDS.find} aria-label={WORDS.find} value={query} onChange={(event) => onQuery(event.target.value)} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          scope="section"
          message={asked ? WORDS.noMatch(asked) : lists.all.length === 0 && tab !== 'archived' ? WORDS.empty.all : WORDS.empty[tab]}
        />
      ) : (
        <ListTable aria-label={WORDS.title} columns={COLUMNS} end>
          {rows.map((row) => (
            <TopicRow key={row.address} row={row} now={now} faceOf={faceOf} icon={ICON} onJoin={!row.yours && !row.archived ? () => onJoin(row.topic) : undefined} />
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
 * columns giving way. Who is in it is the kit's members pill, nothing to press:
 * up to three faces and the number (Katerina, 17 November). The Archived tab says it is archived; the
 * row no longer does it again inside its date. It opens the topic's page with
 * the Topics column beside it, an archived one read-only.
 */
function TopicRow({ row, now, faceOf, icon, onJoin }: { row: ExploreRow; now: number; faceOf: (pubkey: string) => AvatarGroupMember; icon: ReactNode; onJoin?: (() => void) | undefined }) {
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
        row.members === undefined ? undefined : row.members === 0 ? '0' : (
          <MembersPill readOnly members={(row.people ?? []).slice(0, 3).map(faceOf)} count={row.members} />
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
