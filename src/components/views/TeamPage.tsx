import { useMemo, useState, type ReactNode } from 'react'
import { IconDotsVertical, IconHash, IconTarget, IconUsers } from '@tabler/icons-react'
import {
  AvatarGroup,
  EmptyState,
  IconButton,
  KindIcon,
  ListTable,
  ListTableRow,
  MembersDialog,
  MembersPill,
  Menu,
  PageHeader,
  ScrollArea,
  SectionHeader,
  SkeletonList,
  UnreadDot,
  thingKindOf,
  type ListTableColumn,
  type MembersDialogCandidate,
  type UnreadDotTone,
} from '@estiva-app/ui'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import {
  formatActive,
  teamPlaces,
  useConversationBadges,
  useMembership,
  useMentionNames,
  usePeekActions,
  usePeople,
  usePlaceFollow,
  useTeamChatActive,
  useTeamChatNews,
  useTeamFiles,
  useTeamPageDot,
  useTeamTopics,
  useTopicFacts,
  type Team,
} from '@/api'
import { PageDot } from '@/components/PageListDot'
import { Button } from '@/components/ui/Button'
import { chatLabel, teamChatPath } from '@/components/views/TeamsColumn'
import { useFolderActions } from '@/components/views/useFolderActions'
import { FolderActionDialog } from '@/components/views/FolderActionDialog'
import { filePath } from '@/lib/objectUrl'
import { rememberOpenedFrom } from '@/lib/openedFrom'
import { useToast } from '@/lib/toast'

const ICON = { size: 16, stroke: 1.5 } as const

/** Who is in it and when it was last active, as Explore lists them; both give way first in a narrow window (TP-11). */
const PLACE_COLUMNS: ListTableColumn[] = [
  { label: 'Members', width: 'small', keep: 'low' },
  { label: 'Active', width: 'medium', keep: 'low' },
]

/** One place on the page, as Explore lists it (TP-09): faces and how many follow it, when anything last happened, its dot. */
interface PlaceLine {
  key: string
  href: string
  label: string
  description?: string
  icon: ReactNode
  /** How many follow it, at All or Important (Q-31); absent until read. */
  members?: number
  faces?: { name: string; picture?: string; bot?: boolean }[]
  /** Unix seconds; absent until read, or when nothing was said (a dash, TP-12). */
  active?: number
  lit: boolean
  tone?: UnreadDotTone
  onClick?: () => void
}

/**
 * A team's page (TEA-5) with today's content in the navigation prototype's look (Katerina, 16 November, the decisions'
 * step 4). Its header: the team's icon, its name, its dot, and the Members pill, whose dialog holds Add for a member and
 * your own Leave, or Join (TP-02); Follow and Join beside it only while you are not in it (TP-04); the team's own ⋮
 * (Start a topic, Rename, Archive…) as today (TP-05). Its body takes the page's whole width (TP-07): Topics — its chat,
 * for a member, and its topics (#, today's spaces) — then the Initiatives it leads, then Files, everything it holds
 * (TP-08), each a list like Explore's, with no ⋮ and no headings on screen (TP-09, TP-10). Its people are in the Members
 * dialog, not on the page (TP-14).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-join-an-open-team-and-only-its-members-add-or-mark.md
 */
export function TeamPage({
  team,
  folder,
  folders,
  reloadFolders,
}: {
  team: Team
  /** The team's Folder, for its own menu. */
  folder: FolderSummary
  folders: FolderSummary[] | null
  reloadFolders: () => Promise<unknown>
}) {
  const { joinTeam, leaveTeam, addToTeam, followTeam } = usePeekActions()
  const { showToast } = useToast()
  const names = useMentionNames()
  const { topics } = useTeamTopics()
  const { files, failed: filesFailed } = useTeamFiles(team.id)
  const { menuFor, action, close } = useFolderActions()
  const [busy, setBusy] = useState(false)
  const [members, setMembers] = useState<'list' | 'add' | null>(null)
  // The viewer, whose own row in Members holds Leave, or Join.
  const { me } = useMembership()

  const nameOf = useMemo(() => new Map((names ?? []).map((person) => [person.pubkey, person])), [names])
  const roster = usePeople()
  const faceOf = (pubkey: string) => ({
    name: nameOf.get(pubkey)?.name ?? '—',
    picture: roster?.find((person) => person.pubkey === pubkey)?.avatarSrc,
    bot: nameOf.get(pubkey)?.bot === true,
  })
  const inTeam = new Set(team.members.map((member) => member.pubkey))
  /*
    Add offers the company's people and agents not on the team — the roster, never an app's or the server's own key, and
    never the viewer (TEA-11).

    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-service-key-is-let-in-but-is-not-in-the-company.md
  */
  const candidates: MembersDialogCandidate[] = (roster ?? []).flatMap((person) =>
    person.pubkey && !inTeam.has(person.pubkey) ? [{ id: person.pubkey, label: person.name, picture: person.avatarSrc, bot: person.bot }] : [],
  )

  const { spaces, led } = teamPlaces(team, topics)
  const places = useMemo(() => [...spaces, ...led], [spaces, led])
  /*
    The dot beside the team's name (ACT-4): lit when its chat, a topic or an initiative it leads is, and its list is
    theirs together, each line naming where it was said.
  */
  const pageDot = useTeamPageDot(team, places, { chatHref: teamChatPath(team.id), chatWhere: `# ${chatLabel(team)}` })
  // Each place's dot, orange when reactions to you are all that is new there (ACT-7), as their rows in the column have it.
  const { unread, tones } = useConversationBadges(places, { reactions: true })
  const teams = useMemo(() => [team], [team])
  const chatNews = useTeamChatNews(teams, { reactions: true })
  const facts = useTopicFacts(places)
  const chatActive = useTeamChatActive(team)
  // Who follows the chat, as its own pill counts them (Q-31): read once the page opens, for a member, who sees the chat.
  const chatTarget = useMemo(
    () => (team.isMember ? { place: { address: team.chatAddress, team: team.id }, folder: team.id, archived: team.archived } : undefined),
    [team.isMember, team.chatAddress, team.id, team.archived],
  )
  const chatFollow = usePlaceFollow(chatTarget)

  /*
    Every member may leave, a team's last owner too; nobody leaves the Company team (§3.4). A team left with no owner is
    looked after by the workspace's owners and admins.

    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-teams-last-owner-may-leave-and-the-company-teams-owners-look-after-it.md
    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-with-no-owner-is-looked-after-by-the-workspaces-admins.md
  */
  const canLeave = team.isMember && !team.company

  const run = async (write: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true)
    const result = await write()
    setBusy(false)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    return result.ok
  }

  // Follow and Join, side by side, only while you are not in it (TP-04); a member's Leave is on their own row in Members.
  const buttons =
    team.archived || team.isMember ? undefined : (
      <>
        <Button variant="muted" size="small" disabled={busy} onClick={() => void run(() => followTeam(team.id, !team.isFollowing))}>
          {team.isFollowing ? 'Unfollow' : 'Follow'}
        </Button>
        {/* A private team is joined only by being added: the relay refuses a Join there. */}
        {!team.private && (
          <Button size="small" disabled={busy} onClick={() => void run(() => joinTeam(team.id))}>
            Join
          </Button>
        )}
      </>
    )
  const menu = menuFor(folder)

  const placeLine = (topic: ForeignObject, initiative: boolean): PlaceLine => ({
    key: topic.ref,
    href: topic.address ? filePath(topic.address, topic.slots.title?.value) : '#',
    label: topic.slots.title?.value ?? 'Untitled',
    ...(topic.slots.subtitle?.value?.trim() ? { description: topic.slots.subtitle.value.trim() } : {}),
    // One icon per kind, as its row in the column wears it: # a team's topic, ◎ an initiative.
    icon: initiative ? <IconTarget {...ICON} aria-hidden /> : <IconHash {...ICON} aria-hidden />,
    ...(topic.address && facts.members.get(topic.address) !== undefined ? { members: facts.members.get(topic.address) } : {}),
    ...(topic.address && facts.active.get(topic.address) ? { active: facts.active.get(topic.address) } : {}),
    lit: unread[topic.ref] === true,
    ...(tones?.[topic.ref] ? { tone: tones[topic.ref] } : {}),
    // A team's topic opens with Teams beside it; an initiative with Initiatives.
    onClick: () => topic.address && rememberOpenedFrom(topic.address, initiative ? 'topics' : 'folders'),
  })
  const chatListed = chatFollow.listed
  const chatLine: PlaceLine | undefined = team.isMember
    ? {
        key: `chat:${team.id}`,
        href: teamChatPath(team.id),
        label: chatLabel(team),
        icon: <IconHash {...ICON} aria-hidden />,
        ...(chatListed ? { members: chatListed.length, faces: chatListed.slice(0, 3).map((l) => faceOf(l.pubkey)) } : {}),
        ...(chatActive ? { active: chatActive } : {}),
        lit: chatNews.unread[team.id] === true,
        ...(chatNews.tones[team.id] ? { tone: chatNews.tones[team.id] } : {}),
      }
    : undefined
  const rooms = [...(chatLine ? [chatLine] : []), ...spaces.map((topic) => placeLine(topic, false))]
  const initiatives = led.map((topic) => placeLine(topic, true))
  const [now] = useState(() => Date.now())

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        leading={<IconUsers {...ICON} aria-hidden />}
        title={team.name}
        after={<PageDot dot={pageDot} />}
        members={<MembersPill members={team.members.slice(0, 3).map((member) => faceOf(member.pubkey))} count={team.members.length} onClick={() => setMembers('list')} />}
        // The buttons with words in the header's own place, 8px before the ⋮ (kit, 16 November).
        button={buttons}
        actions={
          menu ? (
            <Menu
              align="right"
              trigger={
                <IconButton aria-label="More" tooltip="More">
                  <IconDotsVertical {...ICON} />
                </IconButton>
              }
            >
              {menu}
            </Menu>
          ) : undefined
        }
      />
      {/* The page's whole width, 24px in, its parts 24px apart, as Explore's (TP-07). */}
      <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col gap-6 px-6 py-5">
        <section className="flex flex-col gap-1">
          <SectionHeader title="Topics" count={rooms.length} hover="none" />
          {rooms.length === 0 ? <EmptyState scope="rows" message="No topics yet." /> : <PlaceTable label={`${team.name}’s topics`} lines={rooms} now={now} />}
        </section>
        {initiatives.length > 0 && (
          <section className="flex flex-col gap-1">
            <SectionHeader title="Initiatives" count={initiatives.length} hover="none" />
            <PlaceTable label={`${team.name}’s initiatives`} lines={initiatives} now={now} />
          </section>
        )}
        {/* A team holding no files shows no Files at all: an empty heading tells nobody anything. */}
        {(filesFailed || files === null || files.length > 0) && (
          <section className="flex flex-col gap-1">
            <SectionHeader title="Files" {...(files ? { count: files.length } : {})} hover="none" />
            {filesFailed ? (
              <EmptyState scope="rows" message="Couldn’t load its files. Reload to try again." />
            ) : files === null ? (
              <SkeletonList />
            ) : (
              // No ⋮ on the page (Katerina, 16 November): a file's is on its row in the column.
              <ListTable aria-label={`${team.name}’s files`} columns={[]}>
                {files.map((file) => (
                  <ListTableRow
                    key={file.ref}
                    href={file.address ? filePath(file.address, file.slots.title?.value) : '#'}
                    label={file.slots.title?.value ?? 'Untitled'}
                    icon={<KindIcon kind={thingKindOf(file.kind)} tone="inherit" />}
                    onClick={() => file.address && rememberOpenedFrom(file.address, 'folders')}
                    cells={[]}
                  />
                ))}
              </ListTable>
            )}
          </section>
        )}
      </ScrollArea>
      {members && (
        // Today's members, people and agents (an agent's face says so); Add for a member; your own Leave or Join on your row.
        <MembersDialog
          members={team.members.map((member) => ({ id: member.pubkey, ...faceOf(member.pubkey) }))}
          count={team.members.length}
          {...(team.archived || !me
            ? {}
            : canLeave
              ? { self: { action: 'leave' as const, id: me, onToggle: () => run(() => leaveTeam(team.id)) } }
              : !team.isMember && !team.private
                ? { self: { action: 'join' as const, id: me, onToggle: () => run(() => joinTeam(team.id)) } }
                : {})}
          // Add only while someone in the company is not in it yet (TEA-11, today's).
          {...(team.isMember && !team.archived && candidates.length > 0
            ? {
                candidates,
                onAdd: async (chosen: MembersDialogCandidate[]) => {
                  for (const person of chosen) {
                    const result = await addToTeam(team.id, person.id)
                    if (!result.ok) {
                      showToast({ label: result.reason, type: 'error' })
                      return false
                    }
                  }
                  return true
                },
              }
            : {})}
          initialView={members}
          onClose={() => setMembers(null)}
        />
      )}
      {action && <FolderActionDialog key={`${action.kind}:${action.folder.id}`} action={action} folders={folders} reload={reloadFolders} onClose={close} />}
    </div>
  )
}

/** A team's places as Explore lists them (TP-09): no ⋮, no headings on screen (TP-10), Members and Active give way first. */
function PlaceTable({ label, lines, now }: { label: string; lines: PlaceLine[]; now: number }) {
  return (
    <ListTable aria-label={label} columns={PLACE_COLUMNS} end headings={false}>
      {lines.map((line) => (
        <ListTableRow
          key={line.key}
          href={line.href}
          label={line.label}
          {...(line.description ? { description: line.description } : {})}
          icon={line.icon}
          {...(line.onClick ? { onClick: line.onClick } : {})}
          cells={[
            line.members === undefined ? undefined : (
              <>
                {line.faces && line.faces.length > 0 && <AvatarGroup members={line.faces} size={20} />}
                {line.members}
              </>
            ),
            // Nothing said yet, or not read: a dash, never a made-up date (TP-12).
            line.active ? formatActive(line.active * 1000, now) : undefined,
          ]}
          {...(line.lit ? { end: <UnreadDot {...(line.tone ? { tone: line.tone } : {})} /> } : {})}
        />
      ))}
    </ListTable>
  )
}
