import {
  IconCircleDashed,
  IconCircleCheck,
  IconPlus,
  IconHighlight,
  IconX,
  IconDotsVertical,
} from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Menu, MenuItem, MenuSection, MenuSeparator, MenuSub } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { HighlightSwatch } from './ui/HighlightPill'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, type HighlightType } from '@/api'

/**
 * The conversation's ⋯ menu. Its rows are the shared MenuItem now
 * (2026-09-01), the highlight submenu is the shared MenuSub, and the
 * container is the shared Menu shell (both 2026-09-03) — hand it the
 * quick-menu's measured rect as `anchor` and the shell portals, fits the
 * viewport, and owns every exit (outside click and Escape).
 *
 * **It owns its ⋯ button** (`@estiva-app/ui` 0.10.0: a menu owns its
 * trigger). It used to be handed the quick menu's measured rect as `anchor`,
 * which meant the quick menu kept a ref, measured a button and called back,
 * and the card kept the open state — all of it to tell the menu where a
 * button it could have held was. The quick menu takes this whole component in
 * its `more` slot now.
 *
 * `closeOnLeave` went with the same release. This menu has a `MenuSub`, and
 * a hover-opened menu with a submenu strands itself open (D28), so it opens
 * on a press — which is what it already did.
 */
interface ConversationMoreMenuProps {
  /** Controlled, for a story that wants the panel standing open. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isResolved?: boolean
  currentHighlight?: HighlightType
  onHighlight?: (type: HighlightType | undefined) => void
  onResolve?: () => void
  onReopen?: () => void
  onOpenWork?: () => void
  onEditMessage?: () => void
  onViewDetails?: () => void
  onDelete?: () => void
  /** The viewer wrote this message. Edit and Delete show only then — PEE-32. */
  isOwnMessage?: boolean
  /** The ⋯ button; the menu owns it. A `ToolbarButton` when the menu sits
   *  in the hover toolbar, so the strip stays one Tab stop (D29). */
  trigger?: ReactElement
  className?: string
}

/**
 * The ⋯ menu on a message: highlight, resolve or reopen, add to Open work,
 * edit, see details and delete — only what the card offers.
 */
export function ConversationMoreMenu({
  isResolved = false,
  currentHighlight,
  onHighlight,
  open,
  onOpenChange,
  onResolve,
  onReopen,
  onOpenWork,
  onEditMessage,
  onViewDetails,
  onDelete,
  isOwnMessage = false,
  trigger,
  className,
}: ConversationMoreMenuProps) {
  return (
    <Menu
      trigger={
        trigger ?? (
          <IconButton tooltip="More actions" aria-label="More actions">
            <IconDotsVertical size={16} stroke={1.5} />
          </IconButton>
        )
      }
      align="right"
      open={open}
      onOpenChange={onOpenChange}
      className={cn('w-[244px] gap-2', className)}
    >
      <MenuSection label="Utilities">
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
            shortcut="->"
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
                <MenuSeparator />
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

      <MenuSeparator />

      <div className="flex flex-col">
        {/*
          Edit and Delete only on the viewer's own message — PEE-32, reversing
          CON-8 and CON-3.

          Those two offered both to everyone because the relay accepts an edit
          or a deletion from the author OR the NIP-OA owner of an authoring
          agent, and a client cannot evaluate the second half. The relay still
          refuses a non-author, so what everyone saw was a control that could
          not succeed on anybody else's message — and "I should not be able to
          edit someone else's message" is the objection. Ruled 2026-09-21: hide
          both; an agent's owner loses the control in Peek, not the right.
        */}
        {isOwnMessage && <MenuItem label="Edit message" onClick={onEditMessage} />}
        <MenuItem label="View details" onClick={onViewDetails} />
      </div>

      {isOwnMessage && (
        <>
          <MenuSeparator />
          <MenuItem label="Delete" destructive onClick={onDelete} />
        </>
      )}
    </Menu>
  )
}
