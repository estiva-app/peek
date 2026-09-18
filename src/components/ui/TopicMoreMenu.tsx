import type { ReactElement } from 'react'
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
 * The menu owns its trigger (`@estiva-app/ui` 0.10.0), so this component no
 * longer takes viewport coordinates and an `onClose`: it takes the control
 * that opens it. Both callers used to measure a rect and keep the menu's open
 * state themselves; neither does now. Portalled and right-aligned as before —
 * the sidebar scrolls and clips its overflow, and a content-sized menu grows
 * leftward so long labels never run off screen.
 *
 * Deliberately short. Star and the Folder link are icons in the header
 * already, and repeating them here would make the menu longer without making
 * either easier to reach (Katerina, 2026-08-19).
 * @registry reusable: stays in Peek (Katerina, 18 September): Peek's topic actions on estiva-ui's Menu
 */
export interface TopicMoreMenuProps {
  /** The control that opens the menu. The menu owns it. */
  trigger: ReactElement
  /**
   * Told when the menu opens and closes — for a caller whose own look depends
   * on it. The sidebar row keeps its hover surface and its actions visible
   * while its menu is open, which is the whole reason this exists.
   */
  onOpenChange?: (open: boolean) => void
  onOpenDetails?: () => void
  /** Absent when the topic has no shareable URL — see `shareableTopicUrl`. */
  onCopyLink?: () => void
  /** The label states the direction that will work, so the menu never offers
   *  an action that is already true. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  onDeleteTopic?: () => void
  /**
   * Hide a DM from this viewer's sidebar (DMS-6). The label says "hide", not
   * "close" or "delete", because that is all it does: the conversation, its
   * history and the other person's view of it all survive, and opening it
   * again brings it back. Offered only when the hide can succeed.
   */
  onHideDm?: () => void
}

export function TopicMoreMenu({
  trigger,
  onOpenChange,
  onOpenDetails,
  onCopyLink,
  openWorkAction,
  onToggleOpenWork,
  onDeleteTopic,
  onHideDm,
}: TopicMoreMenuProps) {
  return (
    /* No `run(action)` wrapper any more: a `MenuItem` closes the menu itself,
       so an action no longer has to close it first. */
    <Menu trigger={trigger} align="right" onOpenChange={onOpenChange}>
      {onOpenDetails && <MenuItem label="Topic details" onClick={onOpenDetails} />}
      {onCopyLink && <MenuItem label="Copy link" onClick={onCopyLink} />}
      {openWorkAction && onToggleOpenWork && (
        <MenuItem
          label={openWorkAction === 'add' ? 'Add to Open work' : 'Remove from Open work'}
          onClick={onToggleOpenWork}
        />
      )}
      {onHideDm && <MenuItem label="Hide conversation" onClick={onHideDm} />}
      {onDeleteTopic && <MenuItem label="Delete topic" destructive onClick={onDeleteTopic} />}
    </Menu>
  )
}
