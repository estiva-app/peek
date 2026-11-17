import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IconDotsVertical, IconHash } from '@tabler/icons-react'
import { ConversationLayout, EmptyState, Menu, MenuItem, PageHeader, Toolbar, ToolbarButton, useShortcut } from '@estiva-app/ui'
import { useMembership, usePlaceFollow, useTeamChatPageDot, useWorkspaceDirectory, type Team } from '@/api'
import { PageDot, type PageLine } from '@/components/PageListDot'
import { usePlaceFollowControls } from '@/components/PlaceFollow'
import { chatLabel, teamChatPath } from '@/components/views/TeamsColumn'
import { useFileConversationView } from '@/components/views/useFileConversationView'
import { draftKeys } from '@/lib/drafts'
import { useMarkChannelRead } from '@/lib/useMarkRead'
import { copyPageLink } from '@/lib/objectUrl'
import { showConversationItemWhenDrawn } from '@/lib/messageAnchor'
import { OPEN_WORK_KEY } from '@/lib/openWorkKey'
import { OpenWorkButton } from '@/components/OpenWorkButton'
import { useToggleOpenWork } from '@/components/views/useToggleOpenWork'
import { useToast } from '@/lib/toast'

/**
 * A team's chat (TEA-5): the messages with the team's `h` and no file named,
 * with a composer, in the conversation view a DM uses. Its dot is the shared
 * rule's (`useTeamChatUnread`); opening it reads it, as a DM's opening does.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-teams-chat-is-followed-like-a-space.md
 */
export function TeamChat({ team, openLineHere }: {
  team: Team
  /** A line in its title dot's list opens here, not at its link: the Desk's panel (Katerina, 17 November; ACT-9). */
  openLineHere?: (line: PageLine) => void
}) {
  // A link may name a thread (`?thread=<root>`, a row card's reply line, ACT-3): it opens, and each new one opens again.
  const linked = useSearchParams()[0].get('thread')
  const [thread, setThread] = useState<string | null>(linked)
  const [seenLink, setSeenLink] = useState(linked)
  if (linked !== seenLink) {
    setSeenLink(linked)
    if (linked) setThread(linked)
  }
  // The linked thread is shown where it was said, scrolled into view once drawn (U-07); one opened here is in view.
  useEffect(() => {
    if (linked) void showConversationItemWhenDrawn(linked)
  }, [linked])
  const name = chatLabel(team)
  const chat = useFileConversationView({
    container: { kind: 'channel', h: team.id, general: true },
    rootIds: NO_ROOTS,
    openThreadId: thread ?? undefined,
    onOpenThread: setThread,
    title: name,
    noteName: `${team.name}’s chat`,
    draftKey: draftKeys.container(team.id),
    empty: <EmptyState scope="section" message="Nobody has written here yet." />,
    readOnly: team.archived,
  })
  useMarkChannelRead(team.id, chat.seenAt, 0)
  /*
    The chat is followed like a team's topic (TEA-6), and its header is a topic's (Katerina, 16 November, the navigation
    prototype, step 5): `#` before its name, the dot, Who follows, the bell while you are in it, and a ⋮ with Copy link
    alone (Q-37). Who follows lists people only, with no Add and no Join: you come into a team's chat by joining the team
    (Miky, 6 Nov).
  */
  const people = useWorkspaceDirectory()
  const { me } = useMembership()
  const target = useMemo(
    () => ({ place: { address: team.chatAddress, team: team.id }, folder: team.id, archived: team.archived }),
    [team.chatAddress, team.id, team.archived],
  )
  const follow = usePlaceFollowControls({ follow: usePlaceFollow(target), target, title: name, me, directory: people })
  const { showToast } = useToast()
  const copyLink = () => void copyPageLink(teamChatPath(team.id)).then((copied) => copied && showToast({ label: 'Link copied', type: 'success' }))
  // Add to Open work, the header's button, and Ctrl/Cmd+O, for someone in the chat (Q-37); none on an archived team's.
  const openWork = useToggleOpenWork()
  const toggleOpenWork = team.chat.in && !team.archived ? () => openWork.toggle(team.chatAddress) : undefined
  useShortcut(OPEN_WORK_KEY, () => toggleOpenWork?.(), !!toggleOpenWork)
  // The dot beside the title (ACT-4): what is new in the chat, then what was about you earlier.
  const pageDot = useTeamChatPageDot(team, teamChatPath(team.id))
  return (
    <>
      <ConversationLayout
        threads="beside"
        {...chat.conversationParts}
        title={name}
        header={
          <PageHeader
            title={name}
            // `#`, as its row in Teams wears it: one icon per kind.
            leading={<IconHash size={16} stroke={1.5} aria-hidden />}
            after={<PageDot dot={pageDot} {...(openLineHere ? { openHere: openLineHere } : {})} />}
            members={follow.pill}
            button={toggleOpenWork ? <OpenWorkButton inIt={openWork.has(team.chatAddress)} onToggle={toggleOpenWork} /> : undefined}
            actions={
              <Toolbar aria-label={`${name} actions`} surface={false}>
                {follow.bell}
                <Menu
                  align="right"
                  trigger={
                    <ToolbarButton tooltip="More actions" aria-label="More actions">
                      <IconDotsVertical size={16} stroke={1.5} />
                    </ToolbarButton>
                  }
                >
                  <MenuItem label="Copy link" onClick={copyLink} />
                </Menu>
              </Toolbar>
            }
          />
        }
      />
      {follow.dialog}
    </>
  )
}

const NO_ROOTS: readonly string[] = []
