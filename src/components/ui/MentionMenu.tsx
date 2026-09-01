import { useCallback } from 'react'
import { EnterHint, MenuItem, MenuSection } from '@estiva-app/ui'
import { Avatar } from './Avatar'
import { type Person } from '@/api'

/**
 * The people picker the composer's @-mention opens. Rows are the shared
 * MenuItem at its tall size (2026-09-01): the face, the name, the role line,
 * and the shared EnterHint while highlighted. Keyboard follows the highlight
 * through the row ref, as before.
 */
export function MentionMenu({
  people,
  highlight,
  isUrgent,
  onSelect,
  onHighlightChange,
}: {
  people: Person[]
  highlight: number
  isUrgent: boolean
  onSelect: (person: Person) => void
  onHighlightChange: (index: number) => void
}) {
  const scrollRef = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (people.length === 0) return null

  return (
    <div className="w-[658px] max-h-[360px] overflow-y-auto bg-bg-elevated border border-border-default rounded-lg shadow-lg">
      <div className="p-2">
        <MenuSection label={isUrgent ? 'Urgent mention' : 'People'}>
          {people.map((person, i) => (
            <MenuItem
              key={person.id}
              size="tall"
              ref={i === highlight ? scrollRef : undefined}
              leading={<Avatar size={32} alt={person.name} />}
              label={person.name}
              description={person.role}
              selected={i === highlight}
              trailing={i === highlight ? <EnterHint /> : undefined}
              onMouseEnter={() => onHighlightChange(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(person)
              }}
            />
          ))}
        </MenuSection>
      </div>
    </div>
  )
}
