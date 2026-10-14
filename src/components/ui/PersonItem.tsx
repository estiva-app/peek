import { NavItem } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'
import { TopicState } from './TopicState'
import { TopicMenuItems } from './TopicMoreMenu'

/**
 * One person on the package's sidebar row: their photo, their name, the dot,
 * and Hide on the ⋮ where hiding can succeed (DMS-6). The link is their page;
 * `onSelect` goes there.
 */
export function PersonItem({
  id,
  name,
  avatarSrc,
  unread,
  urgent,
  active,
  onSelect,
  onHide,
}: {
  id: string
  name: string
  avatarSrc?: string
  unread?: boolean
  urgent?: boolean
  active: boolean
  onSelect?: (id: string) => void
  onHide?: () => void
}) {
  const avatarSrcFor = useAvatarSrc()
  return (
    <NavItem
      href={`/app/people/${id}`}
      label={name}
      icon={<TopicState type="DM" avatarSrc={avatarSrc ?? avatarSrcFor(name)} />}
      active={active}
      unread={unread}
      urgent={urgent}
      onClick={
        onSelect
          ? (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              onSelect(id)
            }
          : undefined
      }
      menu={onHide ? <TopicMenuItems onHideDm={onHide} /> : undefined}
      menuLabel="More options"
    />
  )
}
