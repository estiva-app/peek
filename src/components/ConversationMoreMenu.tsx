import {
  IconCircleDashed,
  IconCircleCheck,
  IconPlus,
  IconArrowBack,
  IconHighlight,
  IconX,
  IconDotsVertical,
} from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Menu, MenuItem, MenuSection, MenuSub } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { Divider } from './ui/Divider'
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
  isTopic?: boolean
  isResolved?: boolean
  showCreateTopic?: boolean
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
  /** The ⋯ button; the menu owns it. A `ToolbarButton` when the menu sits
   *  in the hover toolbar, so the strip stays one Tab stop (D29). */
  trigger?: ReactElement
  className?: string
}

/**
 * The ⋯ menu on a message or a topic: highlight, resolve or reopen, make or
 * undo a topic, add to Open work, edit, see details and delete — only what the
 * card offers.
 */
export function ConversationMoreMenu({
  isTopic = false,
  isResolved = false,
  showCreateTopic = true,
  currentHighlight,
  onHighlight,
  open,
  onOpenChange,
  onCreateTopic,
  onRevertToConversation,
  onResolve,
  onReopen,
  onOpenWork,
  onEditMessage,
  onViewDetails,
  onDelete,
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
        {/*
          Offered on every message since CON-8, like Delete before it.

          The gate was right while Peek's edit only patched its own database:
          offering it on somebody else's message would have rewritten their
          words for Peek's readers and nobody else's. Now the edit publishes a
          kind:40003 and the relay adjudicates — it accepts one from the
          target's effective author or the NIP-OA owner of an authoring agent,
          and no client can evaluate the second half.
        */}
        {!isTopic && <MenuItem label="Edit message" onClick={onEditMessage} />}
        <MenuItem label="View details" onClick={onViewDetails} />
      </div>

      {/*
        Offered on every message — CON-3, and the relay adjudicates.

        This was `isOwnMessage &&`, written to SPEC §6.5's rule that a relay
        "honours a deletion only from the pubkey that signed the original". That
        rule was withdrawn on 2026-09-06; the reference relay accepts the author
        or the author's NIP-OA owner, and a client cannot tell which it is
        looking at.

        Safe to remove only because `messages.remove` no longer deletes ahead of
        the relay (PEE-18): with no local claim the rows stay put, the kind:5 is
        published, and the row goes when the relay accepts it. Removing this
        gate against the old mutation would have handed everybody the ability to
        drop anybody's message from Peek while the relay kept it.
      */}
      <Divider className="mx-0" />
      <MenuItem label="Delete" destructive onClick={onDelete} />
    </Menu>
  )
}
