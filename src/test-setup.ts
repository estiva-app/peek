import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { clearListingCaches } from '@/platform/listingCache'

// The listing caches are module state (SID-2); one case's answers must not be the next one's.
beforeEach(() => clearListingCaches())
