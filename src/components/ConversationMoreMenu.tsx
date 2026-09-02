import { useState, useRef, useCallback, useEffect } from 'react'
import {
  IconCircleDashed,
  IconCircleCheck,
  IconPlus,
  IconArrowBack,
  IconHighlight,
  IconX,
} from '@tabler/icons-react'
import { MenuItem, MenuSection } from '@estiva-app/ui'
import { Divider } from './ui/Divider'
import { HighlightSwatch } from './ui/HighlightPill'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, type HighlightType } from '@/api'

/**
 * The conversation's ⋯ menu. Its rows are the shared MenuItem now
 * (2026-09-01) — including the highlight trigger, which needs the hover
 * handlers MenuItem passes through, and the swatch rows in the submenu.
 *
 * The container is deliberately not the shared Menu shell: this panel is
 * placed and dismissed by its caller (the quick-menu opens it against a
 * measured rect and owns when it goes), and the hover-timed submenu with its
 * left-flip is this menu's own. If a second menu ever needs a submenu, that
 * is the day the shell learns it.
 */
interface ConversationMoreMenuProps {
  isTopic?: boolean
  isResolved?: boolean
  showCreateTopic?: boolean
  /** True when the message was authored by the current user. Gates Edit/Delete. */
  isOwnMessage?: boolean
  currentHighlight?: HighlightType
  onHighlight?: (type: HighlightType | undefined) => void
  onCreateTopic?: () => void
  onRevertToConversation?: () => void
  onResolve?: () => void
  onReopen?: () => void
  onOpenWork?: () => void
  onEditMessage?: () => void
  onViewDetails?: () => void
  onDelete?: () => void
  className?: string
}

export function ConversationMoreMenu({
  isTopic = false,
  isResolved = false,
  showCreateTopic = true,
  isOwnMessage = false,
  currentHighlight,
  onHighlight,
  onCreateTopic,
  onRevertToConversation,
  onResolve,
  onReopen,
  onOpenWork,
  onEditMessage,
  onViewDetails,
  onDelete,
  className,
}: ConversationMoreMenuProps) {
  const [showHighlightSub, setShowHighlightSub] = useState(false)
  const [subOnLeft, setSubOnLeft] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  const openSub = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setShowHighlightSub(true)
  }, [])

  const closeSub = useCallback(() => {
    closeTimer.current = setTimeout(() => setShowHighlightSub(false), 150)
  }, [])

  // Measure whether the submenu fits to the right; if not, flip to left
  useEffect(() => {
    if (!showHighlightSub || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const subWidth = 160 + 8 // w-[160px] + ml-1 gap
    setSubOnLeft(rect.right + subWidth > window.innerWidth)
  }, [showHighlightSub])

  return (
    <div
      data-interactive
      className={cn(
        'bg-bg-elevated border border-border-default rounded-lg shadow-lg w-[244px] p-2 flex flex-col gap-2',
        className
      )}
    >
      <MenuSection label="Utilities">
        {isTopic ? (
          <MenuItem
            leading={<IconArrowBack size={16} stroke={1.5} className="text-text-secondary" />}
            label="Revert to conversation"
            onClick={onRevertToConversation}
          />
        ) : showCreateTopic ? (
          <MenuItem
            leading={<IconCircleDashed size={16} stroke={1.5} className="text-text-secondary" />}
            label="Start topic"
            onClick={onCreateTopic}
          />
        ) : null}

        {isResolved ? (
          <MenuItem
            leading={<IconCircleDashed size={16} stroke={1.5} className="text-text-secondary" />}
            label="Reopen"
            onClick={onReopen}
          />
        ) : (
          <MenuItem
            leading={<IconCircleCheck size={16} stroke={1.5} className="text-text-secondary" />}
            label="Resolve"
            shortcut="→"
            onClick={onResolve}
          />
        )}

        <MenuItem
          leading={<IconPlus size={16} stroke={1.5} className="text-text-secondary" />}
          label="Open work"
          onClick={onOpenWork}
        />

        {onHighlight && (
          <div className="relative" ref={triggerRef}>
            <MenuItem
              leading={<IconHighlight size={16} stroke={1.5} className="text-text-secondary" />}
              label={currentHighlight ? 'Change highlight' : 'Mark as Highlight'}
              submenu
              onMouseEnter={openSub}
              onMouseLeave={closeSub}
            />
            {showHighlightSub && (
              <div
                className={cn(
                  'absolute top-0 bg-bg-elevated border border-border-default rounded-lg shadow-lg w-[160px] p-2 z-50',
                  subOnLeft ? 'right-full mr-1' : 'left-full ml-1'
                )}
                onMouseEnter={openSub}
                onMouseLeave={closeSub}
              >
                {(['insight', 'concern', 'conclusion', 'question', 'summary'] as HighlightType[]).map((type) => (
                  <MenuItem
                    key={type}
                    leading={<HighlightSwatch type={type} />}
                    label={HIGHLIGHT_META[type].label}
                    selected={currentHighlight === type}
                    onClick={() => onHighlight(type)}
                  />
                ))}
                {currentHighlight && (
                  <>
                    <Divider className="mx-1 my-1" />
                    <MenuItem
                      leading={<IconX size={16} stroke={1.5} className="text-text-secondary" />}
                      label="Remove"
                      onClick={() => onHighlight(undefined)}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </MenuSection>

      <Divider className="mx-0" />

      <div className="flex flex-col">
        {!isTopic && isOwnMessage && (
          <MenuItem label="Edit message" onClick={onEditMessage} />
        )}
        <MenuItem label="View details" onClick={onViewDetails} />
      </div>

      {isOwnMessage && (
        <>
          <Divider className="mx-0" />
          <MenuItem label="Delete" destructive onClick={onDelete} />
        </>
      )}
    </div>
  )
}
