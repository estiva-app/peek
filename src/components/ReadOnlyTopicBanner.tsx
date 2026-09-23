import { Banner } from '@estiva-app/ui'
import { IconFolder, IconLock } from '@tabler/icons-react'

interface ReadOnlyTopicBannerProps {
  /** A Convex topic (the default), or a huddle thread inside one. */
  what?: 'topic' | 'huddle'
  /** Opens the topic's Folder panel, where its file and conversation are. */
  onOpenFolder?: () => void
}

/** Drawn where a Convex topic's composer was (CON-8): the package's Banner,
 *  `info`, as JoinTopicBanner is. The conversation moved to the topic's file,
 *  so this page only reads — the action opens the Folder to carry on there.
 *  A huddle says it is paused instead: huddles are disabled until rebuilt. */
export function ReadOnlyTopicBanner({ what = 'topic', onOpenFolder }: ReadOnlyTopicBannerProps) {
  if (what === 'huddle') {
    return (
      <Banner tone="info" icon={<IconLock size={16} stroke={1.5} />}>
        Huddles are paused — this one stays readable until they return
      </Banner>
    )
  }
  return (
    <Banner
      tone="info"
      icon={<IconFolder size={16} stroke={1.5} />}
      action={onOpenFolder ? { label: 'Open Folder', onClick: onOpenFolder } : undefined}
    >
      This topic is read-only — its conversation continues on its file in the Folder
    </Banner>
  )
}
