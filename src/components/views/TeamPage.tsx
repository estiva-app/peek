import { useMemo, useState } from 'react'
import { IconDotsVertical, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { EmptyState, IconButton, MembersDialog, Menu, NavItem, PageHeader, ScrollArea, SectionLabel, SkeletonList, type MembersDialogCandidate } from '@estiva-app/ui'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { teamPlaces, useMentionNames, usePeekActions, usePeople, useTeamFiles, useTeamTopics, type Team } from '@/api'
import { Button } from '@/components/ui/Button'
import { PersonItem } from '@/components/ui/PersonItem'
import { TreeRow } from '@/components/views/FileTreeView'
import { chatLabel, teamChatPath } from '@/components/views/TeamsColumn'
import type { FileControl } from '@/components/views/useFileControls'
import { useFolderActions } from '@/components/views/useFolderActions'
import { FolderActionDialog } from '@/components/views/FolderActionDialog'
import { useToast } from '@/lib/toast'

/**
 * A team's page (TEA-5): its places, the files it holds outside any topic, and
 * who is in it, agents apart — the approved prototype without its explaining
 * lines (Miky, 2 November; Decided, 3 November). Join, Leave, Follow and Add
 * sit in its header: a member adds someone or leaves, anyone else follows or
 * joins. Its ⋮ is the team's own (Start a topic, Rename, Archive…), as the
 * column's heading had it.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-join-an-open-team-and-only-its-members-add-or-mark.md
 */
export function TeamPage({
  team,
  folder,
  folders,
  reloadFolders,
  onControl,
}: {
  team: Team
  /** The team's Folder, for its own menu. */
  folder: FolderSummary
  folders: FolderSummary[] | null
  reloadFolders: () => Promise<unknown>
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { joinTeam, leaveTeam, addToTeam, followTeam, markSpace } = usePeekActions()
  const { showToast } = useToast()
  const names = useMentionNames()
  const { topics } = useTeamTopics()
  const { files, failed: filesFailed } = useTeamFiles(team.id)
  const { menuFor, action, close } = useFolderActions()
  const [busy, setBusy] = useState(false)

  const nameOf = useMemo(() => new Map((names ?? []).map((person) => [person.pubkey, person])), [names])
  const people = team.members.filter((member) => !nameOf.get(member.pubkey)?.bot)
  const agents = team.members.filter((member) => nameOf.get(member.pubkey)?.bot)
  const inTeam = new Set(team.members.map((member) => member.pubkey))
  /*
    Add offers the company's people and agents not on the team — the roster,
    never an app's or the server's own key, and never the viewer (TEA-11).

    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-service-key-is-let-in-but-is-not-in-the-company.md
  */
  const roster = usePeople()
  const candidates: MembersDialogCandidate[] = (roster ?? []).flatMap((person) =>
    person.pubkey && !inTeam.has(person.pubkey) ? [{ id: person.pubkey, label: person.name, picture: person.avatarSrc, bot: person.bot }] : [],
  )
  const [adding, setAdding] = useState(false)

  const { spaces, led } = teamPlaces(team, topics)

  /*
    Every member may leave, a team's last owner too; nobody leaves the Company
    team (§3.4). A team left with no owner is looked after by the workspace's
    owners and admins.

    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-teams-last-owner-may-leave-and-the-company-teams-owners-look-after-it.md
    why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-with-no-owner-is-looked-after-by-the-workspaces-admins.md
  */
  const canLeave = !team.company

  const run = async (write: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true)
    const result = await write()
    setBusy(false)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }
  const row = (topic: ForeignObject, space: boolean) => (
    <TreeRow
      key={topic.ref}
      file={topic}
      onControl={onControl}
      nested
      // Only a team's members mark its spaces (SPEC §3.3); the relay refuses anyone else.
      space={team.isMember && !team.archived && topic.address ? { action: space ? 'unmark' : 'mark', onToggle: () => void run(() => markSpace(team.id, topic.address!, !space)) } : undefined}
    />
  )

  const actions = team.archived ? undefined : team.isMember ? (
    <>
      {candidates.length > 0 && (
        <Button variant="muted" size="small" leadingIcon={<IconUserPlus size={14} stroke={1.5} />} disabled={busy} onClick={() => setAdding(true)}>
          Add
        </Button>
      )}
      {canLeave && (
        <Button variant="muted" size="small" disabled={busy} onClick={() => void run(() => leaveTeam(team.id))}>
          Leave
        </Button>
      )}
    </>
  ) : (
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={team.name}
        actions={
          <>
            {actions}
            {menu && (
              <Menu
                align="right"
                trigger={
                  <IconButton aria-label="More" tooltip="More">
                    <IconDotsVertical size={16} stroke={1.5} />
                  </IconButton>
                }
              >
                {menu}
              </Menu>
            )}
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex max-w-2xl flex-col gap-6 px-4 py-4">
          <section className="flex flex-col gap-0.5">
            <SectionLabel tone="muted">Places</SectionLabel>
            {team.isMember && <NavItem href={teamChatPath(team.id)} label={chatLabel(team)} icon={<IconUsers size={16} stroke={1.5} aria-hidden />} />}
            {spaces.map((topic) => row(topic, true))}
            {led.map((topic) => row(topic, false))}
            {spaces.length + led.length === 0 && <EmptyState scope="section" message="No spaces or topics yet" />}
          </section>
          {/* A team with nothing outside its topics shows no Files at all: an empty heading tells nobody anything. */}
          {(filesFailed || files === null || files.length > 0) && (
            <section className="flex flex-col gap-0.5">
              <SectionLabel tone="muted">Files</SectionLabel>
              {filesFailed ? (
                <EmptyState scope="section" message="Couldn’t load its files. Reload to try again." />
              ) : files === null ? (
                <SkeletonList />
              ) : (
                files.map((file) => <TreeRow key={file.ref} file={file} onControl={onControl} nested />)
              )}
            </section>
          )}
          <section className="flex flex-col gap-0.5">
            <SectionLabel tone="muted">{`Members · ${people.length}`}</SectionLabel>
            {people.map((member) => (
              <PersonItem key={member.pubkey} id={member.pubkey} name={nameOf.get(member.pubkey)?.name ?? '—'} active={false} />
            ))}
          </section>
          {agents.length > 0 && (
            <section className="flex flex-col gap-0.5">
              <SectionLabel tone="muted">{`Agents · ${agents.length}`}</SectionLabel>
              {agents.map((member) => (
                <PersonItem key={member.pubkey} id={member.pubkey} name={nameOf.get(member.pubkey)?.name ?? '—'} active={false} />
              ))}
            </section>
          )}
        </div>
      </ScrollArea>
      {adding && (
        // The kit's Add members, as a topic's Members opens it (TEA-11): straight on its add layer, back to the roster once the relay took them. Leave stays in the header.
        <MembersDialog
          members={team.members.map((member) => ({
            id: member.pubkey,
            name: nameOf.get(member.pubkey)?.name ?? '—',
            picture: roster?.find((person) => person.pubkey === member.pubkey)?.avatarSrc,
            bot: nameOf.get(member.pubkey)?.bot,
          }))}
          candidates={candidates}
          initialView="add"
          onAdd={async (chosen) => {
            for (const person of chosen) {
              const result = await addToTeam(team.id, person.id)
              if (!result.ok) {
                showToast({ label: result.reason, type: 'error' })
                return false
              }
            }
            return true
          }}
          onClose={() => setAdding(false)}
        />
      )}
      {action && <FolderActionDialog key={`${action.kind}:${action.folder.id}`} action={action} folders={folders} reload={reloadFolders} onClose={close} />}
    </div>
  )
}
