/**
 * Domain types, re-exported through the data-access seam.
 *
 * Components import these from '@/api' — never from '@/data/*' — so that
 * Phase 2 (Convex) can change the backing shapes in one place. During
 * Phase 1 they are pure re-exports of the mock-module types.
 */
export type {
  Topic,
  HighlightType,
  ReactionData,
  FileAttachment,
  ConversationData,
  ConvGroup,
} from '@/data/topicData'
export type { ReplyData } from '@/data/replyData'
export type { Person } from '@/data/peopleData'
export type { Huddle } from '@/data/huddleData'
export type { ScreenerItem } from '@/data/screenerData'
export type { OpenWorkItem, UrgentItem, StarredEntry } from '@/data/deskData'
export type {
  FileCategory,
  DocumentFile,
  FileItem,
} from '@/data/filesData'

/**
 * What came of a rename.
 *
 * `null` is clean. The two failures are **not** the same thing and must not
 * look the same: an `error` means nothing changed, and a `warning` means the
 * object *was* renamed but not everywhere. Collapsing them showed a red message
 * under a rename that had plainly worked (Katerina, 2026-08-20).
 */
export type RenameOutcome = null | { kind: 'error' | 'warning'; message: string }
