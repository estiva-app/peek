import { Avatar, ChipInput, type ChipInputOption } from '@estiva-app/ui'
import { usePeople, type Person } from '@/api'

/**
 * Peek's people picker: the shared ChipInput (2026-09-01) given Peek's
 * directory and faces. The generic input knows nothing about people; this
 * wrapper maps Person → {id, label, description} for it, draws the faces
 * through the two leading slots (Peek's Avatar wrapper resolves the
 * pictures, exactly as the hand-rolled version did), and hands back the
 * caller's own Person objects — never the mapped ones, so nothing extra
 * rides into a mutation.
 *
 * Ruled visible changes against the hand-rolled picker: the chip is curved
 * (rounded-md), the face keeps the Avatar's own corners instead of a forced
 * circle, and it sits 2px from the edge.
 */
interface PersonChipInputProps {
  value: Person[]
  onChange: (next: Person[]) => void
  placeholder?: string
  /** It holds one person — an assignee: a later pick replaces the chosen one (the kit's `single`). */
  single?: boolean
}

const toOption = (p: Person): ChipInputOption => ({ id: p.id, label: p.name, description: p.role })

export function PersonChipInput({ value, onChange, placeholder = 'Search people...', single }: PersonChipInputProps) {
  const people = usePeople() ?? []
  const byId = new Map<string, Person>([...people, ...value].map((p) => [p.id, p]))
  return (
    <ChipInput
      value={value.map(toOption)}
      onChange={(next) => onChange(next.map((o) => byId.get(o.id)).filter((p): p is Person => p !== undefined))}
      options={people.map(toOption)}
      placeholder={placeholder}
      single={single}
      chipLeading={(o) => <Avatar size={16} name={o.label} alt={o.label} bot={byId.get(o.id)?.bot} />}
      rowLeading={(o) => <Avatar size={32} name={o.label} alt={o.label} bot={byId.get(o.id)?.bot} />}
    />
  )
}
