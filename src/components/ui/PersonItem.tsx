import { NavItem, type UnreadDotTone } from '@estiva-app/ui'
import { useAvatarSrc, useReactionsSeenOnClose, type RowNewsItem } from '@/api'
import { RowNewsCard } from '@/components/RowNewsCard'
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
  unreadTone,
  active,
  onHide,
  openWorkAction,
  onToggleOpenWork,
  news,
}: {
  id: string
  name: string
  avatarSrc?: string
  unread?: boolean
  urgent?: boolean
  /** The dot's colour (ACT-7): orange when reactions to you are all that is new. An urgent DM keeps its mark. */
  unreadTone?: UnreadDotTone
  active: boolean
  onHide?: () => void
  /** Whether the ⋮ adds this DM to Open work or takes it off; absent where adding cannot succeed. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  /** What lit the DM (ACT-3): a lit row opens their card while it is pointed at. */
  news?: readonly RowNewsItem[]
}) {
  const avatarSrcFor = useAvatarSrc()
  const href = `/app/people/${id}`
  const lines = (unread || urgent) && news?.length ? news : undefined
  // Leaving its card, or opening it on a touch screen, sees the reactions to you it listed (ACT-7).
  const reactionsSeen = useReactionsSeenOnClose(lines)
  return (
    <NavItem
      href={href}
      preview={lines ? <RowNewsCard items={lines} placeHref={href} place="dm" /> : undefined}
      onPreviewOpenChange={reactionsSeen.onPreviewOpenChange}
      onClick={reactionsSeen.onOpenRow}
      label={name}
      icon={<TopicState type="DM" avatarSrc={avatarSrc ?? avatarSrcFor(name)} />}
      active={active}
      unread={unread}
      urgent={urgent}
      unreadTone={unread ? unreadTone : undefined}
      menu={
        onHide || (openWorkAction && onToggleOpenWork) ? (
          <TopicMenuItems onHideDm={onHide} openWorkAction={openWorkAction} onToggleOpenWork={onToggleOpenWork} />
        ) : undefined
      }
    />
  )
}
