import { ConfirmDialog } from '@estiva-app/ui'

/**
 * The question asked before a deletion — a message, a reply, a huddle or a
 * topic — on the package's `ConfirmDialog` (D56, 2026-09-10). Until then every
 * Delete in Peek fired on the click (PEEK-ADOPTION.md 13.7).
 *
 * The words are plain and true to what happens (CON-3): Peek asks the relay
 * to delete, the relay decides, and copies held by other apps are untouched.
 * Escape and ✕ cancel; a press on the backdrop does not (D20).
 * @registry reusable: Peek's own words for what is deleted; the package's ConfirmDialog is the shared part
 */
export function ConfirmDelete({
  what,
  replies = 0,
  onConfirm,
  onClose,
}: {
  what: 'message' | 'reply' | 'huddle' | 'topic'
  /** How many replies a message would leave behind — they are separate events. */
  replies?: number
  onConfirm: () => Promise<boolean | void> | boolean | void
  onClose: () => void
}) {
  const noun = what === 'topic' ? 'topic' : what === 'huddle' ? 'huddle' : what === 'reply' ? 'reply' : 'message'
  return (
    <ConfirmDialog
      title={`Delete this ${noun}?`}
      confirmLabel={`Delete ${noun}`}
      destructive
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        Peek asks the relay to delete it. The relay decides, and copies held by other apps are unaffected.
      </p>
      {what === 'topic' && (
        <p>If the relay keeps the topic, Peek will say so; other apps can still read it until then.</p>
      )}
      {replies > 0 && (
        <p>
          Its {replies} {replies === 1 ? 'reply is a separate event and stays' : 'replies are separate events and stay'}.
        </p>
      )}
    </ConfirmDialog>
  )
}
