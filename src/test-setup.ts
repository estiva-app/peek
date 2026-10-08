import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { clearListingCaches } from '@/platform/listingCache'
import { resetConversationsForTests } from '@/api/conversations'

// The listing caches are module state (SID-2); one case's answers must not be the next one's.
beforeEach(() => {
  clearListingCaches()
  // So are the held conversations (OPT-3).
  resetConversationsForTests()
  // What a tab holds for its visit only — the column's view a Folder link chose.
  if (typeof window !== 'undefined') window.sessionStorage.clear()
})
