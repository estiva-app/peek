import { useState } from 'react'
import { IconArchive, IconTarget } from '@tabler/icons-react'
import { Button, EmptyState, KindIcon, Link, Panel, SearchInput, SkeletonList, Tabs } from '@estiva-app/ui'
import { TOPICS, yourTopics, type Person, type Read, type Topic } from './fixtures'

type ExploreTab = 'all' | 'yours' | 'others' | 'archived'
const TABS: Record<ExploreTab, string> = { all: 'All', yours: 'Your topics', others: 'Other topics', archived: 'Archived' }
const byTitle = (a: Topic, b: Topic) => a.title.localeCompare(b.title)

/**
 * **Explore topics** — NEW in Peek, drawn in the shape of Ship's Topics page
 * (estiva-ship `src/views/TopicsView.tsx` and `TopicRow.tsx` on main): the
 * tabs All, Your topics, Other topics and Archived, each counted, over one row
 * per topic. What this adds to Ship's shape (Miky, 3 and 6 Nov):
 *
 * - **A search** beside the tabs.
 * - **All, Other topics and Archived are A to Z**, like browsing channels in
 *   Slack; **Your topics keeps the sidebar's order**, newest activity first.
 * - **Join** on a topic you're not in. An archived topic opens read-only.
 *
 * The row says what Peek knows of a topic: its team, its members and when it
 * last moved, where Ship's says its projects and conversations.
 */
export function ExplorePage({ viewer, read, joined, onJoin, onOpen, onRetry }: {
  viewer: Person
  read: Read
  /** Topics joined from here, in this story. */
  joined: ReadonlySet<string>
  onJoin: (id: string) => void
  onOpen: (id: string) => void
  onRetry: () => void
}) {
  const [tab, setTab] = useState<ExploreTab>('all')
  const [query, setQuery] = useState('')
  const isMine = (t: Topic) => t.members.includes(viewer) || joined.has(t.id)
  const live = TOPICS.filter((t) => !t.archived)
  const lists: Record<ExploreTab, Topic[]> = {
    all: [...live].sort(byTitle),
    yours: [...yourTopics(viewer), ...live.filter((t) => joined.has(t.id))],
    others: live.filter((t) => !isMine(t)).sort(byTitle),
    archived: TOPICS.filter((t) => t.archived).sort(byTitle),
  }
  const words = query.trim().toLowerCase()
  const rows = lists[tab].filter((t) => !words || t.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(words)) || t.title.toLowerCase().startsWith(words))

  return (
    <Panel title="Explore topics" bodyClassName="flex flex-col gap-4 px-6 py-5">
      {read === 'loading' ? (
        <SkeletonList rows={8} />
      ) : read === 'failed' ? (
        <EmptyState icon={<IconTarget size={16} stroke={1.5} />} scope="page" message="Topics didn’t load." action={{ label: 'Try again', onClick: onRetry }} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs<ExploreTab> aria-label="Topics" tabs={(Object.keys(TABS) as ExploreTab[]).map((id) => ({ id, label: TABS[id], count: lists[id].length }))} active={tab} onChange={setTab} />
            <div className="w-64">
              <SearchInput placeholder="Find a topic" aria-label="Find a topic" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              scope="section"
              message={words ? `No topic is called “${query}”.` : tab === 'archived' ? 'No archived topics.' : tab === 'yours' ? 'You are in no topic yet.' : tab === 'others' ? 'No other topics.' : 'No topics yet.'}
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
              {/* Rows as Ship's Topics page draws them (TopicRow). */}
              <div className="flex flex-col gap-px">
                {rows.map((t) => (
                  <div key={t.id} data-topic={t.file.address} className="relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-bg-hover">
                    <KindIcon kind="topic" />
                    <Link
                      href="#"
                      variant="plain"
                      cover
                      className="flex min-w-0 flex-1"
                      onClick={(event) => {
                        event.preventDefault()
                        onOpen(t.id)
                      }}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body-2 font-medium text-text-primary">{t.title}</span>
                        {t.summary && <span className="truncate text-caption text-text-secondary">{t.summary}</span>}
                      </span>
                    </Link>
                    <span className="hidden w-28 shrink-0 truncate text-caption text-text-secondary sm:block">{t.team}</span>
                    <span className="hidden w-20 shrink-0 text-caption text-text-secondary sm:block">{t.members.length + (joined.has(t.id) ? 1 : 0)}</span>
                    <span className="hidden w-24 shrink-0 items-center gap-1 text-caption text-text-secondary sm:flex">
                      {t.archived && <IconArchive size={14} stroke={1.5} aria-label="Archived" />}
                      {t.atLabel}
                    </span>
                    <span className="relative z-10 flex w-16 shrink-0 justify-end">
                      {!t.archived && !isMine(t) && (
                        <Button size="small" variant="outlined" onClick={() => onJoin(t.id)}>
                          Join
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}
