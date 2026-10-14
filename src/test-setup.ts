import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { beforeEach } from 'vitest'
import { clearListingCaches } from '@/platform/listingCache'
import { resetConversationsForTests } from '@/api/conversations'

// `findBy…` and `waitFor` give up after 1 s by default, which a starved worker
// on a busy box misses with nothing wrong (2164b3d5). A real miss still fails.
configure({ asyncUtilTimeout: 5_000 })

// The listing caches are module state (SID-2); one case's answers must not be the next one's.
beforeEach(() => {
  clearListingCaches()
  // So are the held conversations (OPT-3).
  resetConversationsForTests()
  // What a tab holds for its visit only — the column's view a Folder link chose.
  if (typeof window !== 'undefined') window.sessionStorage.clear()
})
