import { Banner } from '@estiva-app/ui'
import { IconUserPlus } from '@tabler/icons-react'

interface JoinTopicBannerProps {
  title: string
  onJoin?: () => void
}

/** Banner above the composer of a topic you're NOT a member of (QA #2.7):
 *  the package's Banner, `info`, as NewTopicBanner is; invites you to join the
 *  topic. Content stays fully readable — membership gates participation, not
 *  visibility. */
export function JoinTopicBanner({ title, onJoin }: JoinTopicBannerProps) {
  return (
    <Banner tone="info" icon={<IconUserPlus size={16} stroke={1.5} />} action={{ label: 'Join topic', onClick: onJoin }}>
      You&apos;re not a member of <span className="font-medium">{title}</span> yet — join to
      take part in the conversation
    </Banner>
  )
}
