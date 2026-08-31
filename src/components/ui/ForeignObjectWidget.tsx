import { useCallback, useEffect, useState } from 'react'
import type {
  ForeignObject,
  People,
  ResolvedAction,
  ResolvedSlot,
} from '../../../interop/projection'
import { hasConvex, useForeignObjects } from '@/api'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { Person } from './Person'
import { Select } from './Select'
import { SkeletonBar } from './Skeleton'

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
/**
 * A status is coloured text, not a pill.
 *
 * These four names are the manifest's, not Peek's: an owning app declares
 * `neutral | blue | green | muted` and the consumer decides what that means
 * here. Ship's vocabularies map Todo and Planned to neutral, In Progress to
 * blue, Done and Completed to green, Cancelled to muted.
 *
 * The backgrounds that used to be here — `bg-surface-raised`, `bg-info-subtle`,
 * `bg-success-subtle` — are not tokens this app defines, so Tailwind never
 * emitted them and no pill was ever drawn. Removed rather than replaced: text
 * is the intended treatment (2026-08-19), so the classes were describing
 * something nobody wanted. The card's own `bg-surface-raised` was the same
 * mistake and *was* visible — see the note on the card below.
 *
 * `text-text-tertiary` was dead in the same way, and that one *was* visible as a
 * fault: `muted` inherited the surrounding colour, so a cancelled item looked
 * ordinary. It maps to `--text-muted`, which is the token that name meant.
 */
const COLOUR: Record<string, string> = {
  neutral: 'text-text-secondary',
  blue: 'text-info-default',
  green: 'text-success-default',
  muted: 'text-text-muted',
}

export function StatusPill({ slot, className }: { slot: ResolvedSlot; className?: string }) {
  return (
    <span
      className={cn(
        // 12px suits the row widget and the panel's dense property rows; the
        // details dialog reads its properties at body size, so the size is the
        // caller's to set.
        'inline-flex items-center text-xs font-medium',
        COLOUR[slot.colour ?? 'muted'] ?? COLOUR.muted,
        className,
      )}
    >
      {slot.value}
    </span>
  )
}

function Meta({ slot, people }: { slot: ResolvedSlot; people?: People }) {
  /*
   * `as: "pubkey"` tells us to show a person rather than the key itself — their
   * face and their name, not eight characters of it.
   *
   * And no "Assignee:" in front of it (Katerina, 2026-08-19). A face beside a
   * name is self-evidently a person; captioning it says out loud what the
   * picture already said, and in a row widget that caption costs the width the
   * title needs.
   */
  // The meta line's own size and tone: dropping the caption must not promote
  // the value to body text beside the `PAY-1`s it sits with.
  if (slot.isPubkey) {
    return (
      <Person pubkey={slot.value} people={people} className="text-xs text-text-secondary" />
    )
  }

  return (
    <span className="text-xs text-text-secondary">
      {slot.label ? `${slot.label}: ` : ''}
      {slot.value}
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
  people,
  busy = false,
  onAct,
  className,
}: {
  action: ResolvedAction
  /** Only read by the `pubkey` control, which names who holds the field now. */
  people?: People
  busy?: boolean
  onAct: (actionId: string, value: string) => void
  className?: string
}) {
  const [draft, setDraft] = useState('')

  if (action.control === 'select') {
    /*
     * Peek's `Select`, not the browser's.
     *
     * A native option list is drawn by the operating system — system font,
     * system size, system highlight — so this one control could never match the
     * four menus Peek already has. It sits in a property row beside a 12px
     * label, hence `small`; and `w-auto` because `Select` is full-width for
     * forms, where a `Field` gives it the room.
     */
    return (
      <Select
        ariaLabel={action.label}
        disabled={busy}
        size="small"
        value={action.current ?? ''}
        onChange={(next) => onAct(action.id, next)}
        options={action.options ?? []}
        className={cn('w-auto', className)}
      />
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
      <Button
        type="button"
        variant="outlined"
        size="small"
        disabled={busy}
        aria-label={`${action.label} to me`}
        onClick={() => onAct(action.id, '@me')}
        className={className}
      >
        {/*
         * Who holds it, with nothing said about it — the same rule as the meta
         * line. Unassigned still needs words, because there is no face to read
         * and "press this to take it" is not something an empty control can
         * convey on its own.
         */}
        {action.current ? (
          <Person pubkey={action.current} people={people} />
        ) : (
          `${action.label} to me`
        )}
      </Button>
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
  people,
  busy,
  error,
  onAct,
}: {
  actions: ResolvedAction[]
  people?: People
  busy: boolean
  error?: string
  onAct: (actionId: string, value: string) => void
}) {
  if (!actions.length) return null

  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <ActionControl
            key={action.id}
            action={action}
            people={people}
            busy={busy}
            onAct={onAct}
          />
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-error-default">{error}</p>}
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
      className="text-xs text-text-secondary underline decoration-dotted underline-offset-2 hover:text-text-primary"
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
        /*
         * The same surface a file attachment sits on (Katerina, 2026-08-19).
         * The border was never the difference — both are 1px of
         * `--border-subtle` at 8px radius — but this card asked for
         * `bg-surface-raised`, which is not a token this app defines, so
         * Tailwind emitted nothing and it rendered fully transparent. A soft
         * edge over the page reads thinner than the same edge over a fill.
         *
         * `--bg-inset` is what the attachment cards use, and a reference is the
         * same sort of thing: something attached to a message from elsewhere.
         */
        'rounded-lg border border-border-subtle bg-bg-inset',
        widget === 'card' ? 'p-3' : 'px-3 py-2',
        className,
      )}
    >
      {/*
       * Baselines, not box tops. The app name is 10px beside a 14px title, so
       * aligning their boxes sat it visibly above the title's line — the
       * smaller the type, the worse it looked (2026-08-19).
       */}
      <div className="flex items-baseline gap-2">
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
                <Meta key={i} slot={slot} people={object.people} />
              ))}
            </div>
          )}
        </div>
        {/*
         * Just the app's name. A `?` used to follow it when no NIP-89
         * recommendation named the handler and Peek fell back to whichever app
         * most recently claimed the kind — "we were told" and "we guessed"
         * should not look identical, went the reasoning.
         *
         * True, and addressed to the wrong reader: nobody reading a message
         * knows what a handler recommendation is, so "ESTIVA SHIP ?" read as a
         * broken widget rather than as a disclosure (Katerina, 2026-08-19). The
         * guess is Peek's problem to get right, and when it gets it wrong the
         * widget renders wrong, which is the visible signal that matters.
         *
         * `viaRecommendation` stays on the object — it is a real fact about how
         * the manifest was found, and `projection.test.ts` pins it. It just has
         * no glyph in the message any more.
         */}
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-muted">
          {object.appName}
        </span>
      </div>

      {onAct && (
        <Actions
          actions={actions}
          people={object.people}
          busy={busy}
          error={error}
          onAct={onAct}
        />
      )}
    </div>
  )
}

/**
 * The card's shell, before its contents are known.
 *
 * Deliberately the same border, radius, background and padding as
 * `ForeignObjectCard`, so the real card replaces it without the message
 * reflowing — a placeholder of the wrong size is its own small jolt.
 *
 * Two bars: the title, and the row of status and meta beneath it. Not an
 * attempt to guess the layout of an app Peek has never heard of; just enough to
 * say "something is arriving here" and hold the space it will take.
 *
 * `animate-skeleton-in` holds it invisible for 150ms, so a reference that
 * resolves quickly — the common case — never flashes a placeholder at all.
 */
export function ForeignObjectSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        // The same surface as the card it stands in for, or the placeholder
        // and the thing it becomes are two different shapes.
        'rounded-lg border border-border-subtle bg-bg-inset p-3 animate-skeleton-in',
        className,
      )}
    >
      <SkeletonBar className="h-3.5 w-1/2" />
      <div className="mt-2 flex items-center gap-2">
        <SkeletonBar className="h-3 w-16" />
        <SkeletonBar className="h-3 w-24" />
      </div>
    </div>
  )
}

export function ForeignObjectWidget({ naddr }: { naddr: string }) {
  const { resolveObject: resolve, applyAction } = useForeignObjects()
  const [object, setObject] = useState<ForeignObject | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>()

  const reload = useCallback(
    () => {
      resolve(naddr).then(setObject).catch(() => setObject(null))
    },
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
    // The token matters as much here as in `reload`: without it this reads as
    // the backend, which is a member of no channel, so the relay returns
    // nothing and the widget silently renders as if the reference were broken.
    resolve(naddr)
      .then((result) => !cancelled && setObject(result))
      .catch(() => !cancelled && setObject(null))
    return () => {
      cancelled = true
    }
  }, [naddr, resolve])

  /**
   * Waiting is not the same as nothing, and they used to render the same.
   *
   * Resolving a reference is a round trip to the relay, so the card cannot be
   * drawn immediately. Rendering nothing meanwhile meant a message settled at
   * one height and then grew as each widget popped in — and on a slow answer
   * the reference simply looked absent (FEE-3).
   *
   * The state already told these apart; only this branch did not.
   */
  if (object === 'loading') return <ForeignObjectSkeleton className="mt-1" />

  // A reference we cannot resolve degrades to nothing, leaving the message text
  // intact. Never break a message because an attachment failed.
  if (object === null) return null

  if (object.unreachable) {
    return (
      <div className="mt-1 rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-secondary">
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
