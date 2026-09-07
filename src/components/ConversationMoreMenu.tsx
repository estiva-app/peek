import {
  IconCircleDashed,
  IconCircleCheck,
  IconPlus,
  IconArrowBack,
  IconHighlight,
  IconX,
} from '@tabler/icons-react'
import { Menu, MenuItem, MenuSection, MenuSub } from '@estiva-app/ui'
import { Divider } from './ui/Divider'
import { HighlightSwatch } from './ui/HighlightPill'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, type HighlightType } from '@/api'

/**
 * The conversation's ⋯ menu. Its rows are the shared MenuItem now
 * (2026-09-01), the highlight submenu is the shared MenuSub, and the
 * container is the shared Menu shell (both 2026-09-03) — hand it the
 * quick-menu's measured rect as `anchor` and the shell portals, fits the
 * viewport, and owns every exit (outside click, Escape, pointer leaving —
 * the leave grace shared with the submenu, so crossing into it never
 * closes the menu). The old caller-side portal with its own `< 200px`
 * flip heuristic and outside-click listener is gone.
 *
 * Without an anchor (the stories) it stands in flow, pinned open.
 */
interface ConversationMoreMenuProps {
  /** The quick-menu ⋯ rect. Absent: in-flow, for the stories. */
  anchor?: DOMRect | HTMLElement | null
  onClose?: () => void
  isTopic?: boolean
  isResolved?: boolean
  showCreateTopic?: boolean
  /**
   * True when the message was authored by the current user.
   *
   * Gates **Edit** only, since CON-3. Delete is offered to everyone: the relay
   * accepts a kind:5 from the target's author *or* from the NIP-OA owner of an
   * authoring agent, and no client can evaluate the second half — ownership is
   * written from the attestation and read server-side only. So this check is
   * narrower than the relay's and hides the control from the one *other* party
   * it would accept. On this workspace that is where the conversation is: 425 of
   * 583 messages were written by a single agent identity.
   *
   * Edit keeps the gate for now, and deliberately: Peek's edit still only
   * patches its own database (CON-8), so offering it on somebody else's message
   * would silently rewrite their words for Peek's readers and nobody else's.
   * It comes off when the edit publishes a kind:40003.
   */
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
  anchor,
  onClose,
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
    <Menu
      anchor={anchor ?? undefined}
      align="right"
      closeOnLeave={!!anchor}
      onClose={onClose ?? (() => {})}
      className={cn('w-[244px] gap-2', !anchor && 'static', className)}
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
        {!isTopic && isOwnMessage && (
          <MenuItem label="Edit message" onClick={onEditMessage} />
        )}
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
