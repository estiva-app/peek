import { Banner } from '@estiva-app/ui'
import { IconPencilMinus } from '@tabler/icons-react'

interface NewTopicBannerProps {
  /** Who the direct message is with. */
  name: string
}

/** Empty-state banner above the composer of a direct message with no messages yet:
 *  "…your conversation with <Name>". The strip is the package's Banner, `info`
 *  (Katerina, 18 September). Its topic version, with Invite members, had no
 *  caller and went (audit D8, 2 November).
 *  @registry reusable: stays in Peek (Katerina, 18 September): Peek's words for a new direct message */
export function NewTopicBanner({ name }: NewTopicBannerProps) {
  return (
    <Banner tone="info" icon={<IconPencilMinus size={16} stroke={1.5} />}>
      This is the beginning of your conversation with <span className="text-body-2-strong">{name}</span>
    </Banner>
  )
}
