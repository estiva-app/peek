import {
  IconCircleDashed,
  IconChevronDown,
  IconSortDescending,
  IconEdit,
} from '@tabler/icons-react'
import { IconButton } from './ui/IconButton'
import { cn } from '@/lib/utils'
import { type ReactNode } from 'react'

interface ContainerHeaderProps {
  /**
   * A string, or anything a pane needs to head itself with — the Folders
   * pane puts an `EditableText` here, because its name is edited where it is
   * shown. A node is rendered as given; a string keeps the single-line
   * treatment, so no existing caller moves a pixel.
   */
  title: ReactNode
  chevron?: boolean
  leadingIcon?: boolean
  /** Custom slot rendered between title area and action buttons */
  more?: ReactNode
  /** 1st action button - defaults to Edit icon */
  prop1stAction?: boolean
  prop1stActionTooltip?: string
  onProp1stAction?: () => void
  /** 2nd action button - defaults to Sort Descending icon */
  prop2ndAction?: boolean
  prop2ndActionTooltip?: string
  onProp2ndAction?: () => void
  /** 3rd action button - defaults to Sort Descending icon (hidden by default, for future use) */
  prop3rdAction?: boolean
  prop3rdActionTooltip?: string
  onProp3rdAction?: () => void
  /**
   * Buttons at the right edge, for a pane whose action is its own rather than
   * one of the three presets — a Delete, a Close. Drawn after `more`.
   */
  actions?: ReactNode
  className?: string
}

/**
 * The bar across the top of a column: its title, with an optional icon and
 * chevron, and up to three buttons on the right.
 */
export function ContainerHeader({
  title,
  chevron = false,
  leadingIcon = false,
  more,
  prop1stAction = false,
  prop1stActionTooltip,
  onProp1stAction,
  prop2ndAction = false,
  prop2ndActionTooltip,
  onProp2ndAction,
  prop3rdAction = false,
  prop3rdActionTooltip,
  onProp3rdAction,
  actions,
  className,
}: ContainerHeaderProps) {
  const hasRightContent = more || actions || prop1stAction || prop2ndAction || prop3rdAction

  return (
    <div
      className={cn(
        'h-12 shrink-0 flex items-center justify-between overflow-hidden',
        'pl-5 pr-4 py-2 border-b border-border-subtle',
        className
      )}
    >
      {/* Left - leading icon + title + optional chevron */}
      <div className={cn('flex gap-2 items-center overflow-hidden', typeof title === 'string' ? 'shrink-0' : 'min-w-0 flex-1')}>
        {leadingIcon && (
          <IconCircleDashed size={16} stroke={1.5} className="text-text-muted shrink-0" />
        )}
        <div className={cn('flex gap-1 items-center', typeof title === 'string' ? 'shrink-0' : 'min-w-0 flex-1')}>
          {typeof title === 'string' ? (
            <span className="text-body-2-strong text-text-primary whitespace-nowrap">
              {title}
            </span>
          ) : (
            <div className="min-w-0 flex-1">{title}</div>
          )}
          {chevron && (
            <IconChevronDown size={12} stroke={1.5} className="text-text-secondary shrink-0" />
          )}
        </div>
      </div>

      {/* Right - more slot + action buttons */}
      {hasRightContent && (
        <div className="flex gap-3 items-center justify-end shrink-0">
          {more && <div className="shrink-0">{more}</div>}
          {actions && <div className="flex gap-1 items-center shrink-0">{actions}</div>}
          {(prop1stAction || prop2ndAction || prop3rdAction) && (
            <div className="flex gap-1 items-center justify-end">
              {prop3rdAction && (
                <IconButton tooltip={prop3rdActionTooltip} aria-label={prop3rdActionTooltip ?? 'Sort'} onClick={onProp3rdAction}>
                  <IconSortDescending size={16} stroke={1.5} />
                </IconButton>
              )}
              {prop2ndAction && (
                <IconButton tooltip={prop2ndActionTooltip} aria-label={prop2ndActionTooltip ?? 'Sort'} onClick={onProp2ndAction}>
                  <IconSortDescending size={16} stroke={1.5} />
                </IconButton>
              )}
              {prop1stAction && (
                <IconButton tooltip={prop1stActionTooltip} aria-label={prop1stActionTooltip ?? 'Edit'} onClick={onProp1stAction}>
                  <IconEdit size={16} stroke={1.5} />
                </IconButton>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
