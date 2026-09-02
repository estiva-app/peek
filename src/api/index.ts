/**
 * Peek data-access seam (see PRODUCTION-PLAN.md).
 *
 * The ONLY module tree components and pages may read app data through.
 * Convex queries/mutations serve every entity when a deployment is
 * configured (override providers cover the optimistic window); without one
 * the static mocks in src/data merged with the override providers serve
 * everything (tests, Storybook, demo instance).
 */
export * from './types'
export * from './reference'
export * from './directory'
export * from './unread'
export * from './desk'
export * from './currentUser'
export * from './people'
export * from './topics'
/* `window.__readState()` — see src/nostr/useReadStateSync.ts (CRO-14). At module
   scope so it exists before anything asks, including on a cold URL load. */
import { installReadStateDiagnostic } from '@/nostr/useReadStateSync'
installReadStateDiagnostic()
export * from './huddles'
export * from './messages'
export * from './actions'
export * from './profile'
export * from './uploads'
export * from './screener'
export { useForeignObjects, useWorkspaceDirectory, useMessageSearch, type MessageHit } from './foreign'
export { formatDateLabel, formatReplyTimestamp } from './format'
export { useAvatarSrc } from './avatars'
export { mentionPeople, mentionTopics } from './mentions'
export { useStarred } from '@/api/internal/starred'
export { PeekDataProvider, hasConvex } from './store'
