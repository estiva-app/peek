import { cn } from '@/lib/utils'

/**
 * The accent dot that says "something new here": a 6px disc centred in a
 * 24px slot, so it sits where a control would and the row does not shift when
 * one replaces the other.
 *
 * This was the same two lines in four files — `PersonRow`, `ConversationCard`,
 * `ReplyCard`, `HuddleCard` — before the Folder listing needed a fifth
 * (FOL-16), which is the moment UI-RULES §1 says it is a component. The package
 * has nothing for it yet; when it does, this file becomes a re-export.
 *
 * Purely visual: the row that draws it says "unread" in its own accessible
 * name, because a coloured disc reads as nothing to a screen reader.
 * @registry reusable: stays in Peek (Katerina, 18 September)
 */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <div className={cn('w-6 h-6 flex items-center justify-center shrink-0', className)} data-unread>
      <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
    </div>
  )
}
