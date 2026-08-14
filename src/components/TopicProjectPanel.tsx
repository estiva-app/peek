import { useCallback, useEffect, useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { IconChevronRight, IconFolderOpen } from '@tabler/icons-react'
import { api } from '../../convex/_generated/api'
import type { FolderProject, ForeignObject, ResolvedSlot } from '../../convex/nostr/projection'
import { hasConvex } from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActionControl, StatusPill } from '@/components/ui/ForeignObjectWidget'
import { SkeletonBar } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import { currentEstivaToken } from '@/auth/estivaId'

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
}: {
  object: ForeignObject
  busy: boolean
  onAct?: (actionId: string, value: string) => void
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
            <ActionControl action={row.action} busy={busy} onAct={onAct} labelled={false} />
          ) : row.slot ? (
            <span className="text-xs text-text-secondary">
              {row.slot.isPubkey ? `${row.slot.value.slice(0, 8)}…` : row.slot.value}
            </span>
          ) : (
            <span className="text-xs text-text-tertiary">—</span>
          )}
        </Property>
      ))}
    </div>
  )
}

/**
 * How much of the work is behind you.
 *
 * The counts already say it, but a number is read and a bar is *seen* — and
 * "how is this project going" is the question somebody opens this panel with.
 * Rides the same line as the count and stays deliberately quiet: two hairlines
 * of muted colour, no legend, no percentage. It is a glance, not a chart.
 */
function Progress({ done, open }: { done: number; open: number }) {
  const total = done + open
  if (total === 0) return null

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} tickets done`}
      className="h-[3px] flex-1 overflow-hidden rounded-full bg-bg-inset"
    >
      <div
        className="h-full rounded-full bg-success-muted transition-[width] duration-300"
        style={{ width: `${Math.round((done / total) * 100)}%` }}
      />
    </div>
  )
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-xs text-text-tertiary">{label}</span>
      {children}
    </div>
  )
}

export function TopicProjectPanelView({
  folderProject,
  onAct,
  actingOn,
  errors = {},
}: {
  /** `'loading'` while the relay is being read; `null` when there is no project. */
  folderProject: FolderProject | null | 'loading'
  /** Omitted in stories and tests: properties render as values, not controls. */
  onAct?: (object: ForeignObject, actionId: string, value: string) => void
  /** naddr of the object a change is in flight for. */
  actingOn?: string
  /** Per-object failure text, keyed by naddr. */
  errors?: Record<string, string>
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
  const error = errors[project.naddr]

  return (
    <PanelShell>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="rounded-lg border border-border-subtle bg-surface-raised">
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

            <Properties
              object={project}
              busy={actingOn === project.naddr}
              onAct={onAct ? (id, value) => onAct(project, id, value) : undefined}
            />
            {error && <p className="text-xs text-danger-default">{error}</p>}
          </div>

          {/* Tickets live inside the widget: they are part of the project, not a
              second thing in the column beside it. */}
          <div className="flex items-center gap-3 border-t border-border-subtle px-3 py-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex shrink-0 items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
            >
              <IconChevronRight
                size={14}
                stroke={1.5}
                className={cn('shrink-0 transition-transform', expanded && 'rotate-90')}
              />
              {/* Open over done: what is left, against what is behind you. */}
              Tickets ({openCount}/{doneCount})
            </button>
            {/* Beside the button rather than inside it: a progressbar nested in
                a control folds its label into the button's accessible name. */}
            <Progress done={doneCount} open={openCount} />
          </div>

          {expanded &&
            (tickets.length === 0 ? (
              <p className="border-t border-border-subtle px-3 py-2 text-xs text-text-tertiary">
                No tickets in this project yet.
              </p>
            ) : (
              <table className="w-full table-fixed border-t border-border-subtle text-xs">
                <tbody>
                  {tickets.map((ticket) => (
                    <tr key={ticket.address} className="border-b border-border-subtle last:border-b-0">
                      <td className="max-w-0 truncate py-1.5 pl-3 pr-2">
                        {ticket.openUrl ? (
                          <a
                            href={ticket.openUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-secondary hover:text-text-primary hover:underline"
                          >
                            {ticket.slots.title?.value ?? 'Untitled'}
                          </a>
                        ) : (
                          <span className="text-text-secondary">
                            {ticket.slots.title?.value ?? 'Untitled'}
                          </span>
                        )}
                      </td>
                      <td className="w-[96px] py-1.5 pr-3 text-right">
                        {ticket.slots.status && <StatusPill slot={ticket.slots.status} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </div>
      </div>
    </PanelShell>
  )
}

export function TopicProjectPanel({ topicKey }: { topicKey: string }) {
  // Same query the conversation header already uses for its Folder link, so a
  // topic's Folder is fetched once and shared, not resolved twice.
  const folder = useQuery(
    api.nostr.data.folderForTopic,
    hasConvex && topicKey ? { topicKey } : 'skip',
  )
  const resolveProject = useAction(api.nostr.foreign.projectForFolder)
  const applyAction = useAction(api.nostr.act.applyAction)
  /** Kept with the Folder it came from, so switching topics cannot show the
   *  previous topic's project while the next one resolves. */
  const [resolved, setResolved] = useState<{ folder: string; project: FolderProject | null }>()
  const [actingOn, setActingOn] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})

  // An action, not a query: this reads a relay over HTTP, which Convex's
  // reactive layer cannot do. So the panel reflects the moment it resolved and
  // does not live-update — acceptable for context beside a conversation, and
  // the honest limitation to note rather than hide.
  const load = useCallback(
    (target: string) => {
      console.log(`[TRACE] TopicProjectPanel.load: called with target=${target}`)
      return resolveProject({ folder: target, estivaIdToken: currentEstivaToken() })
        .then((project) => {
          console.log(`[TRACE] TopicProjectPanel.load: resolveProject returned`, project)
          return { folder: target, project }
        })
        .catch((err) => {
          console.log(`[TRACE] TopicProjectPanel.load: resolveProject error`, err)
          return { folder: target, project: null }
        })
    },
    [resolveProject],
  )

  useEffect(() => {
    console.log(`[TRACE] TopicProjectPanel.useEffect: folder=${folder}`)
    if (!folder) return
    let cancelled = false
    load(folder).then((next) => !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [folder, load])

  const onAct = useCallback(
    async (object: ForeignObject, actionId: string, value: string) => {
      if (!folder) return
      setActingOn(object.naddr)
      setErrors((prev) => ({ ...prev, [object.naddr]: '' }))
      try {
        const result = await applyAction({ 
          naddr: object.naddr, 
          actionId, 
          value,
          estivaIdToken: currentEstivaToken(),
        })
        // The relay is the authority on whether this happened, so re-read rather
        // than patching local state optimistically. Slower, and it means the
        // panel can never claim a change the shared record does not have.
        if (result.ok) setResolved(await load(folder))
        else setErrors((prev) => ({ ...prev, [object.naddr]: result.reason ?? 'Change refused.' }))
      } catch (e) {
        setErrors((prev) => ({ ...prev, [object.naddr]: (e as Error).message }))
      } finally {
        setActingOn(undefined)
      }
    },
    [applyAction, folder, load],
  )

  // Peek runs on static mocks in tests, Storybook and checkouts with no backend.
  // There is no relay to ask in that mode, so the sidebar stays away entirely
  // rather than adding an empty column to every topic.
  if (!hasConvex) return null

  // `undefined` is the Folder query still loading; `null` is a topic with no
  // Folder at all (created before Nostr emission was wired up) — nothing to
  // resolve, and the empty state is the honest answer.
  const folderProject: FolderProject | null | 'loading' =
    folder === undefined
      ? 'loading'
      : folder === null
        ? null
        : resolved?.folder === folder
          ? resolved.project
          : 'loading'

  return (
    <TopicProjectPanelView
      folderProject={folderProject}
      onAct={onAct}
      actingOn={actingOn}
      errors={errors}
    />
  )
}
