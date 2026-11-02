import { CollapsibleSection, EmptyState } from '@estiva-app/ui'
import { PersonItem } from './PersonItem'

/** A starred person. Starred holds people only since the Convex topics went (FOL-23). */
export interface StarredItem {
  id: string
  name: string
  isUnread?: boolean
  isUrgent?: boolean
  avatarSrc?: string
}

interface StarredSectionProps {
  items?: StarredItem[]
  selectedId?: string | null
  /** A row's Open work item on its ⋮: add or remove; undefined offers none. */
  openWorkActionFor?: (id: string) => 'add' | 'remove' | undefined
  onToggleOpenWork?: (id: string) => void
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
  openWorkActionFor,
  onToggleOpenWork,
  className,
}: StarredSectionProps) {
  const isEmpty = items.length === 0

  return (
    <CollapsibleSection title="Starred" storageKey="peek.people.starred" className={className} contentClassName="gap-1 mt-1">
      {isEmpty ? (
        /* One section of the page is empty: the line alone, left, no icon
           (B18, D41) — where a hand-made paragraph stood until 2026-09-10.
           Level with the rows (Katerina, 2026-09-14): each row pads
           itself, so the line takes a row's inset — the kit's `rows` scope. */
        <EmptyState scope="rows" message="Favorite the conversations of People or Topics you interact mostly with" />
      ) : (
        items.map((item) => (
          <PersonItem
            key={item.id}
            id={item.id}
            name={item.name}
            avatarSrc={item.avatarSrc}
            unread={item.isUnread}
            urgent={item.isUrgent}
            active={selectedId === item.id}
            openWorkAction={openWorkActionFor?.(item.id)}
            onToggleOpenWork={onToggleOpenWork ? () => onToggleOpenWork(item.id) : undefined}
          />
        ))
      )}
    </CollapsibleSection>
  )
}
