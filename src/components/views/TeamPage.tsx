import { useMemo, useState } from 'react'
import { IconDotsVertical, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { EmptyState, IconButton, Menu, MenuItem, MenuSection, NavItem, PageHeader, ScrollArea, SectionLabel, SkeletonList } from '@estiva-app/ui'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { useMentionNames, usePeekActions, useTeamFiles, useTopicsColumn, type Team } from '@/api'
import { Button } from '@/components/ui/Button'
import { PersonItem } from '@/components/ui/PersonItem'
import { TreeRow } from '@/components/views/FileTreeView'
import { chatLabel, teamChatPath } from '@/components/views/TeamsColumn'
import type { FileControl } from '@/components/views/useFileControls'
import { useFolderActions } from '@/components/views/useFolderActions'
import { FolderActionDialog } from '@/components/views/FolderActionDialog'
import { useToast } from '@/lib/toast'

const KIND_BARE_FILE = 30840

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
  viewer,
  reloadFolders,
  onControl,
}: {
  team: Team
  /** The team's Folder, for its own menu. */
  folder: FolderSummary
  folders: FolderSummary[] | null
  viewer: string | undefined
  reloadFolders: () => Promise<unknown>
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { joinTeam, leaveTeam, addToTeam, followTeam } = usePeekActions()
  const { showToast } = useToast()
  const names = useMentionNames()
  const { state } = useTopicsColumn()
  const { files, failed: filesFailed } = useTeamFiles(team.id)
  const { menuFor, action, close } = useFolderActions()
  const [busy, setBusy] = useState(false)

  const nameOf = useMemo(() => new Map((names ?? []).map((person) => [person.pubkey, person])), [names])
  const people = team.members.filter((member) => !nameOf.get(member.pubkey)?.bot)
  const agents = team.members.filter((member) => nameOf.get(member.pubkey)?.bot)
  const inTeam = new Set(team.members.map((member) => member.pubkey))
  const candidates = (names ?? []).filter((person) => !inTeam.has(person.pubkey)).sort((a, b) => a.name.localeCompare(b.name))

  const topics = useMemo(() => {
    const out = new Map<string, ForeignObject>()
    if (typeof state === 'object' && 'mine' in state) {
      for (const { topic } of state.mine) if (topic.address) out.set(topic.address, topic)
      for (const topic of state.others) if (topic.address) out.set(topic.address, topic)
    }
    return out
  }, [state])
  const placesOf = (space: boolean) =>
    team.listed
      .filter((entry) => entry.space === space && Number(entry.address.split(':')[0]) === KIND_BARE_FILE)
      .flatMap((entry) => topics.get(entry.address) ?? [])
      .filter((topic) => !topic.archived)
  const places = [...placesOf(true), ...placesOf(false)]

  // Nobody leaves the Company team (§3.4); NIP-29 keeps a sole owner in, so Leave is not offered to the last admin.
  const soleAdmin = !!viewer && team.admins.length === 1 && team.admins[0] === viewer
  const canLeave = !team.company && !soleAdmin

  const run = async (write: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true)
    const result = await write()
    setBusy(false)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }

  const actions = team.archived ? undefined : team.isMember ? (
    <>
      {candidates.length > 0 && (
        <Menu
          align="right"
          trigger={
            <Button variant="muted" size="small" leadingIcon={<IconUserPlus size={14} stroke={1.5} />} disabled={busy}>
              Add
            </Button>
          }
        >
          <MenuSection label={`Add to ${team.name}`}>
            {candidates.map((person) => (
              <MenuItem key={person.pubkey} label={person.name} onClick={() => void run(() => addToTeam(team.id, person.pubkey))} />
            ))}
          </MenuSection>
        </Menu>
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
      <Button size="small" disabled={busy} onClick={() => void run(() => joinTeam(team.id))}>
        Join
      </Button>
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
            {places.map((topic) => (
              <TreeRow key={topic.ref} file={topic} onControl={onControl} nested />
            ))}
            {places.length === 0 && <EmptyState scope="section" message="No spaces or topics yet" />}
          </section>
          {/* A team with nothing outside its topics shows no Files at all: an empty heading tells nobody anything. */}
          {(filesFailed || files === null || files.length > 0) && (
            <section className="flex flex-col gap-0.5">
              <SectionLabel tone="muted">Files</SectionLabel>
              {filesFailed ? (
                <EmptyState scope="section" message="Its files could not be read." />
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
      {action && <FolderActionDialog key={`${action.kind}:${action.folder.id}`} action={action} folders={folders} reload={reloadFolders} onClose={close} />}
    </div>
  )
}
