import { useCallback, useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { ForeignObject, ResolvedAction, ResolvedSlot } from '../../../convex/nostr/projection'
import { hasConvex } from '@/api'
import { cn } from '@/lib/utils'

/**
 * Another app's object, rendered inline in Peek.
 *
 * The object is a Linear-lite issue; nothing in this file says so. The widget
 * type, which fields appear, their labels, the status vocabulary and its
 * colours all arrive from the owning app's NIP-89 manifest at runtime.
 *
 * What this file *does* own is how it looks. That split is the point: the owner
 * declares which fields matter, the consumer renders them in its own design
 * language, and a Linear ticket looks like Peek inside Peek. It is also why the
 * manifest declares a widget *type* rather than layout — an owner that could
 * specify arbitrary layout would control Peek's UI, which is the same reason
 * iframes are ruled out (RFC_UPDATES.md §3).
 */

/** Manifest colour names → Peek's own tokens. The mapping is Peek's business. */
const COLOUR: Record<string, string> = {
  neutral: 'bg-surface-raised text-text-secondary',
  blue: 'bg-info-subtle text-info-default',
  green: 'bg-success-subtle text-success-default',
  muted: 'bg-surface-raised text-text-tertiary',
}

export function StatusPill({ slot }: { slot: ResolvedSlot }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        COLOUR[slot.colour ?? 'muted'] ?? COLOUR.muted,
      )}
    >
      {slot.value}
    </span>
  )
}

/**
 * A person, not 64 hex characters.
 *
 * Peek has profiles; until one is resolved, an abbreviation beats the raw key.
 * Shared by the meta line and the assignee control so a key never abbreviates
 * two different ways in one card.
 */
const asPerson = (pubkey: string) => `${pubkey.slice(0, 8)}…`

function Meta({ slot }: { slot: ResolvedSlot }) {
  // `as: "pubkey"` tells us to show a person rather than the key itself.
  const value = slot.isPubkey ? asPerson(slot.value) : slot.value
  return (
    <span className="text-xs text-text-tertiary">
      {slot.label ? `${slot.label}: ` : ''}
      {value}
    </span>
  )
}

/**
 * The manifest's actions, as controls.
 *
 * Every control here is drawn from a declaration, not from knowledge of the app:
 * a `select` because the manifest named a vocabulary, a button because it asked
 * for a pubkey, an input because it asked for text. Peek supplies the widgets;
 * the owning app supplies the meaning.
 */
export function ActionControl({
  action,
  busy = false,
  onAct,
  labelled = true,
  className,
}: {
  action: ResolvedAction
  busy?: boolean
  onAct: (actionId: string, value: string) => void
  /**
   * Whether the control names the field it sets.
   *
   * True in a card, where a lone `ana…` button would say nothing about what it
   * does. False in the sidebar's property rows, where the field already has a
   * label in the column to the left and repeating it reads as a stutter.
   */
  labelled?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState('')

  if (action.control === 'select') {
    return (
      <select
        aria-label={action.label}
        disabled={busy}
        value={action.current ?? ''}
        onChange={(e) => onAct(action.id, e.target.value)}
        className={cn(
          'rounded-md border border-border-default bg-bg-elevated px-2 py-1 text-xs text-text-primary disabled:opacity-50',
          className,
        )}
      >
        {action.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (action.control === 'pubkey') {
    // `@me` — the server swaps in this user's key. The browser never handles
    // key material.
    //
    // The face shows who holds the field now, so this one control both reports
    // and sets it (PEEK-18) — the same bargain the status select makes.
    // `aria-label` stays fixed on what pressing it *does*, because that does not
    // change when the value does.
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`${action.label} to me`}
        onClick={() => onAct(action.id, '@me')}
        className={cn(
          'rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:border-border-strong disabled:opacity-50',
          className,
        )}
      >
        {action.current
          ? labelled
            ? `${action.label}: ${asPerson(action.current)}`
            : asPerson(action.current)
          : `${action.label} to me`}
      </button>
    )
  }

  return (
    <form
      className={cn('flex flex-1 gap-1', className)}
      onSubmit={(e) => {
        e.preventDefault()
        if (!draft.trim()) return
        onAct(action.id, draft.trim())
        setDraft('')
      }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`${action.label}…`}
        disabled={busy}
        className="min-w-0 flex-1 rounded-md border border-border-default bg-bg-elevated px-2 py-1 text-xs disabled:opacity-50"
      />
    </form>
  )
}

function Actions({
  actions,
  busy,
  error,
  onAct,
}: {
  actions: ResolvedAction[]
  busy: boolean
  error?: string
  onAct: (actionId: string, value: string) => void
}) {
  if (!actions.length) return null

  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <ActionControl key={action.id} action={action} busy={busy} onAct={onAct} />
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger-default">{error}</p>}
    </div>
  )
}

/**
 * "Open in <app>" — the way back out of Peek, for a card that has no other one.
 *
 * A resolved object does not use this: its **title** is the link, and one card
 * carrying both was the same destination twice (PEEK-18). What is left is the
 * unreachable case, where there is no title to click because the object never
 * loaded — precisely when somebody wants to open it in the app that can see it.
 *
 * The URL comes from the owning app's NIP-89 `web` tag, already substituted
 * server-side. Peek does not construct it and does not know what it points at,
 * which is the same discipline as everything else here: without the manifest
 * there would be no link, because there is nothing in an naddr that says where
 * a human should go to see the thing.
 *
 * `noopener` because this is a URL a stranger published into a shared relay.
 */
function OpenInApp({ object }: { object: ForeignObject }) {
  if (!object.openUrl) return null
  return (
    <a
      href={object.openUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-text-tertiary underline decoration-dotted underline-offset-2 hover:text-text-secondary"
    >
      Open in {object.appName ?? 'app'} ↗
    </a>
  )
}

/**
 * The object itself, as a bordered card.
 *
 * Split from the resolving component so the two concerns stay apart: this draws
 * an object, `ForeignObjectWidget` fetches one. The topic sidebar draws its own
 * layout rather than this one — a project that is the subject of a whole column
 * wants a properties list and a ticket table, and a reference sitting inside a
 * message wants a line (PEEK-24).
 */
export function ForeignObjectCard({
  object,
  busy = false,
  error,
  onAct,
  className,
}: {
  object: ForeignObject
  busy?: boolean
  error?: string
  /** Omit to render the object read-only, with no manifest controls. */
  onAct?: (actionId: string, value: string) => void
  className?: string
}) {
  const { slots, meta, widget } = object

  /**
   * Only the controls that set a field.
   *
   * A manifest also declares a comment action, and Peek does not draw it: you
   * comment on one of these by replying to the message it hangs off, which is
   * the conversation already on screen (PEEK-18). A box competing with that is
   * a second, worse inbox for the same thread.
   *
   * `emits.field` is a property of the declaration rather than knowledge of the
   * app — Peek is choosing which *kind* of control it renders, not which app it
   * is talking to.
   */
  const actions = object.actions.filter((action) => action.field)

  /**
   * Fields an action already puts on screen.
   *
   * A status pill beside a status picker, or "Assignee: ana…" beside an assign
   * button, is one fact rendered twice — and the second copy is the one that
   * goes stale, because the control is what people read (PEEK-18). So the
   * control wins and the label steps aside.
   *
   * Only when the controls are actually drawn: read-only cards (the topic
   * sidebar) have no controls to defer to, so they keep the labels and lose
   * nothing.
   */
  const covered = new Set(onAct ? actions.map((action) => action.field) : [])
  const shown = (slot: ResolvedSlot | undefined) =>
    slot && !(slot.field !== undefined && covered.has(slot.field)) ? slot : undefined

  const status = shown(slots.status)
  const visibleMeta = meta.filter(shown)

  return (
    <div
      data-foreign-object={object.address}
      className={cn(
        'rounded-lg border border-border-subtle bg-surface-raised',
        widget === 'card' ? 'p-3' : 'px-3 py-2',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* The title is the way into the owning app. A reference you cannot
                follow is a screenshot. */}
            {object.openUrl ? (
              <a
                href={object.openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm font-semibold text-text-primary hover:underline"
              >
                {slots.title?.value}
              </a>
            ) : (
              <span className="truncate text-sm font-semibold text-text-primary">
                {slots.title?.value}
              </span>
            )}
            {status && <StatusPill slot={status} />}
          </div>
          {/* A card shows the subtitle; a row is a single line by definition —
              except in the sidebar, where the description is what makes a
              ticket scannable without opening it. */}
          {widget === 'card' && slots.subtitle && (
            <p className="mt-1 text-xs text-text-secondary">{slots.subtitle.value}</p>
          )}
          {visibleMeta.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {visibleMeta.map((slot, i) => (
                <Meta key={i} slot={slot} />
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-tertiary">
          {object.appName}
          {/* No recommendation existed, so the handler was a guess. Worth saying:
              "we were told" and "we guessed" should not look identical. */}
          {!object.viaRecommendation && ' ?'}
        </span>
      </div>

      {onAct && <Actions actions={actions} busy={busy} error={error} onAct={onAct} />}
    </div>
  )
}

export function ForeignObjectWidget({ naddr }: { naddr: string }) {
  const resolve = useAction(api.nostr.foreign.resolveObject)
  const applyAction = useAction(api.nostr.act.applyAction)
  const [object, setObject] = useState<ForeignObject | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>()

  const reload = useCallback(
    () => resolve({ naddr }).then(setObject).catch(() => setObject(null)),
    [naddr, resolve],
  )

  const onAct = useCallback(
    async (actionId: string, value: string) => {
      setBusy(true)
      setActionError(undefined)
      try {
        const result = await applyAction({ naddr, actionId, value })
        // The relay is the authority on whether this happened, so re-read rather
        // than patching local state optimistically. Slower, and it means the
        // widget can never claim a change the shared record does not have.
        if (result.ok) await reload()
        else setActionError(result.reason)
      } catch (e) {
        setActionError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [applyAction, naddr, reload],
  )

  useEffect(() => {
    // Peek runs without a deployment in tests, Storybook and checkouts with no
    // backend (`hasConvex`). There is no relay to ask in that mode, so resolve
    // to nothing rather than calling an action that has no client behind it.
    if (!hasConvex) {
      setObject(null)
      return
    }
    let cancelled = false
    // An action, not a query: this reads a relay over HTTP, which Convex's
    // reactive query layer cannot do. So there is no live update — the widget
    // reflects the moment it was resolved. Good enough for a message
    // attachment, and the honest limitation to note rather than hide.
    resolve({ naddr })
      .then((result) => !cancelled && setObject(result))
      .catch(() => !cancelled && setObject(null))
    return () => {
      cancelled = true
    }
  }, [naddr, resolve])

  // A reference we cannot resolve degrades to nothing, leaving the message text
  // intact. Never break a message because an attachment failed.
  if (object === 'loading' || object === null) return null

  if (object.unreachable) {
    return (
      <div className="mt-1 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-text-tertiary">
        {object.appName ?? 'Another app'} object — you may not have access to this Folder.{' '}
        {object.openUrl && <OpenInApp object={object} />}
      </div>
    )
  }

  return (
    <ForeignObjectCard
      object={object}
      busy={busy}
      error={actionError}
      onAct={onAct}
      className="mt-1"
    />
  )
}
