import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { IconPencil } from '@tabler/icons-react'
import { api } from '../../convex/_generated/api'
import type { FolderProject } from '@estiva-app/interop'
import { hasConvex, useForeignObjects, useRenameTopic, useTopicActivity, useTopicDetails } from '@/api'
import type { RenameOutcome } from '@/api'
import { ActivityTimeline, type ActivityEntry } from './ui/ActivityTimeline'
import { Avatar } from './ui/Avatar'
import { Chip } from './ui/Chip'
import { cn } from '@/lib/utils'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { SectionLabel } from './ui/SectionHeader'
import { Person } from './ui/Person'
import { ProjectTickets } from './ui/ProjectTickets'
import { StatusPill } from './ui/ForeignObjectWidget'
import { TextInput } from './ui/TextInput'
import { Card, FieldLine } from '@estiva-app/ui'

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
  /** Resolves to `null` when it went through cleanly, or to what to say. */
  onRename?: (title: string) => Promise<RenameOutcome>
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
  const [outcome, setOutcome] = useState<RenameOutcome>(
    initialError ? { kind: 'error', message: initialError } : null,
  )
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
    let result: RenameOutcome
    try {
      result = await onRename(canonical)
    } catch (error) {
      // Nothing may leave this control stuck. A caller that throws is a caller
      // that has already done half the work, and "Saving…" for ever is the
      // worst way to say so.
      result = {
        kind: 'error',
        message: error instanceof Error ? error.message : 'That rename did not go through.',
      }
    } finally {
      setSaving(false)
    }
    setOutcome(result)
    /*
     * Only a real error keeps the field open. A warning means the rename
     * happened and simply was not announced to the relay — leaving the editor
     * up with a red line under it made a rename that had plainly worked look
     * like it had failed (Katerina, 2026-08-20). The draft is kept on an
     * error, because throwing away what somebody typed to show them the name
     * they were replacing helps nobody.
     */
    if (result?.kind !== 'error') setEditing(false)
  }

  return (
    <DialogShell
      title="Topic details"
      onClose={onClose}
      width={560}
      bodyMaxHeight="max-h-[70vh]"
      bodyClassName="flex flex-col gap-6 [&>*]:shrink-0"
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
                    setOutcome(null)
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
                  setOutcome(null)
                }}
              >
                Cancel
              </Button>
            </div>
            <Outcome outcome={outcome} />
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
        {!editing && <Outcome outcome={outcome} />}
        {/*
          * No "Created by" line here. It was saying a third time what the
          * members list already says under the creator's name and what the
          * first entry in Activity says with a date attached — and of the
          * three, this was the one with the least to add.
          */}
      </Section>

      {/* The count as a chip beside the heading rather than "(3)" after it
          (Katerina, 2026-08-20) — the same pill the conversation header puts
          beside its facepile, so one number reads one way. */}
      <Section
        label="Members"
        trailing={details && <Chip type="neutral" label={String(details.members.length)} />}
      >
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
          {/*
            * The Files panel's card, in a dialog (Katerina, 2026-08-20). Same
            * bordered card, same status and lead as pills side by side, same
            * tickets accordion with its counter and bar. It is the same project
            * either way — showing it two ways would only invite them to drift.
            */}
          <Card fill="none">
            <div className="flex flex-col gap-2 px-3 py-2.5">
              <span className="min-w-0 truncate text-body-2 font-semibold text-text-primary">
                {folderProject.project.slots.title?.value ?? 'Untitled'}
              </span>
              {folderProject.project.slots.subtitle && (
                <p className="line-clamp-2 text-caption text-text-secondary">
                  {folderProject.project.slots.subtitle.value}
                </p>
              )}
              {/*
                * Side by side and unlabelled: "Status" and "Lead" in front of a
                * status and a face were captions on things that say what they
                * are. Read-only, so these are pills rather than the panel's
                * controls — the same shape, without the press.
                */}
              <div className="flex flex-wrap items-center gap-2">
                {folderProject.project.slots.status && (
                  <ReadOnlyPill>
                    <StatusPill slot={folderProject.project.slots.status} />
                  </ReadOnlyPill>
                )}
                {folderProject.project.meta
                  .filter((slot) => slot.isPubkey)
                  .map((slot, i) => (
                    <ReadOnlyPill key={`${slot.label ?? 'person'}-${i}`}>
                      <Person pubkey={slot.value} people={folderProject.project.people} />
                    </ReadOnlyPill>
                  ))}
              </div>
            </div>
            <ProjectTickets
              tickets={folderProject.tickets}
              openCount={folderProject.openCount}
              doneCount={folderProject.doneCount}
            />
          </Card>
        </Section>
      )}

      <Section label="Activity">
        <ActivityTimeline entries={activity} />
      </Section>
    </DialogShell>
  )
}

function Section({
  label,
  trailing,
  children,
}: {
  label: string
  /** Sits beside the heading — the members count, as a chip rather than text. */
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    // 12px under the heading, not 8: at 8 the label sat as close to its own
    // content as the content's rows sat to each other, so the sections read as
    // one list rather than four (Katerina, 2026-08-20).
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SectionLabel>{label}</SectionLabel>
        {trailing}
      </div>
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

/**
 * A read-only pill, shaped like the small controls the Files panel uses.
 *
 * The dialog shows a project it cannot change, so this is the control's shape
 * without its press: same height, same border, same radius, no hover and no
 * cursor. It keeps a project looking like itself in both places, which is the
 * whole point of showing it here at all.
 */
function ReadOnlyPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-lg border border-border-default px-2 text-caption text-text-secondary">
      {children}
    </span>
  )
}

/**
 * What came of the rename, in the tone the outcome deserves.
 *
 * An error is red because nothing happened and something must. A warning is
 * not, because the rename *did* happen — it just has not reached the relay, so
 * other apps still show the old name. Painting that red said "this failed"
 * under a name that had visibly changed.
 */
function Outcome({ outcome }: { outcome: RenameOutcome }) {
  if (!outcome) return null
  // The package's line since 0.12.2 (§4.3, B24): the same two classes a Field
  // draws under a control, for a line that sits under the rename *row* — a
  // field and two buttons — which a Field cannot wrap without a second label.
  // It is announced, which the hand-written paragraph was not.
  return <FieldLine tone={outcome.kind}>{outcome.message}</FieldLine>
}
