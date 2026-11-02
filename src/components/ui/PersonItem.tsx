import { NavItem } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'
import { TopicState } from './TopicState'
import { TopicMenuItems } from './TopicMoreMenu'

/**
 * One person on the package's sidebar row: their photo, their name, the dot,
 * and on the ⋮ Open work (Katerina, 30 October) and Hide where hiding can
 * succeed (DMS-6). The link is their page: a plain click goes there through
 * Peek's router, the kit's `AppProvider`, and Cmd-click opens a new tab.
 */
export function PersonItem({
  id,
  name,
  avatarSrc,
  unread,
  urgent,
  active,
  onHide,
  openWorkAction,
  onToggleOpenWork,
}: {
  id: string
  name: string
  avatarSrc?: string
  unread?: boolean
  urgent?: boolean
  active: boolean
  onHide?: () => void
  /** Whether the ⋮ adds this DM to Open work or takes it off; absent where adding cannot succeed. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
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
      menu={
        onHide || (openWorkAction && onToggleOpenWork) ? (
          <TopicMenuItems onHideDm={onHide} openWorkAction={openWorkAction} onToggleOpenWork={onToggleOpenWork} />
        ) : undefined
      }
    />
  )
}
