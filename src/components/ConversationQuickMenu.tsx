import { useState, type ReactNode } from 'react'
import { IconMoodPlus, IconMessage2, IconCircleCheck, IconCircleDashed } from '@tabler/icons-react'
import { Popover, ReactionPicker, Toolbar, ToolbarButton, ToolbarSeparator } from '@estiva-app/ui'
import { REACTION_NAMES } from './ui/Reaction'
import { cn } from '@/lib/utils'

/** The palette as the package's `ReactionPicker` takes it: each emoji with
 *  the word for it, in the order Peek offers them (D49, 2026-09-10). */
const REACTION_OPTIONS = Object.entries(REACTION_NAMES).map(([emoji, label]) => ({ emoji, label }))

interface ConversationQuickMenuProps {
  isResolved?: boolean
  /**
   * A reaction was chosen. The strip owns the picker now (PEEK-ADOPTION.md
   * §4.1, D49, D30): the "React" button opens the package's `ReactionPicker`
   * in a `Popover` above the strip, and the card no longer measures anything
   * or listens for a click outside.
   */
  onReact?: (emoji: string) => void
  onReply?: () => void
  onResolve?: () => void
  onReopen?: () => void
  /** Told when the picker opens and closes, so a card can keep its strip
   *  mounted and leave a click on the message alone while it is open. */
  onPickerOpenChange?: (open: boolean) => void
  /**
   * The ⋯ menu itself, which owns its own button since `@estiva-app/ui`
   * 0.10.0. Hand it a `ToolbarButton` as its trigger so the strip stays one
   * Tab stop (D29).
   */
  more?: ReactNode
  className?: string
}

/**
 * The hover toolbar on a message, a reply and a huddle: React · Reply ·
 * Resolve/Reopen · ⋯, each drawn only when the card offers it.
 *
 * On the package's `Toolbar` since 2026-09-10 (§4.2, D29): one Tab stop, the
 * arrow keys walk the buttons, and the package draws the one box every
 * floating strip shares — this file used to draw its own, and two cards
 * re-typed that class string (Peek scan F7).
 */
export function ConversationQuickMenu({
  isResolved = false,
  onReact,
  onReply,
  onResolve,
  onReopen,
  onPickerOpenChange,
  more,
  className,
}: ConversationQuickMenuProps) {
  const [picking, setPicking] = useState(false)
  /* The picker hangs from the whole strip, right-aligned, not from its own
     button — where Peek has always put it (ConversationCard, 2026-08). */
  const [strip, setStrip] = useState<HTMLDivElement | null>(null)
  const setOpen = (open: boolean) => {
    setPicking(open)
    onPickerOpenChange?.(open)
  }

  return (
    <div ref={setStrip} className={cn('inline-flex', className)}>
      <Toolbar aria-label="Message tools">
        {onReact && (
          <Popover
            side="top"
            align="right"
            anchor={strip}
            ariaLabel="Reactions"
            className="w-auto min-w-0"
            // The 4px is the content's; on `className` it added to the
            // package's 8px (migration docs D68, Finding 60).
            contentClassName="p-1"
            open={picking}
            onOpenChange={setOpen}
            trigger={
              <ToolbarButton tooltip="React" aria-label="React">
                <IconMoodPlus size={16} stroke={1.5} />
              </ToolbarButton>
            }
          >
            <ReactionPicker
              options={REACTION_OPTIONS}
              surface={false}
              onSelect={(emoji) => {
                setOpen(false)
                onReact(emoji)
              }}
            />
          </Popover>
        )}
        {onReply && (
          <ToolbarButton tooltip="Reply" aria-label="Reply" onClick={onReply}>
            <IconMessage2 size={16} stroke={1.5} />
          </ToolbarButton>
        )}
        {(onResolve || onReopen) && (
          <>
            <ToolbarSeparator />
            {isResolved ? (
              <ToolbarButton tooltip="Reopen" aria-label="Reopen" onClick={onReopen}>
                <IconCircleDashed size={16} stroke={1.5} />
              </ToolbarButton>
            ) : (
              <ToolbarButton variant="resolve" tooltip="Resolve" aria-label="Resolve" onClick={onResolve}>
                <IconCircleCheck size={16} stroke={1.5} />
              </ToolbarButton>
            )}
          </>
        )}
        {more && (
          <>
            <ToolbarSeparator />
            {more}
          </>
        )}
      </Toolbar>
    </div>
  )
}
