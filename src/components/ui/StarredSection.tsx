import { CollapsibleSection } from '@estiva-app/ui'
import { PersonRow } from './PersonRow'
import { EmptyState } from './EmptyState'
import type { TopicStateType, TopicStateStatus } from './TopicState'

export interface StarredItem {
  id: string
  name: string
  type?: TopicStateType
  topicStatus?: TopicStateStatus
  isUnread?: boolean
  isUrgent?: boolean
  avatarSrc?: string
  memberCount?: number
}

interface StarredSectionProps {
  items?: StarredItem[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  className?: string
}

/**
 * The Starred accordion of the People page, on the package's
 * `CollapsibleSection` (PEEK-ADOPTION.md §4.8, D42): the header is the same
 * 32px row with the chevron and the label, but the title is a real button
 * now (Enter and Space fold it), the rows slide, find-in-page can open a
 * closed section, and this browser remembers whether you left it open.
 *
 * A closed section stays closed whatever is selected inside it — her ruling
 * (2026-09-09): the reader closed it.
 */
export function StarredSection({
  items = [],
  selectedId,
  onSelect,
  className,
}: StarredSectionProps) {
  const isEmpty = items.length === 0

  return (
    <CollapsibleSection title="Starred" storageKey="peek.people.starred" className={className} contentClassName="gap-1 mt-1">
      {isEmpty ? (
        /* One section of the page is empty: the line alone, left, no icon
           (B18, D41) — where a hand-made paragraph stood until 2026-09-10.
           Level with the rows (Katerina, 2026-09-14): each PersonRow pads
           itself, so the line takes a row's inset here, never on EmptyState. */
        <div className="px-2 py-1">
          <EmptyState scope="section" message="Favorite the conversations of People or Topics you interact mostly with" />
        </div>
      ) : (
        items.map((item) => (
          <PersonRow
            key={item.id}
            name={item.name}
            type={item.type}
            topicStatus={item.topicStatus}
            isUnread={item.isUnread}
            isUrgent={item.isUrgent}
            isSelected={selectedId === item.id}
            avatarSrc={item.avatarSrc}
            memberCount={item.memberCount}
            onClick={() => onSelect?.(item.id)}
          />
        ))
      )}
    </CollapsibleSection>
  )
}
