import { useState } from 'react'
import { IconUsers } from '@tabler/icons-react'
import { ConversationLayout, EmptyState, PageHeader } from '@estiva-app/ui'
import type { Team } from '@/api'
import { chatLabel } from '@/components/views/TeamsColumn'
import { useFileConversationView } from '@/components/views/useFileConversationView'
import { draftKeys } from '@/lib/drafts'
import { useMarkChannelRead } from '@/lib/useMarkRead'

/**
 * A team's chat (TEA-5): the messages with the team's `h` and no file named,
 * with a composer, in the conversation view a DM uses. Its dot is the shared
 * rule's (`useTeamChatUnread`); opening it reads it, as a DM's opening does.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-teams-chat-is-followed-like-a-space.md
 */
export function TeamChat({ team }: { team: Team }) {
  const [thread, setThread] = useState<string | null>(null)
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
  return (
    <ConversationLayout
      threads="beside"
      {...chat.conversationParts}
      title={name}
      header={
        <PageHeader title={name} leading={<IconUsers size={16} stroke={1.5} aria-hidden />} />
      }
    />
  )
}

const NO_ROOTS: readonly string[] = []
