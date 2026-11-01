import { SkeletonBar, SkeletonList, SkeletonRow } from '@estiva-app/ui'

/**
 * The generic skeleton parts — bar, row, list — are the shared ones
 * (SHA-5, 2026-08-28); `SkeletonSidebarList` is Peek's name for the shared
 * list. What follows knows what a conversation card and a huddle card look
 * like, and stays here.
 */
export { SkeletonBar, SkeletonRow }
/**
 * Grey placeholder rows, each a small square and a bar, shown in a list while
 * its topics, people or folders are still loading.
 */
export const SkeletonSidebarList = SkeletonList
