import { useEffect, useSyncExternalStore } from 'react'
import { CURRENT_USER_NAME, type ReactionData } from '@/api'

/** Your reaction with `emoji` on or off, drawn at once (OPT-8): your name added to it, or taken off, and an emptied pill dropped. */
export function toggledReaction(reactions: readonly ReactionData[], emoji: string): ReactionData[] {
  const existing = reactions.find((r) => r.emoji === emoji)
  if (!existing) return [...reactions, { emoji, by: [CURRENT_USER_NAME] }]
  const by = existing.by.includes(CURRENT_USER_NAME) ? existing.by.filter((n) => n !== CURRENT_USER_NAME) : [...existing.by, CURRENT_USER_NAME]
  return by.length === 0 ? reactions.filter((r) => r !== existing) : reactions.map((r) => (r === existing ? { ...r, by } : r))
}

/**
 * Reactions the relay refused, by the id of the message reacted to. The
 * reaction is already taken back (OPT-8); what stays is why, said under the
 * message ("Not reacted: …") as Ship and Leaf say it, with no toast. Kept only
 * while a card draws the message, and until the person reacts there again.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
 */
const refused = new Map<string, string>()
const listeners = new Set<() => void>()
/** How many cards draw each message now: a refusal none of them draws still needs a note. */
const drawn = new Map<string, number>()

const changed = () => {
  for (const listener of listeners) listener()
}

/** The relay refused a reaction on `id`, for `reason`. True when a card drawing the message is on screen to say so. */
export function refuseReaction(id: string, reason: string): boolean {
  if ((drawn.get(id) ?? 0) === 0) return false
  refused.set(id, reason)
  changed()
  return true
}

/** Reacting on `id` again: the old reason goes. */
export function clearRefusedReaction(id: string): void {
  if (refused.delete(id)) changed()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Why the last reaction on `id` was refused, if it was; the card calling it counts as drawing the message. */
export function useRefusedReaction(id: string | undefined): string | undefined {
  useEffect(() => {
    if (!id) return
    drawn.set(id, (drawn.get(id) ?? 0) + 1)
    return () => {
      const left = (drawn.get(id) ?? 1) - 1
      if (left > 0) drawn.set(id, left)
      else {
        // The last card drawing it went: the line goes with it, as Ship's and Leaf's do.
        drawn.delete(id)
        refused.delete(id)
      }
    }
  }, [id])
  return useSyncExternalStore(subscribe, () => (id ? refused.get(id) : undefined))
}
