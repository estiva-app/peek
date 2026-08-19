import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * The one menu a topic has, wherever you open it from (PEE-2).
 *
 * There were two before, hand-rolled a few files apart, and they had already
 * drifted: the sidebar row offered "Delete topic" and the conversation header
 * did not, so a topic could be deleted from the list but not from inside
 * itself. Two menus for one object is how that happens, so this is the one
 * menu, and both places pass their handlers to it.
 *
 * Deliberately short. Star and the Folder link are icons in the header already,
 * and repeating them here would make the menu longer without making either
 * easier to reach (Katerina, 2026-08-19).
 *
 * Portalled: the sidebar scrolls and clips its overflow, so a menu rendered in
 * the row would be cut off by the container it belongs to.
 */
export interface TopicMoreMenuProps {
  /** Viewport coordinates of the anchor, right-aligned to the trigger. */
  position: { top: number; right: number }
  onClose: () => void
  onOpenDetails?: () => void
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
  openWorkAction,
  onToggleOpenWork,
  onDeleteTopic,
}: TopicMoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  /**
   * Outside click and Escape — the two exits every menu in Peek has.
   *
   * Owned here rather than by each caller, which is the other half of "one
   * menu": the dismissal rules used to be copied alongside the markup, so they
   * could drift too.
   */
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const run = (action: () => void) => () => {
    onClose()
    action()
  }

  return createPortal(
    <div
      ref={menuRef}
      data-interactive
      role="menu"
      className="fixed z-50 flex min-w-[180px] flex-col rounded-lg border border-border-default bg-bg-elevated p-2 shadow-lg"
      style={{ top: position.top, right: position.right }}
      onClick={(e) => e.stopPropagation()}
    >
      {onOpenDetails && <Item label="Topic details" onClick={run(onOpenDetails)} />}
      {openWorkAction && onToggleOpenWork && (
        <Item
          label={openWorkAction === 'add' ? 'Add to Open work' : 'Remove from Open work'}
          onClick={run(onToggleOpenWork)}
        />
      )}
      {onDeleteTopic && <Item label="Delete topic" destructive onClick={run(onDeleteTopic)} />}
    </div>,
    document.body,
  )
}

function Item({
  label,
  destructive,
  onClick,
}: {
  label: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-hover"
      onClick={onClick}
    >
      <span
        className={cn(
          'flex-1 whitespace-nowrap text-sm',
          destructive ? 'text-error-default' : 'text-text-secondary signal:text-text-primary',
        )}
      >
        {label}
      </span>
    </button>
  )
}
