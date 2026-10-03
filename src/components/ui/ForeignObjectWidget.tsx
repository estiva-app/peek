import { useCallback, useEffect, useState } from 'react'
import { ARCHIVED_FIELD, BLOCK_DOCUMENT_FORMAT, pickWidget } from '@estiva-app/interop'
import type {
  ForeignObject,
  People,
  ResolvedAction,
  ResolvedSlot,
} from '@estiva-app/interop'
import { hasRelay, useForeignObjects, useWorkspaceDirectory } from '@/api'
import { cn } from '@/lib/utils'
import { objectLabel } from '@/lib/appName'
import { BlockDocumentField } from './BlockDocumentField'
import { ForeignBody } from './ForeignBody'
import { Avatar } from './Avatar'
import { Person } from './Person'
import { Select } from './Select'
import { TextInput } from './TextInput'
import { Card, Divider, FieldLine, Form, Link, SectionLabel } from '@estiva-app/ui'
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

/**
 * The status of an item from another app, such as In Progress or Done, shown as
 * coloured words.
 */
export function StatusPill({ slot, className }: { slot: ResolvedSlot; className?: string }) {
  return (
    <span
      className={cn(
        // 12px suits the row widget and the panel's dense property rows; the
        // details dialog reads its properties at body size, so the size is the
        // caller's to set.
        'inline-flex items-center text-caption font-medium',
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
      // A name takes the size and tone of where it sits (UIG-9).
      <span className="contents text-caption text-text-secondary">
        <Person pubkey={slot.value} people={people} />
      </span>
    )
  }

  return (
    <span className="text-caption text-text-secondary">
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
  directory,
  busy = false,
  onAct,
  className,
}: {
  action: ResolvedAction
  /** Only read by the `pubkey` control, which names who holds the field now. */
  people?: People
  /** The workspace directory (`useWorkspaceDirectory`) — the pubkey picker's
   *  option list. Without it the picker still offers Unassigned and the
   *  current holder, degraded rather than broken. */
  directory?: People
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
    /*
     * A person picker, not a self-assign button (PEE-1 — "a list of available
     * people, like in Ship"). Ship's exact option shape (`ProjectRail.
     * peopleOptions`): **Unassigned first** — value `''` is a real option, and
     * picking it clears the field, which the relay folds as a clear — then
     * everyone with a published profile, each with their face. The trigger
     * therefore reads "Unassigned" when nobody holds the field, and face +
     * name with no caption when somebody does — the same rule as the meta
     * line. The old control could only say "assign to me"; yourself is now
     * simply one row of the list.
     */
    const known = directory ?? {}
    const entries = Object.entries(known)
    // The current holder stays visible and pickable even while the directory
    // is loading, or if they are no longer in it: the object itself names them.
    if (action.current && !known[action.current]) {
      entries.push([action.current, people?.[action.current] ?? {}])
    }
    const options = [
      { value: '', label: 'Unassigned' },
      ...entries
        .map(([pubkey, profile]) => ({
          value: pubkey,
          // The em dash for an unnameable person, as `Person` renders — never
          // the key (FEE-1, Katerina 2026-08-19).
          label: profile.displayName ?? '—',
          leading: <Avatar size={16} src={profile.picture} alt={profile.displayName ?? ''} />,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
    return (
      <Select
        ariaLabel={action.label}
        disabled={busy}
        size="small"
        value={action.current ?? ''}
        onChange={(next) => onAct(action.id, next)}
        options={options}
        className={cn('w-auto', className)}
      />
    )
  }

  return (
    // `free`: one small field in the card's action row, not a list of fields.
    <Form
      layout="free"
      className={cn('flex flex-1 gap-1', className)}
      // Switches the field off while the object is being written, and keeps focus for it.
      busy={busy}
      onSubmit={() => {
        if (!draft.trim()) return
        onAct(action.id, draft.trim())
        setDraft('')
      }}
    >
      <TextInput
        size="small"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={`${action.label}…`}
        className="min-w-0 flex-1"
      />
    </Form>
  )
}

function Actions({
  actions,
  people,
  directory,
  busy,
  error,
  onAct,
}: {
  actions: ResolvedAction[]
  people?: People
  directory?: People
  busy: boolean
  error?: string
  onAct: (actionId: string, value: string) => void
}) {
  if (!actions.length) return null

  return (
    <div className="mt-2">
      {/* The package's rule, edge to edge (`mx-0`): it was this block's own
          `border-t` (UIG-14). */}
      <Divider className="mx-0" />
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {actions.map((action) => (
          <ActionControl
            key={action.id}
            action={action}
            people={people}
            directory={directory}
            busy={busy}
            onAct={onAct}
          />
        ))}
      </div>
      {/* The package's line since 0.12.2 (§4.3, B24) — under the row of
          action controls, and announced. */}
      {error && <FieldLine tone="error" className="mt-1">{error}</FieldLine>}
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
    // Solid, not dotted: one look for "open it elsewhere" in both apps (Katerina, 2026-09-13).
    // Its size and tone are the words' around it, in the card that could not be read (UIG-9).
    <Link href={object.openUrl} variant="underlined" external>
      Open in {object.appName ?? 'app'} ↗
    </Link>
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
  directory,
  page = false,
  className,
}: {
  object: ForeignObject
  busy?: boolean
  error?: string
  /**
   * Omit to render the object read-only, with no manifest controls.
   * `contentFormat` rides along for a block-document value (MAN-9); a promise
   * of false says the write was refused, so the editor keeps it unsaved.
   */
  onAct?: (actionId: string, value: string, contentFormat?: string) => void | Promise<boolean>
  /** The workspace directory, for the assignee picker (PEE-1). */
  directory?: People
  /**
   * Drawn on the object's own page (`FileWidgetPanel`), not in a message
   * (MAN-9). A `row` is one line in a conversation, but on its own page the
   * object is the subject, so the subtitle and the body are drawn — and the
   * body is its editor when the manifest declares one — whatever the widget.
   * Ship declares an issue a `row`, and this is where Ship itself edits the
   * description: the issue's page.
   */
  page?: boolean
  className?: string
}) {
  const { slots, meta } = object
  /*
    The declared layout, walked rather than compared — PRO-7.

    This read `object.widget` directly and compared it to `'card'`. The field is
    a type *or an ordered chain* of them (RFC 0.4 §13.3), and Peek's own
    manifest declares `["message","card"]` — so the comparison silently failed
    against an array and this card lost its subtitle. It had never bitten
    because Peek only consumes Ship, whose widgets are bare strings.
  */
  const widget = pickWidget(object.widget, ['card', 'row', 'table', 'stat'] as const, 'card')
  /** More than one line: a card anywhere, and any object on its own page (MAN-9). */
  const whole = widget === 'card' || page
  /*
    A title that is a person — `as: "pubkey"` on the title slot, which is how
    Peek's own manifest titles a message, by its author (RIC-11). The same
    rule the meta line already keeps (FEE-1): a key is never on screen, so
    the title draws the face and the name, or the em dash for a stranger.
  */
  const title = slots.title?.isPubkey ? (
    // Weight and colour come from the title's box, below, whichever way it is drawn (UIG-9).
    <Person pubkey={slots.title.value} people={object.people} />
  ) : (
    slots.title?.value
  )

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
   *
   * Nor the action that sets the **title's** field (FOL-33). The title is the
   * card's heading and its link, not a property row, and a rename box under
   * every card of a file whose manifest declares one — the bare file's does,
   * since interop 0.25.0 — is a control for the page the card points at, which
   * is where Peek offers it. Matched on the field, as `covered` is below: the
   * slot and the action name the same fact, whatever the manifest called it.
   */
  const actions = object.actions.filter(
    (action) =>
      action.field &&
      action.field !== object.slots.title?.field &&
      // Nor the move (FOL-4): its value is an address, and a text box asking
      // for `30840:<hex>:<uuid>` is not a control. The tree and the file's
      // menu offer it, picking from the team.
      action.field !== object.parentField &&
      /*
        Nor a prose value (MAN-4): Ship's `describe-issue` and
        `describe-project` declare `format: 'estiva-blocks-1'`, and this row's
        one-line box would replace a whole block-document description with a
        sentence. The body is its control instead — `prose`, below (MAN-9).
      */
      !action.format &&
      // Nor the archive (FOL-46): as a select it would archive the file and
      // everything under it in one click, with no count of what it hides and
      // no resolution. The file's own menu offers it, through its dialog.
      action.field !== ARCHIVED_FIELD,
  )

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

  /**
   * The action that sets the body as a block document, drawn as the body
   * itself (MAN-9) — Ship's `describe-issue` / `describe-project`.
   *
   * Chosen by the declaration, as every control here is: a `format` Peek
   * writes, on the field the body slot reads. A body on some other field is
   * not what that action sets, so it keeps its reading view. With no body slot
   * the editor stands where the body would only while the field is really
   * empty: interop drops an empty slot, and also one that reads elsewhere, and
   * an empty editor over a value it never showed would replace that value —
   * and every id in it — on the first save. Wherever the body is drawn: a
   * card, or the object's own page.
   */
  const prose =
    onAct && whole
      ? object.actions.find(
          (action) =>
            action.format === BLOCK_DOCUMENT_FORMAT &&
            !!action.field &&
            (slots.body ? slots.body.field === action.field : !action.current?.trim()),
        )
      : undefined

  return (
    <Card
      /*
       * The same surface a file attachment sits on (Katerina, 2026-08-19): the
       * package Card's `inset` fill with its subtle hairline. This card once
       * asked for `bg-surface-raised`, which is not a token this app defines,
       * so Tailwind emitted nothing and it rendered fully transparent. A soft
       * edge over the page reads thinner than the same edge over a fill.
       *
       * `inset` is what the attachment cards use, and a reference is the same
       * sort of thing: something attached to a message from elsewhere.
       */
      fill="inset"
      data-foreign-object={object.address}
      className={cn(widget === 'card' ? 'p-3' : 'px-3 py-2', className)}
    >
      {/*
       * Baselines, not box tops. The app name is 10px beside a 14px title, so
       * aligning their boxes sat it visibly above the title's line — the
       * smaller the type, the worse it looked (2026-08-19).
       *
       * The app's name shares the title's line and nothing below it: in a
       * column of its own it held an empty strip down the card's whole right
       * side, and a long description ran as a narrow column (Katerina,
       * 28 September).
       */}
      <div className="flex items-baseline gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* The title is the way into the owning app. A reference you cannot
              follow is a screenshot. */}
          {object.openUrl ? (
            <span className="contents text-body-2 font-semibold text-text-primary">
              <Link href={object.openUrl} variant="quiet" external truncate>
                {title}
              </Link>
            </span>
          ) : (
            // @estiva-escape(no-copied-look): C4 (Katerina, 24 September: record only): a 14px semibold title, a text style several panels share, not a copy of a part
            <span className="truncate text-body-2 font-semibold text-text-primary">
              {title}
            </span>
          )}
          {status && <StatusPill slot={status} />}
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
        {/* The package's small caps, not a hand-typed copy of them: this was
            `text-[10px] uppercase tracking-wide text-text-muted`, which is
            what `SectionLabel` already is (Katerina, 2026-09-11). */}
        {/* What it is, not which app made it ("Issue", not "Estiva Ship") —
            PRO-24. On its own page the panel's title already says it. */}
        {!page && objectLabel(object) && <SectionLabel className="shrink-0">{objectLabel(object)}</SectionLabel>}
      </div>
      {/* A card shows the subtitle; a row is a single line by definition —
          except on the object's own page, where it is the subject (MAN-9). */}
      {whole && slots.subtitle && (
        <p className="mt-1 text-caption text-text-secondary">{slots.subtitle.value}</p>
      )}
      {/* The description, in whichever content model its own app writes —
          PRO-2. Where the subtitle is, for its reason: a row in a message is a
          single line by definition and a body is not one. */}
      {prose && onAct ? (
        <div className="mt-1">
          <BlockDocumentField
            value={slots.body?.value ?? ''}
            format={slots.body?.format ?? 'marker'}
            label={prose.label}
            onCommit={async (value, contentFormat) => (await onAct(prose.id, value, contentFormat)) !== false}
          />
          {/* The refusal, where the write was made, when no action row is drawn to carry it. */}
          {error && !actions.length && <FieldLine tone="error" className="mt-1">{error}</FieldLine>}
        </div>
      ) : (
        whole && slots.body && <ForeignBody slot={slots.body} className="mt-1" />
      )}
      {visibleMeta.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {visibleMeta.map((slot, i) => (
            <Meta key={i} slot={slot} people={object.people} />
          ))}
        </div>
      )}

      {onAct && (
        <Actions
          actions={actions}
          people={object.people}
          directory={directory}
          busy={busy}
          error={error}
          onAct={onAct}
        />
      )}
    </Card>
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

/**
 * The card a message shows for an item from another app that it mentions, such
 * as an issue: its title, status and people, with controls to change it.
 */
export function ForeignObjectWidget({
  naddr,
  resolved,
  quiet = false,
  page = false,
}: {
  /** An `naddr`, an `nevent`, an address, or a pasted app URL (PRO-15). */
  naddr: string
  /** On the object's own page — `ForeignObjectCard`'s `page` (MAN-9). */
  page?: boolean
  /**
   * Draw nothing while resolving, for a reference that might not be one.
   * See the branch below.
   */
  quiet?: boolean
  /** The already-resolved object, for surfaces with no relay to ask (stories,
   *  tests). Skips resolution entirely; actions still render but cannot land. */
  resolved?: ForeignObject
}) {
  const { resolveObject: resolve, applyAction } = useForeignObjects()
  const directory = useWorkspaceDirectory()
  const [object, setObject] = useState<ForeignObject | null | 'loading'>(resolved ?? 'loading')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>()

  const reload = useCallback(
    // Returned, so an action's `await reload()` waits for the re-read it names.
    () => resolve(naddr).then(setObject).catch(() => setObject(null)),
    [naddr, resolve],
  )

  const onAct = useCallback(
    async (actionId: string, value: string, contentFormat?: string) => {
      setBusy(true)
      setActionError(undefined)
      try {
        const result = await applyAction({ naddr, actionId, value, ...(contentFormat ? { contentFormat } : {}) })
        // The relay is the authority on whether this happened, so re-read rather
        // than patching local state optimistically. Slower, and it means the
        // widget can never claim a change the shared record does not have.
        if (result.ok) await reload()
        else setActionError(result.reason)
        return result.ok
      } catch (e) {
        setActionError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [applyAction, naddr, reload],
  )

  useEffect(() => {
    // Already in hand — nothing to resolve (see `resolved` above). A newer one
    // from the page is taken, so an edit made elsewhere reaches the editor (MAN-9).
    if (resolved) {
      setObject(resolved)
      return
    }
    // Peek runs without a relay in tests, Storybook and checkouts with no
    // `VITE_RELAY_URL` (`hasRelay`). There is nothing to ask in that mode, so
    // resolve to nothing.
    if (!hasRelay) {
      setObject(null)
      return
    }
    let cancelled = false
    // One read over HTTP, so there is no live update — the widget reflects the
    // moment it was resolved. Good enough for a message attachment, and the
    // honest limitation to note rather than hide.
    // The token matters as much here as in `reload`: without it this reads as
    // the backend, which is a member of no channel, so the relay returns
    // nothing and the widget silently renders as if the reference were broken.
    resolve(naddr)
      .then((result) => !cancelled && setObject(result))
      .catch(() => !cancelled && setObject(null))
    return () => {
      cancelled = true
    }
  }, [naddr, resolve, resolved])

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
  /*
    `quiet` is for a reference that is only a *candidate*.

    An `naddr` in a message is certainly a reference, so a skeleton is right:
    the alternative is a message that settles at one height and then grows
    (FEE-3). A pasted URL is not — most links in most messages are just links,
    and RFC 0.5 §7.5 says one no manifest claims stays a plain link. Drawing a
    skeleton under every one of those and then removing it is the same flicker
    FEE-3 fixed, pointed the other way.
  */
  if (object === 'loading') return quiet ? null : <ForeignObjectSkeleton className="mt-1" />

  // A reference we cannot resolve degrades to nothing, leaving the message text
  // intact. Never break a message because an attachment failed.
  if (object === null) return null

  if (object.unreachable) {
    return (
      // A card that cannot be read: dashed, in both apps (Katerina, 2026-09-14).
      <Card fill="none" unreadable className="mt-1 px-3 py-2">
        <div className="text-caption text-text-secondary">
          {object.noun ? objectLabel(object) : `${object.appName ?? 'Another app'} object`} — you may not have access to
          this Folder.{' '}
          {object.openUrl && <OpenInApp object={object} />}
        </div>
      </Card>
    )
  }

  return (
    <ForeignObjectCard
      object={object}
      busy={busy}
      error={actionError}
      onAct={onAct}
      directory={directory}
      page={page}
      className="mt-1"
    />
  )
}
