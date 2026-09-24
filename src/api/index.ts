/**
 * Peek data-access seam (the rule: `.claude/rules/data-seam.md`).
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
export { useDmChannels, useDmVisibility } from '@/api/internal/dms'
/* `window.__readState()` — see src/nostr/useReadStateSync.ts (CRO-14). At module
   scope so it exists before anything asks, including on a cold URL load. */
import { installReadStateDiagnostic } from '@/nostr/useReadStateSync'
installReadStateDiagnostic()

/* `window.__promptContext()` — see src/nostr/promptContextDiagnostic.ts (INT-1).
   Same reason and the same module-load registration. */
import { installPromptContextDiagnostic } from '@/nostr/promptContextDiagnostic'
installPromptContextDiagnostic()

/* `window.__follows()` — see src/nostr/useFollowsSync.ts (FOL-30). Same again. */
import { installFollowsDiagnostic } from '@/nostr/useFollowsSync'
installFollowsDiagnostic()

/* `window.__wideFilters()` — see src/nostr/liveTopics.ts (FOL-40). Same again. */
import { installWideFilterDiagnostic } from '@/nostr/liveTopics'
installWideFilterDiagnostic()

/* `window.__teamUnread()` — the other end of the same path (FOL-40): what the
   sidebar did with a delivery `__wideFilters()` proved arrived. */
import { installTeamUnreadDiagnostic } from '@/api/teamUnreadDiagnostic'
installTeamUnreadDiagnostic()

/* `window.__relayReads()` — see src/nostr/relayMeter.ts (PER-8): how many
   requests this tab spent against the relay's per-minute meter, by shape. */
import { installRelayReadsDiagnostic } from '@/nostr/relayMeter'
installRelayReadsDiagnostic()
export * from './messages'
export * from './actions'
export * from './profile'
export * from './uploads'
export * from './screener'
export { useForeignObjects, useResolvedReferences, useRouteWords, useWorkspaceDirectory, useMessageSearch, type MessageHit } from './foreign'
export { formatDateLabel, formatReplyTimestamp, formatTimestamp } from './format'
export { useAvatarSrc } from './avatars'
export { mentionPeople } from './mentions'
export { useStarred } from '@/api/internal/starred'
export { useFollows, type Follows } from '@/api/internal/follows'
export { PeekDataProvider, hasConvex } from './store'
export { RELAY_URL, hasRelay } from './relayUrl'
export {
  prefetchFolderContents,
  topLevelFolders,
  useFolderContents,
  useFolders,
  type FolderContentsState,
} from './useFolderContents'
export {
  useForeignConversation,
  useFileAddress,
  rememberFileAddress,
  forgetFileAddresses,
  useForeignChildren,
  useFileThreads,
  type FileAddressState,
  type ForeignConversationState,
  type ForeignChildrenState,
  type FileThreadsState,
} from './useForeignConversation'
export {
  useFileConversation,
  conversationKeyOf,
  type FileConversationState,
  type FileConversationActions,
  type ConversationContainer,
  type ConversationEvent,
  type FileConversation,
  type OutgoingAttachment,
  type WriteResult,
} from './useFileConversation'
export { useConversationBadges } from './useConversationBadges'
export { useTeamUnread } from './useTeamUnread'
