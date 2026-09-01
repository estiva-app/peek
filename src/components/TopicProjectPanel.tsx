import {
  RelayReadError,
  classifyRelayFailure,
  describeRelayFailure,
  isOutage,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { peekLiveTopics } from '@/nostr/liveTopics'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { IconChevronRight, IconFolderOpen } from '@tabler/icons-react'
import { api } from '../../convex/_generated/api'
import type { FolderProject, ForeignObject, ResolvedSlot } from '@estiva-app/interop'
import { hasConvex, useForeignObjects } from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'
import { ActionControl, StatusPill } from '@/components/ui/ForeignObjectWidget'
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
            <ActionControl
              action={row.action}
              people={object.people}
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
  // Same query the conversation header already uses for its Folder link, so a
  // topic's Folder is fetched once and shared, not resolved twice.
  const folder = useQuery(
    api.nostr.data.folderForTopic,
    hasConvex && topicKey ? { topicKey } : 'skip',
  )
  const { resolveFolderProject: resolveProject, applyAction } = useForeignObjects()
  /** Kept with the Folder it came from, so switching topics cannot show the
   *  previous topic's project while the next one resolves. */
  const [resolved, setResolved] = useState<{
    folder: string
    project: FolderProject | null
    failed?: RelayFailureKind
  }>()
  const [actingOn, setActingOn] = useState<string>()
  const [errors, setErrors] = useState<Record<string, string>>({})

  // An action, not a query: this reads a relay over HTTP, which Convex's
  // reactive layer cannot do. So the panel reflects the moment it resolved and
  // does not live-update — acceptable for context beside a conversation, and
  // the honest limitation to note rather than hide.
  const load = useCallback(
    (target: string): Promise<{
      folder: string
      project: FolderProject | null
      failed?: RelayFailureKind
    }> => {
      return resolveProject(target)
        .then((project) => ({ folder: target, project }))
        .catch((error: unknown) => {
          // Still swallowed — nothing throws, nothing interrupts, and the app
          // keeps working off its Convex rows. What changed is that the failure
          // is now *recorded* rather than only logged, so the panel can say
          // which empty state this is.
          const kind =
            error instanceof RelayReadError
              ? error.kind
              : classifyRelayFailure((error as Error)?.message ?? '')
          // Not a member is a real answer, arrived at successfully — it says
          // nothing about the relay being reachable and must not light the
          // connection indicator.
          if (isOutage(kind)) recordReadFailure(kind)
          console.warn('[nostr] folder project read failed:', error)
          return { folder: target, project: null, failed: kind }
        })
    },
    [resolveProject],
  )

  useEffect(() => {
    if (!folder) return
    let cancelled = false
    load(folder).then((next) => !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [folder, load])

  /*
    The socket now drives this, and the timer became the fallback (PRO-10).

    This block used to end "routing 30850/30851 into a panel refresh would make
    this instant instead of eventual… worth its own". It was, and this is it.
    The subscription has always been kindless, so a Ship issue moving already
    arrived in the browser the moment it was published; `liveProjection` dropped
    it for want of anywhere to put it. It now reports the Folder, and the panel
    re-reads.

    No event is carried and none is stored. Peek does not hold Ship's records —
    the panel reads them off the relay, which is ADR 0001's split working — so
    the useful signal is "re-read now". That is also what keeps this correct for
    an app nobody has written yet: a fourth app's records make this panel live
    without Peek learning what they are.

    **The interval stays**, and is now genuinely a fallback rather than the
    mechanism: a change published while this tab was closed arrives on focus, and
    a socket that is quietly dead stops being indistinguishable from a quiet
    workspace.
  */
  useEffect(() => {
    if (!folder) return
    // The instance the topic view already built. Null before it has connected,
    // which is a real state rather than an error — the timer below covers it.
    const live = peekLiveTopics()
    if (!live) return
    return live.onForeignActivity(folder, () => {
      // The same guard the timer uses. An action in flight re-reads on its own
      // completion, and a refresh landing after it would put the pre-change
      // state back on screen.
      if (actingOn) return
      void load(folder).then((next) => {
        if (next.folder === folder) setResolved(next)
      })
    })
  }, [folder, actingOn, load])

  /**
   * Re-resolve on focus, visibility and a slow interval (PEE-2).
   *
   * The resolve effect is keyed on the folder id, which does not change for the
   * life of the panel — so the panel read once and never again. That is the
   * reported "a project created in Ship does not show until you navigate away
   * and back": navigating away and back *is* the remount.
   */
  useRefreshTriggers(
    () => {
      if (!folder) return
      // Never over an action in flight: `onAct` re-reads after a successful
      // change, and a refresh started before it could land afterwards and put
      // the pre-change state back on screen.
      if (actingOn) return
      void load(folder).then((next) => {
        // Same guard the mount effect has, for the same reason — a slow resolve
        // for the previous topic must not paint over the next one.
        if (next.folder === folder) setResolved(next)
      })
    },
    { enabled: hasConvex && !!folder },
  )

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
        if (result.ok) setResolved(await load(folder))
        else setErrors((prev) => ({ ...prev, [object.ref]: result.reason ?? 'Change refused.' }))
      } catch (e) {
        setErrors((prev) => ({ ...prev, [object.ref]: (e as Error).message }))
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
  const folderProject: FolderProject | null | 'loading' | { failed: RelayFailureKind } =
    folder === undefined
      ? 'loading'
      : folder === null
        ? null
        : resolved?.folder === folder
          ? resolved.failed
            ? { failed: resolved.failed }
            : resolved.project
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
