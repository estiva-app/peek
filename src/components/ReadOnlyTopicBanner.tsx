import { Banner } from '@estiva-app/ui'
import { IconFolder } from '@tabler/icons-react'

interface ReadOnlyTopicBannerProps {
  /** Opens the topic's Folder panel, where its file and conversation are. */
  onOpenFolder?: () => void
}

/** Drawn where a Convex topic's composer was (CON-8): the package's Banner,
 *  `info`, as JoinTopicBanner is. The conversation moved to the topic's file,
 *  so this page only reads — the action opens the Folder to carry on there. */
export function ReadOnlyTopicBanner({ onOpenFolder }: ReadOnlyTopicBannerProps) {
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
