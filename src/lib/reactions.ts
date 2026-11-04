import { CURRENT_USER_NAME, type ReactionData } from '@/api'
import { REACTION_EMOJI } from '@estiva-app/conversation'
import type { ReactionRowProps } from '@estiva-app/ui'

/** The five every app offers, each with the word for it (`@estiva-app/conversation`,
 *  SPEC §6.6), as the package's `ReactionPicker` and `ReactionRow` take them. */
export const REACTION_OPTIONS = REACTION_EMOJI.map(({ emoji, name }) => ({ emoji, label: name }))

/**
 * What the relay said about a reaction, the refusal as it came: the kit's card
 * says it under the message ("Not reacted: <reason>."), in the shared words, until
 * the next reaction on that card or until the card goes (ONE-4).
 */
export type ReactionAnswer = Exclude<Awaited<ReturnType<NonNullable<ReactionRowProps['onToggle']>>>, void>

/** Your reaction with `emoji` on or off, drawn at once (OPT-8): your name added to it, or taken off, and an emptied pill dropped. */
export function toggledReaction(reactions: readonly ReactionData[], emoji: string): ReactionData[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (!existing) return [...reactions, { emoji, by: [CURRENT_USER_NAME] }]
  const by = existing.by.includes(CURRENT_USER_NAME) ? existing.by.filter((n) => n !== CURRENT_USER_NAME) : [...existing.by, CURRENT_USER_NAME]
  return by.length === 0 ? reactions.filter((r) => r !== existing) : reactions.map((r) => (r === existing ? { ...r, by } : r))
}
