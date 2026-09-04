import { Menu, MenuItem } from '@estiva-app/ui'

/**
 * The one menu a topic has, wherever you open it from (PEE-2).
 *
 * There were two before, hand-rolled a few files apart, and they had already
 * drifted: the sidebar row offered "Delete topic" and the conversation header
 * did not, so a topic could be deleted from the list but not from inside
 * itself. Two menus for one object is how that happens, so this is the one
 * menu, and both places pass their handlers to it.
 *
 * On the shared shell now (2026-09-01): the container, the rows, and the two
 * exits — Escape and a click outside — come from @estiva-app/ui's Menu,
 * which this component's own extraction note always argued for. Portalled,
 * because the sidebar scrolls and clips its overflow.
 *
 * Deliberately short. Star and the Folder link are icons in the header
 * already, and repeating them here would make the menu longer without making
 * either easier to reach (Katerina, 2026-08-19).
 */
export interface TopicMoreMenuProps {
  /** Viewport coordinates of the anchor, right-aligned to the trigger. */
  position: { top: number; right: number }
  onClose: () => void
  onOpenDetails?: () => void
  /** Absent when the topic has no shareable URL — see `shareableTopicUrl`. */
  onCopyLink?: () => void
  /** The label states the direction that will work, so the menu never offers
   *  an action that is already true. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  onDeleteTopic?: () => void
}

export function TopicMoreMenu({
  position,
  onClose,
  onOpenDetails,
  onCopyLink,
  openWorkAction,
  onToggleOpenWork,
  onDeleteTopic,
}: TopicMoreMenuProps) {
  const run = (action: () => void) => () => {
    onClose()
    action()
  }

  return (
    <Menu position={position} onClose={onClose}>
      {onOpenDetails && <MenuItem label="Topic details" onClick={run(onOpenDetails)} />}
      {onCopyLink && <MenuItem label="Copy link" onClick={run(onCopyLink)} />}
      {openWorkAction && onToggleOpenWork && (
        <MenuItem
          label={openWorkAction === 'add' ? 'Add to Open work' : 'Remove from Open work'}
          onClick={run(onToggleOpenWork)}
        />
      )}
      {onDeleteTopic && <MenuItem label="Delete topic" destructive onClick={run(onDeleteTopic)} />}
    </Menu>
  )
}
