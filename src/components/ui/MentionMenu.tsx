import { EnterHint } from '@estiva-app/ui'
import type { SuggestionPopupOptions } from '@estiva-app/ui/editor'
import { Avatar } from './Avatar'
import { type Person } from '@/api'

/**
 * The people picker the composer's `@` (and `!@`) opens: which rows, and what
 * each shows. Rows are the shared MenuItem at its tall size (2026-09-01): the
 * face, the name, the role line, and the shared EnterHint while highlighted.
 *
 * The list — the box at the caret, the keys, the highlight, the scrolling, what
 * a screen reader is told — is the package's `SuggestionMenu` since UIG-31
 * (estiva-ui 0.45.0), drawn by `suggestionPopup` in `mention.tsx`. One change
 * came with it: the arrows wrap at the ends, as the `/` menu's always did.
 */
export function peopleMenu(isUrgent: boolean): SuggestionPopupOptions<Person> {
  const section = isUrgent ? 'Urgent mention' : 'People'
  return {
    ariaLabel: section,
    // The people and the files menus are the same box: 658px, capped at 360 (D47).
    width: 'w-[658px]',
    maxHeight: 'max-h-[360px]',
    sections: (people) => [{ label: section, items: people, className: 'px-3 py-1' }],
    itemKey: (person) => person.id,
    row: (person) => ({
      label: person.name,
      description: person.role,
      leading: <Avatar size={32} alt={person.name} />,
      hint: <EnterHint />,
      size: 'tall',
    }),
  }
}
