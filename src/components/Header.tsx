import type { ReactNode } from 'react'
import { IconStar, IconStarFilled, IconDotsVertical } from '@tabler/icons-react'
import { Avatar, ConversationLayout, PageHeader, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { TopicMoreMenu } from './ui/TopicMoreMenu'
import type { ConversationParts } from './views/useFileConversationView'

interface HeaderProps extends Partial<ConversationParts> {
  /** Who the DM is with. Their face is found by this name (the kit's `AppProvider`). */
  name?: string
  isStarred?: boolean
  onToggleStarred?: () => void
  /** When provided, "More actions" opens a menu with an Add/Remove Open work
   *  item (OPEN-1) — the same toggle the sidebar row's menu offers. */
  openWorkAction?: 'add' | 'remove'
  onToggleOpenWork?: () => void
  /** Hide this DM from the viewer's sidebar (DMS-6) — see `TopicMoreMenu`. */
  onHideDm?: () => void
  /** The dot beside the name (ACT-4): what is new in the DM, then what was about you earlier. */
  titleDot?: ReactNode
  className?: string
}

/**
 * The column of an open direct message: the kit's `PageHeader` — the person's
 * face and name, a star and a more-actions menu — over the conversation, in
 * the kit's `ConversationLayout` (two columns; the open thread stands in the
 * layout's own column beside, which runs the page's full height).
 *
 * It drew a topic's and a huddle's bar too, with counts and a members pill,
 * until topics became files with a page of their own: a DM is all it draws.
 */
export function Header({
  name,
  isStarred = false,
  onToggleStarred,
  openWorkAction,
  onToggleOpenWork,
  onHideDm,
  titleDot,
  className,
  items = [],
  ...conversation
}: HeaderProps) {
  const hasMoreMenu = !!onHideDm || !!(openWorkAction && onToggleOpenWork)

  /* The menu owns this button since `@estiva-app/ui` 0.10.0. A DM with nothing
     for the menu has no button: it would open nothing (COMPONENTS-PEEK F3;
     Katerina, 2 November: only offer what can succeed). */
  const moreButton = (
    <ToolbarButton tooltip="More actions" aria-label="More actions">
      <IconDotsVertical size={16} stroke={1.5} />
    </ToolbarButton>
  )

  return (
    <ConversationLayout
      threads="beside"
      className={className}
      items={items}
      {...conversation}
      title={name ?? ''}
      header={
        <PageHeader
          title={name ?? ''}
          leading={<Avatar size={16} alt={name} />}
          after={titleDot}
          actions={
            /* One strip: one Tab stop, arrows along it (the package Toolbar, no box of its own; UIG-14). */
            <Toolbar aria-label="Conversation actions" surface={false}>
              <ToolbarButton
                tooltip={isStarred ? 'Remove from starred' : 'Add to starred'}
                aria-label={isStarred ? 'Remove from starred' : 'Add to starred'}
                onClick={onToggleStarred}
              >
                {isStarred ? <IconStarFilled size={16} className="text-warning-default" /> : <IconStar size={16} stroke={1.5} />}
              </ToolbarButton>
              {hasMoreMenu && <TopicMoreMenu trigger={moreButton} openWorkAction={openWorkAction} onToggleOpenWork={onToggleOpenWork} onHideDm={onHideDm} />}
            </Toolbar>
          }
        />
      }
    />
  )
}
