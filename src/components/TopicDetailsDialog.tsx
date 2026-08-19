import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { IconPencil } from '@tabler/icons-react'
import { api } from '../../convex/_generated/api'
import type { FolderProject } from '../../convex/nostr/projection'
import { hasConvex, useForeignObjects, useRenameTopic, useTopicActivity, useTopicDetails } from '@/api'
import { ActivityTimeline, type ActivityEntry } from './ui/ActivityTimeline'
import { Avatar } from './ui/Avatar'
import { Chip } from './ui/Chip'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { SectionLabel } from './ui/SectionHeader'
import { Person } from './ui/Person'
import { Property } from './ui/Property'
import { StatusPill } from './ui/ForeignObjectWidget'
import { TextInput } from './ui/TextInput'

/**
 * Everything a topic is, and the one place its name can be changed (PEE-2).
 *
 * Renaming lives here rather than in the header title, for two reasons that
 * came out of designing it: **permission** and **failure**. Only the topic's
 * creator may rename it — the relay grants a kind:9002 name change to a
 * channel's owner or admin — and a details row can simply be a label for
 * everybody else, where a header title would have to be an input that refuses
 * to be typed in. And when the relay says no, a dialog has somewhere to put the
 * reason; a title in a header has nowhere at all (Katerina, 2026-08-19).
 *
 * The dialog then has to be worth opening when you *cannot* change anything,
 * which is what the other three sections are for: Peek had nowhere showing who
 * started a topic, who is in it, what project it is attached to, or what has
 * happened to it.
 */
export interface TopicDetails {
  title: string
  createdAt: number
  createdByName: string | null
  /** The relay only lets a channel's owner rename it; Peek's proxy for that is
   *  the person who created the topic. False shows a label, never a locked
   *  field — a disabled input invites a fight nobody can win. */
  canRename: boolean
  members: { name: string; role: string; avatarUrl?: string; isCreator: boolean }[]
}

export function TopicDetailsDialogView({
  details,
  activity = [],
  folderProject,
  onRename,
  onClose,
  initialEditing,
  initialError,
}: {
  /** `undefined` while it loads. */
  details: TopicDetails | undefined
  activity?: ActivityEntry[]
  /** The linked project, read-only here. `null` when the topic has none. */
  folderProject?: FolderProject | null
  /** Resolves to an error to show, or null when the rename went through. */
  onRename?: (title: string) => Promise<string | null>
  onClose: () => void
  /**
   * Open straight into the rename field. **Stories and tests only** — the app
   * never passes it.
   *
   * Both live states of this row are reached by clicking, which means a static
   * story cannot show either, and these are exactly the two states worth
   * reviewing: the field itself, and a refusal. A prop that says so is more
   * honest than a story that pretends to click.
   */
  initialEditing?: boolean
  /** The refusal to show on open. Stories and tests only, as above. */
  initialError?: string
}) {
  const [editing, setEditing] = useState(initialEditing ?? false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | undefined>(initialError)
  const [saving, setSaving] = useState(false)

  // A rename that lands from elsewhere while this is open should not be
  // overwritten by a stale draft.
  useEffect(() => {
    if (!editing) setDraft(details?.title ?? '')
  }, [details?.title, editing])

  // Buzz strips leading '#' and surrounding whitespace before storing, so a
  // name of nothing but those is not a name. Checked here so Save is simply
  // unavailable rather than failing at the relay.
  const canonical = draft.replace(/^[#\s]+/, '').replace(/\s+$/, '')
  const changed = canonical !== '' && canonical !== details?.title

  const save = async () => {
    if (!onRename || !changed) return
    setSaving(true)
    const failure = await onRename(canonical)
    setSaving(false)
    setError(failure ?? undefined)
    // The draft is kept on failure. Throwing away what somebody typed to show
    // them the name they were trying to replace helps nobody.
    if (!failure) setEditing(false)
  }

  return (
    <DialogShell
      title="Topic details"
      onClose={onClose}
      width={560}
      bodyClassName="flex flex-col gap-6 max-h-[70vh] overflow-y-auto"
      footer={
        <div className="flex justify-end">
          <Button variant="outlined" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <Section label="Name">
        {editing ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextInput
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Topic name"
                onKeyDown={(e) => {
                  // Enter saves and Escape abandons, because a field with two
                  // buttons under it still gets Enter pressed at it.
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void save()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(false)
                    setError(undefined)
                  }
                }}
              />
              <Button
                variant="primary"
                size="small"
                disabled={!changed || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setEditing(false)
                  setError(undefined)
                }}
              >
                Cancel
              </Button>
            </div>
            {error && <p className="text-[12px] leading-[1.4] text-error-default">{error}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.4] text-text-primary">
              {details?.title ?? '—'}
            </span>
            {/* Absent, not disabled, for anyone who cannot rename. There is
                nothing for them to try, so there is nothing to explain. */}
            {details?.canRename && onRename && (
              <Button
                variant="outlined"
                size="small"
                leadingIcon={<IconPencil size={14} stroke={1.5} />}
                onClick={() => setEditing(true)}
              >
                {/* "Rename", not "Edit" (Katerina, 2026-08-20). "Edit" beside a
                    topic's name does not say what it edits — the name, the
                    topic, the members? The menu says "Topic details" and this
                    says the one thing it does. */}
                Rename
              </Button>
            )}
          </div>
        )}
        {/*
          * No "Created by" line here. It was saying a third time what the
          * members list already says under the creator's name and what the
          * first entry in Activity says with a date attached — and of the
          * three, this was the one with the least to add.
          */}
      </Section>

      <Section label={`Members${details ? ` (${details.members.length})` : ''}`}>
        <div className="flex flex-col">
          {(details?.members ?? []).map((member) => (
            <div key={member.name} className="flex h-12 items-center gap-3">
              <Avatar size={32} src={member.avatarUrl} name={member.name} alt={member.name} />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-[2px]">
                <span className="truncate text-[14px] font-normal leading-[1.4] text-text-primary">
                  {member.name}
                </span>
                <span className="truncate text-[12px] leading-[1.2] text-text-secondary">
                  {member.role}
                </span>
              </div>
              {/* On the right, as a chip rather than in place of their role
                  (Katerina, 2026-08-20): being the owner is a fact about their
                  standing here, not their job — and it is the answer to "who do
                  I ask", so it wants to be scannable down one edge. */}
              {member.isCreator && <Chip type="neutral" label="Owner" />}
            </div>
          ))}
        </div>
      </Section>

      {folderProject && (
        <Section label="Project">
          <div className="flex flex-col">
            <span className="min-w-0 truncate text-[14px] leading-[1.4] text-text-primary">
              {folderProject.project.slots.title?.value ?? 'Untitled'}
            </span>

            {/*
              * The project's properties as rows, the way the Files panel shows
              * them — status and lead beside their labels rather than trailing
              * the title (Katerina, 2026-08-20). Inline, the status read as
              * part of the name and the lead had nowhere to go at all.
              */}
            <div className="mt-2 flex flex-col gap-1">
              {folderProject.project.slots.status && (
                <Property label={folderProject.project.slots.status.label ?? 'Status'}>
                  <StatusPill slot={folderProject.project.slots.status} />
                </Property>
              )}
              {folderProject.project.meta.map((slot, i) => (
                <Property key={`${slot.label ?? 'meta'}-${i}`} label={slot.label ?? ''}>
                  {slot.isPubkey ? (
                    // Face and full name, or an em dash for a lead nobody has
                    // published a profile for — the same `Person` the panel and
                    // the reference widget use, so one key never reads two ways.
                    <Person
                      pubkey={slot.value}
                      people={folderProject.project.people}
                      className="text-xs text-text-secondary"
                    />
                  ) : (
                    <span className="text-xs text-text-secondary">{slot.value}</span>
                  )}
                </Property>
              ))}
            </div>

            {/* Air between what the project *is* and what is in it. Without it
                the first ticket read as another property. */}
            {folderProject.tickets.length > 0 && (
              <div className="mt-4 flex flex-col gap-1 border-t border-border-subtle pt-3">
                {/* Read-only on purpose: the Files panel is where a project is
                    worked on, and a second set of controls would be a second
                    place to change one thing. */}
                {folderProject.tickets.map((ticket) => (
                  <div key={ticket.address} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.4] text-text-secondary">
                      {ticket.slots.title?.value ?? 'Untitled'}
                    </span>
                    {ticket.slots.status && <StatusPill slot={ticket.slots.status} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section label="Activity">
        <ActivityTimeline entries={activity} />
      </Section>
    </DialogShell>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // 12px under the heading, not 8: at 8 the label sat as close to its own
    // content as the content's rows sat to each other, so the sections read as
    // one list rather than four (Katerina, 2026-08-20).
    <div className="flex flex-col gap-3">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  )
}

/**
 * The dialog, wired to Peek's data.
 *
 * The project section resolves the same way the Files panel does — a relay read
 * rather than a Convex query, so it reflects the moment it was opened and does
 * not live-update. Acceptable here: this is a reference view, and the panel
 * beside the conversation is where a project is actually worked on.
 */
export function TopicDetailsDialog({ topicKey, onClose }: { topicKey: string; onClose: () => void }) {
  const details = useTopicDetails(topicKey)
  const activity = useTopicActivity(topicKey)
  const renameTopic = useRenameTopic()
  const folder = useQuery(api.nostr.data.folderForTopic, hasConvex && topicKey ? { topicKey } : 'skip')
  const { resolveFolderProject } = useForeignObjects()
  const [project, setProject] = useState<FolderProject | null>(null)

  useEffect(() => {
    if (!folder) return
    let live = true
    void resolveFolderProject(folder)
      .then((found) => live && setProject(found))
      .catch(() => live && setProject(null))
    return () => {
      live = false
    }
  }, [folder, resolveFolderProject])

  return (
    <TopicDetailsDialogView
      details={details ?? undefined}
      activity={activity ?? []}
      folderProject={project}
      onRename={(title) => renameTopic(topicKey, title)}
      onClose={onClose}
    />
  )
}
