import { Banner } from '@estiva-app/ui'
import { IconPencilMinus } from '@tabler/icons-react'

interface NewTopicBannerProps {
  /** Topic title (kind="topic") or DM partner name (kind="dm"). */
  title: string
  /** "topic" shows the Invite members button; "dm" is copy-only. */
  kind?: 'topic' | 'dm'
  onInviteMembers?: () => void
}

/** Empty-state banner above the composer of a conversation with no messages yet:
 *  topics get "…your conversations in <Topic>" + Invite members; DMs get
 *  "…your conversation with <Name>" without the invite action. The strip is
 *  the package's Banner, `info` (Katerina, 18 September).
 *  @registry reusable: stays in Peek (Katerina, 18 September): Peek's words for a new topic or direct message */
export function NewTopicBanner({ title, kind = 'topic', onInviteMembers }: NewTopicBannerProps) {
  return (
    <Banner
      tone="info"
      icon={<IconPencilMinus size={16} stroke={1.5} />}
      action={kind === 'topic' ? { label: 'Invite members', onClick: onInviteMembers } : undefined}
    >
      {kind === 'dm' ? 'This is the beginning of your conversation with' : 'This is the beginning of your conversations in'}{' '}
      <span className="font-medium">{title}</span>
    </Banner>
  )
}
