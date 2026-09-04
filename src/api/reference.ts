/**
 * Static reference data behind the seam.
 *
 * Two categories live here:
 *
 * 1. Third-party integration mocks (files, Figma frames).
 *    These stay static by design — they mock integrations that are a
 *    separate, later project (see PRDs/Peek-Domain-Model.md §6).
 *
 * 2. Presentation constants + non-reactive snapshots of app data
 *    (HIGHLIGHT_META, PEOPLE, TOPICS, avatarFor). The snapshots exist for
 *    consumers that cannot use hooks (Tiptap extensions, parsing helpers).
 *    Reactive consumers must use the seam hooks instead — a component that
 *    imports TOPICS from here will not see runtime-created topics (same
 *    behavior as today's direct mock imports).
 */

// Presentation constant for highlight types (uses design tokens).
export { HIGHLIGHT_META } from '@/data/topicData'

// People + avatar lookup. Phase 3 replaces name-keyed lookups with userIds.
export { PEOPLE, avatarFor } from '@/data/peopleData'

// Non-reactive topic snapshot (static seed topics only — see module docs).
export { TOPICS } from '@/data/topicData'
// Files / Figma integration mocks.
// Files / Figma / Linear integration mocks.
export {
  APP_CATEGORIES,
  APP_FILES,
  DOCUMENT_FILES,
} from '@/data/filesData'
export {
  FIGMA_FRAMES,
  frameById,
  frameBreadcrumb,
  searchFigmaFrames,
} from '@/data/figmaData'
