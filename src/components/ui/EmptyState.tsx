import { EmptyState as UiEmptyState, type EmptyStateProps as UiEmptyStateProps } from '@estiva-app/ui'

/**
 * Peek's EmptyState is the shared one (SHA-5, 2026-08-28). The shared
 * component has no words of its own; the one default Peek relied on —
 * "No conversation selected", for an empty conversation pane — stays here.
 */
export type EmptyStateProps = Omit<UiEmptyStateProps, 'message'> & { message?: string }

/**
 * The package's empty state, with Peek's default words when none are given:
 * "No conversation selected".
 * @registry reusable: stays in Peek (Katerina, 18 September): estiva-ui's EmptyState with Peek's default words
 */
export function EmptyState({ message = 'No conversation selected', ...rest }: EmptyStateProps) {
  return <UiEmptyState message={message} {...rest} />
}
