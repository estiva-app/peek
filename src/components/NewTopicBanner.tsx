import { IconPencilMinus } from '@tabler/icons-react'
import { ComposerBanner } from './ComposerBanner'

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
 *  `ComposerBanner`. */
export function NewTopicBanner({ title, kind = 'topic', onInviteMembers }: NewTopicBannerProps) {
  return (
    <ComposerBanner
      icon={IconPencilMinus}
      action={kind === 'topic' ? { label: 'Invite members', onClick: onInviteMembers } : undefined}
    >
      {kind === 'dm' ? 'This is the beginning of your conversation with' : 'This is the beginning of your conversations in'}{' '}
      <span className="font-medium">{title}</span>
    </ComposerBanner>
  )
}
