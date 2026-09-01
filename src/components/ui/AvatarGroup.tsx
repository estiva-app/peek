import { Avatar } from './Avatar'

/** Up to 3 overlapping 24px avatars with a border-bg-surface outline — the member
 *  stack used in the ConversationHeader members pill. Matches the Figma members component.
 *
 *  The ring sits on the Avatar itself (2026-09-01): the old extra wrapper was a
 *  24px window minus a 2px border with a fixed 24px Avatar inside, so
 *  overflow-hidden clipped 4px of face — and the right edge of the initials
 *  with it, which is how "CO" rendered as "C(". One box, whole letters. */
export function AvatarGroup({ members }: { members: string[] }) {
  const visible = members.slice(0, 3)
  return (
    <div className="flex items-center pr-2">
      {visible.map((name, i) => (
        <Avatar
          key={i}
          size={24}
          name={name}
          alt={name}
          className="-mr-2 relative border-2 border-bg-surface"
        />
      ))}
    </div>
  )
}
