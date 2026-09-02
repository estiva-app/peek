import {
  IconCircleDashed,
  IconCircleCheck,
  IconPlus,
  IconArrowBack,
  IconHighlight,
  IconX,
} from '@tabler/icons-react'
import { MenuItem, MenuSection, MenuSub } from '@estiva-app/ui'
import { Divider } from './ui/Divider'
import { HighlightSwatch } from './ui/HighlightPill'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, type HighlightType } from '@/api'

/**
 * The conversation's ⋯ menu. Its rows are the shared MenuItem now
 * (2026-09-01), and the highlight submenu is the shared MenuSub
 * (2026-09-03) — "the day the shell learns it" arrived when this menu's
 * hand-rolled copy was duplicated into the reply menu and the copy dropped
 * the ref its edge-flip measured, shipping a submenu cut off by the screen.
 * The shell's version portals and measures real rects, so it cannot be.
 *
 * The container is deliberately not the shared Menu shell: this panel is
 * placed and dismissed by its caller (the quick-menu opens it against a
 * measured rect and owns when it goes).
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
          <MenuSub
            leading={<IconHighlight size={16} stroke={1.5} className="text-text-secondary" />}
            label={currentHighlight ? 'Change highlight' : 'Mark as Highlight'}
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
          </MenuSub>
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
