import { useCallback } from 'react'
import { EnterHint, MenuItem, MenuPanel, MenuSection } from '@estiva-app/ui'
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
    <MenuPanel className="max-h-[360px] w-[658px] gap-2 overflow-y-auto">
      <MenuSection label={isUrgent ? 'Urgent mention' : 'People'} className="px-3 py-1">
          {people.map((person, i) => (
            <MenuItem
              key={person.id}
              size="tall"
              ref={i === highlight ? scrollRef : undefined}
              leading={<Avatar size={32} alt={person.name} />}
              label={person.name}
              description={person.role}
              selected={i === highlight}
              hint={<EnterHint />}
              onMouseEnter={() => onHighlightChange(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(person)
              }}
            />
          ))}
      </MenuSection>
    </MenuPanel>
  )
}
