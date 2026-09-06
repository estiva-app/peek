import { describeRelayFailure, type RelayFailureKind } from '@/nostr/relayRead'
import { useCallback, useState } from 'react'
import { IconChevronRight, IconFolderOpen } from '@tabler/icons-react'
import type { FolderProject, ForeignObject, ResolvedSlot } from '@estiva-app/interop'
import { hasConvex, useForeignObjects } from '@/api'
import { useFolderProject } from '@/api/useFolderProject'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActionControl, StatusPill } from '@/components/ui/ForeignObjectWidget'
import { useWorkspaceDirectory } from '@/api'
import { Person } from '@/components/ui/Person'
import { Property } from '@/components/ui/Property'
import { ProjectTickets } from '@/components/ui/ProjectTickets'
import { SkeletonBar } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

/**
 * The Folder's contents, beside the conversation (PEEK-24).
 *
 * A topic and a project are the same Folder, so pasting a project reference
 * into the topic's own conversation is mentioning the project inside the
 * project. This is the other place to put it: a panel you open when you want
 * orientation, and close when you do not.
 *
 * Headed **Files** rather than "Project" because the project is the first thing
 * in this Folder, not the only one it can hold. Whatever else lands in a Folder
 * — documents, designs, another app's objects entirely — belongs under the same
 * heading, and naming the panel after today's single occupant would have to be
 * undone the moment there are two.
 *
 * What it renders is deliberately **not** Peek's own UI. These are Linear-lite's
 * objects, in Linear-lite's shape: a title, its properties as editable
 * properties, and its tickets as a table. The layout is the owning app's
 * language; only the controls and the column are Peek's.
 *
 * It draws that itself rather than reusing `ForeignObjectCard`. The card is the
 * right answer for a reference *inside a message*, where an object is one thing
 * among many and a compact line is what fits. Here the project is the subject of
 * the whole column, and the two layouts stopped being the same thing the moment
 * this one grew a properties list and a ticket table.
 */

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-12 shrink-0 flex items-center pl-5 pr-4 py-2 border-b border-border-subtle">
        <span className="text-body-2-strong text-text-primary signal:font-mono signal:text-[10px] signal:font-medium signal:uppercase signal:tracking-[0.16em] signal:text-[color:var(--text-interactive)]">
          Files
        </span>
      </div>
      {children}
    </div>
  )
}

/** `status` → "Status". The field name is the manifest's; the casing is ours. */
const fieldLabel = (field: string) =>
  field.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The slot that reads a given field, wherever the projection put it. */
function slotForField(object: ForeignObject, field: string): ResolvedSlot | undefined {
  return [...Object.values(object.slots), ...object.meta].find((slot) => slot.field === field)
}

/**
 * The project's properties, each one a control.
 *
 * Driven by the manifest's field-setting actions rather than by a list of
 * properties Peek expects: an app that declares two gets two rows, one that
 * declares none gets its values as text. The label comes from the slot that
 * reads the same field, which is what `ResolvedSlot.field` is for — the control
 * and the value are two views of one thing, and pairing them here is what keeps
 * "Status" beside the status picker without hardcoding either word.
 */
function Properties({
  object,
  busy,
  onAct,
  directory,
}: {
  object: ForeignObject
  busy: boolean
  onAct?: (actionId: string, value: string) => void
  /** The workspace directory, for the assignee picker (PEE-1). */
  directory?: ReturnType<typeof useWorkspaceDirectory>
}) {
  const editable = object.actions.filter((action) => action.field)
  const rows = editable.length
    ? editable.map((action) => ({
        key: action.id,
        field: action.field!,
        slot: slotForField(object, action.field!),
        action,
      }))
    : // No declared actions — the owning app has not said these may be set from
      // elsewhere, so they are shown and not offered. Never a dead control.
      object.meta
        .filter((slot) => slot.field)
        .map((slot) => ({ key: slot.field!, field: slot.field!, slot, action: undefined }))

  if (!rows.length && !object.slots.status) return null

  return (
    <div className="flex flex-col gap-1.5">
      {/* Status lives in `slots`, not `meta`, so it is only a row here when the
          manifest declares no action for it; otherwise it arrives with the rest. */}
      {!rows.some((row) => row.field === object.slots.status?.field) && object.slots.status && (
        <Property label="Status">
          <StatusPill slot={object.slots.status} />
        </Property>
      )}
      {rows.map((row) => (
        <Property key={row.key} label={row.slot?.label ?? fieldLabel(row.field)}>
          {row.action && onAct ? (
            <ActionControl
              action={row.action}
              people={object.people}
              directory={directory}
              busy={busy}
              onAct={onAct}
            />
          ) : row.slot ? (
            // A pubkey is a person: their face and their full name, never the
            // key (FEE-1). Both paths go through `Person`, so the lead reads the
            // same whether or not this viewer may reassign it.
            <span className="min-w-0 text-xs text-text-secondary">
              {row.slot.isPubkey ? (
                <Person pubkey={row.slot.value} people={object.people} />
              ) : (
                row.slot.value
              )}
            </span>
          ) : (
            <span className="text-xs text-text-muted">—</span>
          )}
        </Property>
      ))}
    </div>
  )
}

export function TopicProjectPanelView({
  folderProject,
  onAct,
  actingOn,
  errors = {},
  directory,
}: {
  /**
   * `'loading'` while the relay is being read; `null` when there is genuinely no
   * project in the Folder; a {@link RelayFailureKind} when the read failed.
   *
   * The third case is the point of PEE-10. It used to collapse into `null`, so
   * "the relay refused me" and "this Folder has no project" drew the identical
   * empty panel — and an empty state that can silently mean two opposite things
   * is what makes an app feel untrustworthy rather than merely slow.
   */
  folderProject: FolderProject | null | 'loading' | { failed: RelayFailureKind }
  /** Omitted in stories and tests: properties render as values, not controls. */
  onAct?: (object: ForeignObject, actionId: string, value: string) => void
  /** naddr of the object a change is in flight for. */
  actingOn?: string
  /** Per-object failure text, keyed by naddr. */
  errors?: Record<string, string>
  /** The workspace directory, for the assignee picker (PEE-1). A prop rather
   *  than a hook so this view stays pure — tests and stories render it with
   *  no provider behind it. The container fetches it. */
  directory?: ReturnType<typeof useWorkspaceDirectory>
}) {
  const [expanded, setExpanded] = useState(false)

  if (folderProject === 'loading') {
    return (
      <PanelShell>
        <div className="flex flex-col gap-2 px-4 py-4">
          <SkeletonBar className="h-3 w-[160px]" />
          <SkeletonBar className="h-3 w-[220px]" />
        </div>
      </PanelShell>
    )
  }

  // The read failed. Deliberately drawn as an empty state rather than an error
  // banner — nothing has gone wrong with the app, and the panel is still doing
  // its job of saying what is beside this conversation. It just says honestly
  // that it does not know, instead of implying there is nothing there.
  if (folderProject !== null && 'failed' in folderProject) {
    return (
      <PanelShell>
        <div className="flex-1 flex items-center justify-center px-6">
          <EmptyState
            icon={<IconFolderOpen size={16} stroke={1.5} />}
            message={describeRelayFailure(folderProject.failed)}
          />
        </div>
      </PanelShell>
    )
  }

  if (folderProject === null) {
    return (
      <PanelShell>
        <div className="flex-1 flex items-center justify-center px-6">
          <EmptyState
            icon={<IconFolderOpen size={16} stroke={1.5} />}
            message="No project linked to this topic."
          />
        </div>
      </PanelShell>
    )
  }

  const { project, tickets, openCount, doneCount } = folderProject
  const error = errors[project.ref]

  return (
    <PanelShell>
      <div className="flex-1 overflow-y-auto p-3">
        {/* No fill, deliberately (Katerina, 2026-08-19). The reference widget
            takes one because it sits in a conversation among attachments; this
            card already has a panel of its own around it, and a second surface
            inside it would be a box drawn on a box.

            It carried `bg-surface-raised`, which is not a token this app
            defines — so it always rendered unfilled. Dropped rather than kept,
            since a class that emits nothing is a claim the file cannot back. */}
        <div className="rounded-lg border border-border-subtle">
          <div className="flex flex-col gap-2 p-3">
            {/* Full width, and the only way into Linear-lite from here — a
                separate "open in app" link was the same destination twice. */}
            {project.openUrl ? (
              <a
                href={project.openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm font-semibold text-text-primary hover:underline"
              >
                {project.slots.title?.value ?? 'Untitled project'}
              </a>
            ) : (
              <span className="block truncate text-sm font-semibold text-text-primary">
                {project.slots.title?.value ?? 'Untitled project'}
              </span>
            )}
            {project.slots.subtitle && (
              <p className="line-clamp-2 text-xs text-text-secondary">
                {project.slots.subtitle.value}
              </p>
            )}

            {/* A little more air than the 8px stack gap: the title and its
                description are one block, and the properties are the next. */}
            <div className="mt-1">
              <Properties
                object={project}
                busy={actingOn === project.ref}
                onAct={onAct ? (id, value) => onAct(project, id, value) : undefined}
                directory={directory}
              />
            </div>
            {error && <p className="text-xs text-error-default">{error}</p>}
          </div>

          {/* Tickets live inside the widget: they are part of the project, not a
              second thing in the column beside it. */}
          <ProjectTickets tickets={tickets} openCount={openCount} doneCount={doneCount} />
        </div>
      </div>
    </PanelShell>
  )
}

export function TopicProjectPanel({ topicKey }: { topicKey: string }) {
  const [actingOn, setActingOn] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})
  /*
    The Folder's contents, from the hook CON-9 extracted out of this file.

    Everything that used to live here — the Folder query, the resolve, the
    socket re-read, the refresh triggers, the "which kind of nothing is this"
    collapse — moved unchanged into `useFolderProject`, because the topic's
    conversation became a second caller: it has to know which objects are files
    *under* this one so their comments go to Activity rather than into the
    topic's own stream. Two resolves per topic would have been two chances to
    disagree about what is in the Folder.

    `actingOn` is passed so an automatic re-read never lands over a write in
    flight and puts the pre-change state back on screen.
  */
  const { state: folderProject, folder, reload } = useFolderProject(topicKey, actingOn)
  const { applyAction } = useForeignObjects()
  // The assignee picker's option list (PEE-1). Demo mode answers from mocks.
  const directory = useWorkspaceDirectory()

  const onAct = useCallback(
    async (object: ForeignObject, actionId: string, value: string) => {
      if (!folder) return
      setActingOn(object.ref)
      setErrors((prev) => ({ ...prev, [object.ref]: '' }))
      try {
        /*
          An action needs an address, and not every object has one (PRO-7). A
          change event carries an `a` tag pointing at what it changes, and a
          regular event — a Peek message — cannot be the target of one. So the
          absence of `naddr` is the correct answer here rather than a gap, and
          refusing early beats publishing a change that names nothing.
        */
        if (!object.naddr) {
          setErrors((prev) => ({ ...prev, [object.ref]: 'That object cannot be changed from here.' }))
          setActingOn(undefined)
          return
        }
        const result = await applyAction({ naddr: object.naddr, actionId, value })
        // The relay is the authority on whether this happened, so re-read rather
        // than patching local state optimistically. Slower, and it means the
        // panel can never claim a change the shared record does not have.
        if (result.ok) await reload()
        else setErrors((prev) => ({ ...prev, [object.ref]: result.reason ?? 'Change refused.' }))
      } catch (e) {
        setErrors((prev) => ({ ...prev, [object.ref]: (e as Error).message }))
      } finally {
        setActingOn(undefined)
      }
    },
    [applyAction, folder, reload],
  )

  // Peek runs on static mocks in tests, Storybook and checkouts with no backend.
  // There is no relay to ask in that mode, so the sidebar stays away entirely
  // rather than adding an empty column to every topic.
  if (!hasConvex) return null

  return (
    <TopicProjectPanelView
      folderProject={folderProject}
      onAct={onAct}
      actingOn={actingOn}
      errors={errors}
      directory={directory}
    />
  )
}
