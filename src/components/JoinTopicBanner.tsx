import { IconUserPlus } from '@tabler/icons-react'
import { ComposerBanner } from './ComposerBanner'

interface JoinTopicBannerProps {
  title: string
  onJoin?: () => void
}

/** Banner above the composer of a topic you're NOT a member of (QA #2.7):
 *  same strip as NewTopicBanner (`ComposerBanner`); invites you to join the
 *  topic. Content stays fully readable — membership gates participation, not
 *  visibility. */
export function JoinTopicBanner({ title, onJoin }: JoinTopicBannerProps) {
  return (
    <ComposerBanner icon={IconUserPlus} action={{ label: 'Join topic', onClick: onJoin }}>
      You&apos;re not a member of <span className="font-medium">{title}</span> yet — join to
      take part in the conversation
    </ComposerBanner>
  )
}
