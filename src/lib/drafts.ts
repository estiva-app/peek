/**
 * Drafts — CON-10. The store and the keys are `@estiva-app/conversation`'s
 * (CON-5), so Ship and Peek cannot disagree about where a draft belongs; what
 * stays here is the one browser touch, which the package takes as a parameter.
 */
import { createDraftStore, NO_DRAFTS, type DraftStore } from '@estiva-app/conversation'

export { createDraftStore, draftKeys, DRAFT_MAX_AGE_MS, DRAFT_MAX_CHARS, type DraftStore } from '@estiva-app/conversation'

/**
 * The store this app uses. Resolved defensively: reading `window.localStorage`
 * can itself throw where a browser blocks site data.
 */
export function browserDrafts(): DraftStore {
  try {
    return createDraftStore(typeof window === 'undefined' ? undefined : window.localStorage)
  } catch {
    return NO_DRAFTS
  }
}
