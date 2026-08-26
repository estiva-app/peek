import { SkeletonBar, SkeletonList, SkeletonRow } from '@estiva/ui'
import { cn } from '@/lib/utils'

/**
 * The generic skeleton parts — bar, row, list — are the shared ones
 * (SHA-5, 2026-08-28); `SkeletonSidebarList` is Peek's name for the shared
 * list. What follows knows what a conversation card and a huddle card look
 * like, and stays here.
 */
export { SkeletonBar, SkeletonRow }
export const SkeletonSidebarList = SkeletonList

export function SkeletonConversationCard({ secondLineWidth = 380 }: { secondLineWidth?: number }) {
  return (
    <div className="rounded-lg pt-2 px-2">
      <div className="flex items-center gap-2 w-full">
        <SkeletonBar className="w-6 h-6 shrink-0" />
        <SkeletonBar className="h-3.5 w-[110px]" />
        <SkeletonBar className="h-3 w-10" />
      </div>
      <div className="pl-8 pr-2 pt-2 pb-2 flex flex-col gap-2">
        <SkeletonBar className="h-3.5 w-full" />
        <SkeletonBar className="h-3.5" style={{ width: secondLineWidth }} />
      </div>
    </div>
  )
}

/** Conversation-area placeholder: a few cards, revealed after the delay. */
export function SkeletonConversationList({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 animate-skeleton-in', className)} aria-hidden>
      <SkeletonConversationCard secondLineWidth={420} />
      <SkeletonConversationCard secondLineWidth={300} />
      <SkeletonConversationCard secondLineWidth={500} />
    </div>
  )
}

/** Huddle-card placeholder — mirrors HuddleCard grid (h-130, p-2, member avatars, 2 caption lines). */
export function SkeletonHuddleCard() {
  return (
    <div className="flex flex-col h-[130px] rounded-lg border border-border-subtle bg-bg-surface p-2">
      <div className="flex items-center gap-2 w-full">
        <div className="flex">
          <SkeletonBar className="w-6 h-6 shrink-0" />
          <SkeletonBar className="w-6 h-6 shrink-0 -ml-2" />
        </div>
        <SkeletonBar className="h-3.5 flex-1" />
        <SkeletonBar className="h-3 w-8" />
      </div>
      <div className="pt-2 flex flex-col gap-1.5">
        <SkeletonBar className="h-3 w-full" />
        <SkeletonBar className="h-3 w-[70%]" />
      </div>
    </div>
  )
}

/** Huddles-tab grid placeholder (2×2), revealed after the delay. */
export function SkeletonHuddleGrid({ className }: { className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 animate-skeleton-in', className)} aria-hidden>
      <SkeletonHuddleCard />
      <SkeletonHuddleCard />
      <SkeletonHuddleCard />
      <SkeletonHuddleCard />
    </div>
  )
}
