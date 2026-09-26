import { useCallback, useId } from 'react'
import { EnterHint, MenuItem, MenuSection } from '@estiva-app/ui'
import { Avatar } from './Avatar'
import { type Person } from '@/api'

/**
 * The people picker the composer's @-mention opens. Rows are the shared
 * MenuItem at its tall size (2026-09-01): the face, the name, the role line,
 * and the shared EnterHint while highlighted. Keyboard follows the highlight
 * through the row ref, as before.
 *
 * **It draws no box of its own** (D47, 2026-09-12). The box, its placement and
 * its scrolling are the package `Popover`'s, which the extension opens against
 * the caret. What is left here is the rows.
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
  const base = useId()

  if (people.length === 0) return null

  const section = isUrgent ? 'Urgent mention' : 'People'
  /* A row is an `option` in the popup's listbox (P28): an id for the editor's
   `aria-activedescendant` to point at, `aria-selected` on the highlighted one,
   and `tabIndex={-1}` because focus stays in the text — the row is reached by
   the arrow keys through the editor, never by Tab. `SuggestionPopover` does
   the rest. */
  return (
    <div role="group" aria-label={section}>
    <MenuSection label={section} className="px-3 py-1">
          {people.map((person, i) => (
            // @estiva-escape(no-rebuilt-behaviour): a row of a list the editor drives from its caret; Base UI's lists need a text field of their own, and the editor is not one (D47, UIG-8; one shared part later, UIG-31)
            <MenuItem
              key={person.id}
              role="option"
              id={`${base}-${i}`}
              aria-selected={i === highlight}
              tabIndex={-1}
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
    </div>
  )
}
