import { Reaction as SharedReaction } from '@estiva-app/ui'
import { WithTooltip } from './WithTooltip'

/**
 * Peek's reaction: the shared pill, plus the vocabulary and the hover label
 * that are Peek's.
 *
 * **This file used to be the recorded example of a fork** — a
 * hand-rolled `<button>` re-typing Chip's class list with a border added,
 * written because nothing in the package could be a pill with a count that
 * toggles. `@estiva-app/ui@0.7.0` added `Reaction`, so the drawing is the
 * package's now and what stays here is what only Peek knows: which emoji it
 * offers, what each one means, and how it says who reacted.
 *
 * That split is the rule in `.claude/rules/peek-ui.md` working — the app
 * file shrinks rather than
 * disappearing. It is not a one-line re-export because the call sites speak
 * Peek's language (`owner`, `names`), and translating those is exactly what a
 * wrapper is for.
 *
 * The `aria-label` is built here for the same reason the package demands one:
 * the emoji is decorative and the count is the only visible text, so an
 * unnamed control is announced as a bare number. Peek has the names, so Peek
 * supplies it.
 * @registry reusable: stays in Peek (Katerina, 18 September): estiva-ui's Reaction with Peek's reaction words
 */

/** Canonical meaning of each pickable reaction emoji (picker tooltips +
 *  "reacted with …" pill tooltips). */
export const REACTION_NAMES: Record<string, string> = {
  '👍': 'Makes sense',
  '💯': 'Agree',
  '🙏': 'Thank you',
  '🚀': "Let's go!",
  '🎉': 'Congrats',
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Slack-style hover label: "Ana, Ben and You reacted with Thank you".
 *  Without names (static mock reactions) it degrades to the reaction name. */
export function reactionTooltipLabel(emoji: string, names?: string[]): string {
  const reactionName = REACTION_NAMES[emoji] ?? emoji
  if (!names || names.length === 0) return reactionName
  return `${joinNames(names)} reacted with ${reactionName}`
}

interface ReactionProps {
  emoji: string
  count: number
  owner?: 'yours' | 'others'
  /** Reactors in reaction order (viewer as 'You') — shown in the tooltip. */
  names?: string[]
  onClick?: () => void
  className?: string
}

export function Reaction({
  emoji,
  count,
  owner = 'others',
  names,
  onClick,
  className,
}: ReactionProps) {
  return (
    <WithTooltip label={reactionTooltipLabel(emoji, names)}>
      <SharedReaction
        emoji={emoji}
        count={count}
        /* `owner` is Peek's word for it; `pressed` is the package's, and it is
           what reaches assistive tech as a toggle rather than as a colour. */
        pressed={owner === 'yours'}
        onClick={onClick}
        className={className}
        aria-label={`${REACTION_NAMES[emoji] ?? emoji}, ${count}`}
      />
    </WithTooltip>
  )
}
