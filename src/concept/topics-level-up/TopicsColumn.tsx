import type { ReactNode } from 'react'
import { EmptyState, ListColumn, NavItem, NavTree, SkeletonList, Toolbar } from '@estiva-app/ui'
import { NewTopicButton } from '@/components/views/HeaderStartTopic'
import { TopicState } from '@/components/ui/TopicState'
import type { Read, Topic } from './fixtures'

/**
 * **Peek's Topics column, levelled up** — a copy of `TopicsColumnView`
 * (`src/components/views/TopicsColumn.tsx`), changed only where this project
 * changes it (Miky, 3 and 6 Nov):
 *
 * - One flat list of every topic you're in, **newest activity first** (a
 *   message by anyone, the agent's too, a file added, or a save, status or
 *   comment on a file it lists). Today: A to Z.
 * - **No files under a topic** (today each topic folds to its files and an
 *   "Archived" line).
 * - **Explore topics** last, a row with no icon, in place of the "Other topics"
 *   and "Archived" sections.
 * - A row's "…" holds only what you do from a list (`menu`): see `PeekTopics`.
 *
 * The header, New topic, the row (`NavItem` with `TopicState`, as `TreeRow`
 * draws it), the dot, the skeleton and the failed line are today's.
 */
export function TopicsColumnView({
  topics,
  read,
  unread,
  selected,
  exploring,
  onOpen,
  onExplore,
  menu,
}: {
  /** Your topics, in the order to draw them. */
  topics: Topic[]
  read: Read
  unread: ReadonlySet<string>
  /** The open topic's id. */
  selected?: string
  /** Explore topics is open. */
  exploring: boolean
  onOpen: (id: string) => void
  onExplore: () => void
  /** A row's "…" items. */
  menu: (topic: Topic) => ReactNode
}) {
  return (
    <ListColumn
      title="Topics"
      actions={
        <Toolbar aria-label="Topic list actions" surface={false}>
          <NewTopicButton onClick={() => {}} />
        </Toolbar>
      }
    >
      {read === 'loading' ? (
        <SkeletonList />
      ) : read === 'failed' ? (
        <EmptyState scope="section" message="Couldn’t load your topics. Reload to try again." />
      ) : (
        <NavTree selected={selected}>
          {topics.length === 0 && <EmptyState scope="section" message="You’re in no topics yet." />}
          {topics.map((topic) => (
            <NavItem
              key={topic.id}
              data-file={topic.file.ref}
              href="#"
              label={topic.title}
              icon={<TopicState type="topic" status="unresolved" iconClassName={topic.id === selected || unread.has(topic.id) ? 'text-text-primary' : undefined} />}
              unread={unread.has(topic.id)}
              active={topic.id === selected}
              menu={menu(topic)}
              menuLabel="More options"
              onPlainClick={(event) => {
                event.preventDefault()
                onOpen(topic.id)
              }}
            />
          ))}
          {/* Where every other topic is, as Ship's Topics page lists them; no icon (Miky, 6 Nov). */}
          <NavItem
            href="#"
            label="Explore topics"
            active={exploring}
            onPlainClick={(event) => {
              event.preventDefault()
              onExplore()
            }}
          />
        </NavTree>
      )}
    </ListColumn>
  )
}
