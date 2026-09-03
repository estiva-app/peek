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
  FigmaFrame,
  FrameKind,
  FrameArtVariant,
} from '@/data/figmaData'
export type {
  FileCategory,
  AppFile,
  DocumentFile,
  FileItem,
  AppCategory,
} from '@/data/filesData'
