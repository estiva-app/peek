import { FieldLine, ReactionRow } from '@estiva-app/ui'
import { CURRENT_USER_NAME, type ReactionData } from '@/api'
import { REACTION_OPTIONS } from '../ConversationQuickMenu'

/**
 * A message's reactions in Peek: the package's `ReactionRow` — the pills, who
 * reacted on hover, and its add button — the same row as Ship and Leaf
 * (PEEKM-5). Peek's part is only what it knows: reactors come by name, the
 * viewer as `CURRENT_USER_NAME`, under the message's indent, and why the last
 * reaction was refused.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-writes-and-reacts-with-one-shared-box.md
 */
export function MessageReactions({ reactions, refused, onToggle }: {
  reactions: readonly ReactionData[]
  /** Why the last reaction here was refused, said as Ship and Leaf say it. */
  refused?: string
  /** Absent, the pills only show (an archived file). */
  onToggle?: (emoji: string) => void
}) {
  const shown = reactions.some((r) => r.by.length > 0)
  if (!shown && !refused) return null
  return (
    // The add button's picker opens in a portal, and a click on it bubbles here: it is not a click on the message.
    <div className="flex flex-col gap-1 pl-8 pt-1 pb-2 w-full" onClick={(e) => e.stopPropagation()}>
      <ReactionRow reactions={reactions} options={REACTION_OPTIONS} nameOf={(name) => name} viewer={CURRENT_USER_NAME} onToggle={onToggle} />
      {refused && <FieldLine tone="error">Not reacted: {refused}.</FieldLine>}
    </div>
  )
}
