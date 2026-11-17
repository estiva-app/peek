import { useNavigate } from 'react-router-dom'
import { ConversationHeading, KindIcon, thingKindOf } from '@estiva-app/ui'
import type { TopicFile } from '@/api'
import { openInAppUrl } from '@/lib/appName'
import { referenceLink } from '@/lib/referenceLink'

/**
 * A listed file's heading over its threads, in a topic followed at All (TOPI-3): the kit's `ConversationHeading`, its
 * kind's icon and its name. Pressing the name opens the file where its Overview card opens it: another app's file in
 * that app, in a new tab (`referenceLink`'s `app`), a file Peek opens itself in Peek. Pressing anywhere else on the
 * card opens the thread, as on every card.
 */
export function ListedFileHeading({ file }: { file: TopicFile }) {
  const navigate = useNavigate()
  const object = file.object
  const link = object ? referenceLink(object.naddr ?? file.address, object) : null
  const elsewhere = link?.place === 'app' && object ? openInAppUrl(object) : undefined
  const href = link && link.place !== 'app' ? link.href : elsewhere
  const onOpen = !href ? undefined : elsewhere ? () => void window.open(elsewhere, '_blank', 'noopener,noreferrer') : () => navigate(href)
  return (
    <ConversationHeading
      icon={<KindIcon kind={thingKindOf(object?.kind ?? Number(file.address.split(':')[0]))} />}
      name={object?.slots.title?.value || 'File'}
      href={href}
      onOpen={onOpen}
    />
  )
}
