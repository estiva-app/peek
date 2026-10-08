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

/* `window.__membership()` — see src/nostr/useMembershipSync.ts (CON-19). Same again. */
import { installMembershipDiagnostic } from '@/nostr/useMembershipSync'
installMembershipDiagnostic()

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
export { useForeignObjects, useHeldObject, useResolvedReferences, useRouteWords, useWorkspaceDirectory, useMessageSearch, type MessageHit } from './foreign'
export { formatDateLabel, formatReplyTimestamp, formatTimestamp } from './format'
export { useAvatarSrc } from './avatars'
export { mentionPeople } from './mentions'
export { referenceSections, subscribeReferences, useReferenceFolder } from './references'
export { useStarred } from '@/api/internal/starred'
export { useMembership, type MembershipSeam } from '@/api/internal/membership'
export { useFileMembers } from '@/api/internal/fileMembers'
export type { StreamTerms } from '@/api/streamUnread'
export { PeekDataProvider } from './store'
export { RELAY_URL, hasRelay } from './relayUrl'
export {
  prefetchFolderContents,
  reloadFoldersOnScreen,
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
  relayAttachmentOf,
  type FileConversationState,
  type FileConversationActions,
  type ConversationContainer,
  type ConversationEvent,
  type FileConversation,
  type OutgoingAttachment,
  type WriteResult,
} from './useFileConversation'
export { useConversationBadges, useLiveConversationBadges } from './useConversationBadges'
export { useNewReplyThreads, useReplyOnlyThread, type ReplyStream } from './useNewReplyThreads'
export { useTeamUnread } from './useTeamUnread'
