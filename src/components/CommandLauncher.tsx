import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconSearch, IconChevronRight, IconX, IconPencil, IconMessage, IconUser, IconHash, IconMessageQuestion } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { MenuItem, SectionLabel } from '@estiva-app/ui'
import { ActionFormPanel } from './ActionFormPanel'
import { PeekLogoMark } from './ui/PeekLogo'
import { ShipLogoMark } from './ui/ShipLogo'
import { useForeignObjects, useMessageSearch, useTopics, usePeople, useWorkspaceDirectory } from '@/api'
import type { ResolvedAction } from '@estiva-app/interop'
import { matchPeople, matchTopics, messageEmptyState, snippetAround } from '@/lib/launcherSearch'
import { topicPath } from '@/lib/objectUrl'
import { canPrefill, promptForObject } from '@/lib/promptApi'
import { formSchema, prefillInstruction, threadContext, usablePrefill } from '@/lib/prefill'
import { PARENT_FIELD, changeActionFrom, changeVocabulariesFrom, launcherActionFrom, splitSubmission } from '@/lib/liveAction'
import { addrToNaddr } from '@estiva-app/protocol'
import type { LauncherContext } from '@/lib/launcherContext'
import { insertReferenceIntoActiveComposer } from '@/lib/composerRegistry'
import {
  LAUNCHER_APPS,
  type LauncherAction,
  type LauncherApp,
  type VocabOption,
} from '@/lib/launcherActions'

/**
 * The kind whose objects a Ship issue hangs under.
 *
 * A number rather than a name because NIP-89 discovery *is* by kind: the
 * launcher asks "what can be created under one of these?" and the manifest
 * answers. Naming Ship's project type here would be the launcher knowing what
 * Ship is, which is the thing the projection layer exists to avoid — every
 * other fact about the action comes off the manifest at runtime.
 */
const SHIP_PROJECT_KIND = 30850

/** One selectable row: what it renders and what selecting it does. */
interface Row {
  key: string
  render: (isHighlighted: boolean) => React.ReactNode
  onSelect: () => void
  /** Single line of text, no tile: 36px instead of the 48px two-line row. */
  compact?: boolean
}

interface CommandLauncherProps {
  /** Captured at the invoking keystroke/click - see lib/launcherContext. */
  context: LauncherContext
  onClose: () => void
  /** Open pre-drilled into an app (stories only). */
  initialAppId?: string
  /** Open with an action's form already up (stories only; needs initialAppId). */
  initialActionId?: string
}

/**
 * The global command launcher (Cmd/Ctrl+K anywhere, or click the top-bar
 * search field) — the Intelligence modal's human face. Three levels, one
 * input:
 *  - global: search-default row + drillable app rows (Ship, Peek)
 *  - app scope: a chip in the input; the app's declared actions
 *  - form: an object-creating action drawn as a form (ActionFormPanel)
 * Backspace on an empty input pops one level. Esc always closes. Not a chat:
 * one input, one result set, no history.
 *
 * The apps and actions come from `lib/launcherActions.ts`, which mirrors the
 * NIP-89 manifest action shape. Ship's own manifest now REPLACES the registry's
 * entries of the same id, so its form is drawn from what Ship actually
 * declares; the registry's remaining rows are proposals for manifests that do
 * not declare them yet, and stay inert. An agent filling the same forms from
 * context instead of by hand is PEE-5.
 *
 * The third-party mock apps that used to live here (Figma, Linear, GitHub,
 * Zendesk — and the Figma find mode) were removed 2026-08-31 with the design
 * decision to make the launcher list real Estiva apps only.
 */
export function CommandLauncher({
  context,
  onClose,
  initialAppId,
  initialActionId,
}: CommandLauncherProps) {
  const [scope, setScope] = useState<LauncherApp | null>(
    () => LAUNCHER_APPS.find((a) => a.id === initialAppId) ?? null,
  )
  const [formAction, setFormAction] = useState<LauncherAction | null>(() => {
    const app = LAUNCHER_APPS.find((a) => a.id === initialAppId)
    return app?.actions.find((a) => a.id === initialActionId) ?? null
  })
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [contextCleared, setContextCleared] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()

  // The effective context: the X on the context chip widens the launcher back
  // to the globally-capable action set without re-invoking it.
  const ctx: LauncherContext = contextCleared ? {} : context

  /*
   * Peek can list its own topics with no new machinery, so the `say` form's
   * parent picker is live even while everything else is v1 mock. Ship's
   * project list stays the registry's mock until the runtime can query
   * kind:30850 records.
   */
  const topics = useTopics()

  /*
    PEE-4's three corpora. Topics and people are already in the app and match
    on any fragment; messages are unbounded and live on the relay, which
    matches whole tokens only — measured, not assumed. `lib/launcherSearch`
    carries the reasoning and the empty-state wording that difference forces.
  */
  const people = usePeople()
  const directory = useWorkspaceDirectory()
  const navigate = useNavigate()
  const { state: messageState, hits: messageHits } = useMessageSearch(query)


  /*
    Ship's half is live now (PRO-4). `creatableUnder` reads the manifest Ship
    actually publishes and the projects a new issue could hang under, so the
    form is drawn from a declaration rather than from the registry's copy of
    one. `launcherActions.ts` set the bar: swapping the constant for a live read
    must not reshape any UI — and it does not, because the conversion in
    `lib/liveAction` produces the same shape `ActionFormPanel` already took.

    Null while loading, and null when signed out or when Ship declares nothing:
    the registry's entry stays in that case, which is the right degradation for
    a launcher whose rule is to list only what can succeed.
  */
  const { creatableUnder, applyAction, resolveObject } = useForeignObjects()

  /*
    PEE-3's targets: the objects this conversation already refers to, resolved
    for their titles and their declared field-setting actions. Captured at the
    invoking keystroke (`lib/conversationRegistry`), so the list is the thread
    the person was actually looking at.

    Resolution is per object and needs the relay, so it happens once when the
    launcher opens rather than per keystroke. A reference that will not resolve
    is dropped: the person may not be able to read it, and an action row for an
    object nobody can fetch is a row that cannot succeed.
  */
  const [targets, setTargets] = useState<{ address: string; label: string; actions: ResolvedAction[] }[]>([])
  const conversationRefs = context.conversation?.references
  useEffect(() => {
    if (!conversationRefs?.length) return
    let cancelled = false
    Promise.all(
      conversationRefs.map((ref) =>
        resolveObject(ref)
          .then((object) => {
            /*
              `naddr` is absent for a non-addressable object — a regular event
              like a Peek message has no `d` at all — and the runtime is
              explicit that *"a consumer that has no naddr correctly offers no
              actions"*. So those are dropped rather than offered: acting on
              one is addressed by naddr, and there would be nothing to send.
            */
            if (!object?.naddr) return null
            return {
              // The title is a declared SLOT, not a property of the object.
              // Falling back to the app's name beats an empty row label.
              address: object.naddr,
              label: object.slots?.title?.value ?? object.appName ?? 'Untitled',
              actions: object.actions ?? [],
            }
          })
          .catch(() => null),
      ),
    ).then((resolved) => {
      if (!cancelled) setTargets(resolved.filter((t): t is NonNullable<typeof t> => t !== null))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationRefs?.join('|')])

  /*
    One row per (object, field-setting action) pair, because both halves are
    chosen in the same gesture — "Set status · PEE-3" is the thing somebody
    means, and splitting it into two levels would make the launcher ask which
    object before it can say what it could do to it.
  */
  const changeRows = useMemo(() => {
    const out: { action: LauncherAction; vocabularies: Record<string, VocabOption[]> }[] = []
    for (const target of targets) {
      for (const resolved of target.actions) {
        const action = changeActionFrom(resolved, target)
        if (action) out.push({ action, vocabularies: changeVocabulariesFrom(resolved) })
      }
    }
    return out
  }, [targets])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [liveShip, setLiveShip] = useState<{
    actions: LauncherAction[]
    parents: VocabOption[]
  } | null>(null)
  /**
   * Where the live read has got to.
   *
   * `loading` is a state the launcher must show rather than paper over. The
   * read takes about a second and a half against production, and for that
   * second and a half the registry's declaration is the only one available —
   * so offering it means offering a form whose parent field the runtime will
   * refuse, which closes silently and looks like success. The launcher's own
   * rule is to list only what can succeed.
   */
  const [liveState, setLiveState] = useState<'idle' | 'loading' | 'ready' | 'none' | 'failed'>('idle')

  useEffect(() => {
    if (scope?.id !== 'ship') return
    let cancelled = false
    setLiveState('loading')
    creatableUnder(SHIP_PROJECT_KIND)
      .then((found) => {
        if (cancelled) return
        if (!found) {
          // Signed out, or the app declares nothing creatable. Not an error,
          // and not something to draw a mock in place of.
          setLiveState('none')
          return
        }
        const actions = found.actions
          .map((a) => launcherActionFrom(a, { parentNoun: 'project', submitLabel: a.label }))
          .filter((a): a is LauncherAction => a !== null)
        setLiveShip({
          actions,
          parents: found.parents.map((p) => ({ value: p.address, label: p.title })),
        })
        setLiveState('ready')
      })
      .catch((error: unknown) => {
        /*
          Every other caller of this hook catches, classifies and logs; this one
          did not, and that is why a failure here took a screenshot and an hour
          to find rather than saying so. A read that fails must produce a
          sentence, not silence.
        */
        if (cancelled) return
        console.warn('[nostr] reading another app’s creatable actions failed:', error)
        setLiveState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [scope, creatableUnder])

  /*
    The live declaration REPLACES the registry's of the same id.

    This is the step that was missing, and the failure was quiet in the worst
    way: the rows still came from the registry, so Ship's create-issue form
    drew the mock's fields — three invented projects, a status and an assignee
    Ship's manifest does not declare — while `submitAction` matched on the id,
    found no `__parent` (the mock names that field `project`), and closed
    without publishing. It looked like it worked.

    Proposals for actions no manifest declares are left in place. They were
    inert before this and remain so; removing them would take away the design's
    own record of what a manifest should grow.
  */
  const scopeActions = useMemo<LauncherAction[]>(() => {
    if (!scope) return []
    if (scope.id !== 'ship') return scope.actions
    /*
      While the manifest is still in flight, offer none of Ship's registry
      entries — not even the ones the manifest will not replace. Which of them
      it replaces is not known until it arrives, so showing any is showing a
      declaration that may be about to be contradicted.
    */
    // No live declaration, for any reason — still loading, refused, or the app
    // offers nothing. In every one of those the registry's entry is a mock, and
    // a mock here is a form whose submission the runtime refuses and which
    // therefore closes saying nothing. None is better than that.
    if (!liveShip) return []
    const live = new Map(liveShip.actions.map((a) => [a.id, a]))
    return [...liveShip.actions, ...scope.actions.filter((a) => !live.has(a.id))]
  }, [scope, liveShip, liveState])

  const liveParents = useMemo<Record<string, VocabOption[]>>(() => {
    const out: Record<string, VocabOption[]> = {}
    if (scope?.id === 'peek') {
      out.topic = (topics ?? [])
        .filter((t) => !t.isResolved)
        .map((t) => ({ value: t.id, label: t.title }))
    }
    if (scope?.id === 'ship' && liveShip) out[PARENT_FIELD] = liveShip.parents
    return out
  }, [scope, topics, liveShip])

  const enterScope = (app: LauncherApp) => {
    setScope(app)
    setFormAction(null)
    setQuery('')
  }
  const enterForm = (action: LauncherAction) => {
    setFormAction(action)
    setQuery('')
  }

  /*
    PEE-5 — the form arrives filled in from the conversation, where the machine
    to do it is already on the person's own device.

    Nothing here is offered, announced or waited for (PEE-6). The form opens
    immediately and this either lands values in it or does not; a person on a
    phone, in Safari, or on a desktop that has never downloaded the model sees
    exactly the form they saw before this ticket, with no sparkle greyed out
    and no apology. `canPrefill` reports 'downloadable' as unavailable, so
    opening a form never starts a multi-gigabyte fetch.
  */
  /*
    INT-2 — asking about the open conversation instead of searching it.

    A third level beside `scope` and `formAction`, holding the question rather
    than an app or an action. **No model is called here.** This ticket is the
    surface only: the gesture, the chip, and where an answer will go. INT-3
    fills it.
  */
  const [asking, setAsking] = useState<string | null>(null)

  /*
    Whether a model could answer at all, resolved once per open.

    The launcher's own rule is that an action appears only where it can succeed,
    so the row is absent rather than disabled where nothing can run — Edge 154
    gates generative execution outright, and a row that always fails there is
    worse than no row. This is also why the check is not `availability()`
    directly: `canPrefill` refuses only the answers that would start a download.
  */
  const [modelReady, setModelReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void canPrefill().then((ready) => !cancelled && setModelReady(ready))
    return () => {
      cancelled = true
    }
  }, [])

  const [prefill, setPrefill] = useState<Record<string, string> | undefined>()
  useEffect(() => {
    setPrefill(undefined)
    // A change acts on an object that already exists; there is nothing to
    // suggest. Only a creation has empty fields worth filling.
    if (!formAction || formAction.target) return
    const conversation = threadContext(context.conversation?.messages ?? [])
    if (!conversation) return
    const built = formSchema(formAction.fields, scope ? scope.vocabularies : {})
    if (!built) return
    let cancelled = false
    void (async () => {
      if (!(await canPrefill())) return
      const answer = await promptForObject(prefillInstruction(formAction.label, conversation), built.schema)
      if (cancelled) return
      const usable = usablePrefill(answer, built.keys)
      // An empty answer is left as undefined rather than as `{}`, so the form's
      // prefill effect has nothing to react to.
      if (Object.keys(usable).length) setPrefill(usable)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formAction, scope, context.conversation?.messages?.join('\u0000')])
  const popLevel = () => {
    /*
      Leaving Ask keeps what was typed. The text is sovereign in this design
      (INT-2): changing how a sentence is interpreted must never cost somebody
      the sentence, in either direction.
    */
    if (asking !== null) {
      setAsking(null)
      return
    }
    if (formAction) setFormAction(null)
    else if (scope) setScope(null)
    setQuery('')
  }

  /**
   * A validated form arrives here as `{ fieldKey: value }` plus the
   * manifest-shaped action that produced it. `applyAction` turns it into the
   * event the declaration's `emits` describes, signs and publishes it (PEE-1),
   * and the new object's `nostr:naddr…` reference goes into the active
   * composer so the reply renders it as a widget (PEE-2).
   */
  const submitAction = async (action: LauncherAction, values: Record<string, string>) => {
    /*
      Only Ship's live actions publish. Everything else in the registry is a
      proposal for a manifest that does not declare it yet, and publishing a
      guess at another app's object is exactly what the honour system forbids —
      so those still close, as they always did.
    */
    /*
      Two shapes, and they are not interchangeable (PEE-3).

      A CHANGE carries a target chosen when the row was, and the runtime takes
      a scalar for it — `applyActionAsViewer` branches on exactly that: a
      string is a change, a property bag is a creation with a parent. It is
      also already known to be declared, because the action came off the
      object's own resolved manifest rather than off the registry, so the
      liveShip check below does not apply to it.
    */
    if (action.target) {
      const value = values[action.fields[0]?.key ?? '']
      if (!value) {
        onClose()
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      const result = await applyAction({ naddr: action.target, actionId: action.id, value })
      setSubmitting(false)
      if (!result.ok) {
        setSubmitError(result.reason ?? 'The relay rejected the change.')
        return
      }
      // Nothing to leave in the thread: the object was already referenced
      // there, which is how it came to be a target at all.
      onClose()
      return
    }

    const live = liveShip?.actions.some((a) => a.id === action.id)
    const { parent, properties } = splitSubmission(values)
    if (!live || !parent) {
      onClose()
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    /*
      Wrapped because the caller is `void submitAction(…)`, so anything thrown
      here goes nowhere at all — the form would simply sit there. `addrToNaddr`
      throws on an author that is not 32 bytes, which is exactly the sort of
      thing a bad parent list would produce.
    */
    let result: Awaited<ReturnType<typeof applyAction>>
    try {
      // The parent is addressed, not named: `applyAction` resolves the manifest
      // from the object being acted on, which keeps this ignorant of Ship.
      result = await applyAction({
        naddr: addrToNaddr(parent, []),
        actionId: action.id,
        value: properties,
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error instanceof Error ? error.message : String(error))
      return
    }
    setSubmitting(false)
    if (!result.ok) {
      // The runtime's own words — "title is required", "urgent is not one of
      // …" — rather than a generic failure. It is the only participant that
      // knows what the manifest allowed.
      setSubmitError(result.reason ?? 'The relay rejected it.')
      return
    }
    /*
      The trace, which is the half that changes behaviour (PEE-2).

      > Katerina, 2026-08-19 — *"Now I have no clue this whole conversation has
      > an issue assigned, as I have to open the thread first."*

      The address comes off the runtime rather than being recomposed here, and
      only a creation returns one — a change is a statement about an object
      that already had an address, so there is nothing new to point at.
    */
    if (result.created) {
      let placed: boolean
      try {
        placed = insertReferenceIntoActiveComposer(addrToNaddr(result.created, []))
      } catch (error) {
        /*
          The object WAS created, so "failed" would be a lie about the half
          that worked. Only a malformed address out of the runtime reaches
          here, which is a bug rather than anything a person did.
        */
        setSubmitError(
          `Created, but its reference could not be encoded: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
      /*
        No composer is usually legitimate — the launcher is global, so creating
        an object with nothing open is a normal thing to do and there is simply
        nowhere to leave a reference. But the context captured at the invoking
        keystroke says whether a conversation surface WAS open, and if it was,
        this is the trace going missing rather than being unnecessary.
      */
      if (!placed && context.composer) {
        setSubmitError('Created, but its reference could not be placed — the composer is gone.')
        return
      }
    }
    onClose()
  }

  const appIcon = (app: LauncherApp, size = 14) =>
    app.id === 'peek' ? <PeekLogoMark height={size} /> : <ShipLogoMark height={size} />

  /**
   * The app's tile: its mark, small, on a wash of its own brand colour —
   * minimal and discreet (Katerina 2026-08-31). Peek's is the accent-muted
   * badge the app already uses; Ship has no token here, so its wash and
   * letter come from `estiva-ui/tokens.css` `[data-theme='ship']`
   * (--accent-primary #4b58d4 / --accent-hover #5c69dc), stated inline
   * because Peek's palette deliberately does not carry another app's brand.
   */
  const appTile = (app: LauncherApp) => (
    <div
      className={cn(
        'flex items-center justify-center size-8 rounded-sm shrink-0',
        app.id === 'peek' ? 'bg-accent-muted' : 'bg-[rgba(75,88,212,0.14)]',
      )}
    >
      {app.id === 'peek' ? (
        <PeekLogoMark height={14} />
      ) : (
        <ShipLogoMark height={14} className="text-[#5c69dc]" />
      )}
    </div>
  )

  // The launcher keeps its own, caption-sized hint — its shipped look
  // (restored 2026-09-01; the shared EnterHint is the pickers' 9px voice).
  const enterHint = (
    <span className="text-caption text-text-secondary whitespace-nowrap shrink-0 signal:font-mono signal:text-[10px] signal:tracking-[0.04em]">↩ Enter</span>
  )

  /** The `esc` badge's styling, reused for every shortcut the footer names. */
  const keyBadge = (label: string) => (
    <span className="flex items-center justify-center px-1 py-px rounded-sm bg-bg-inset border border-border-strong signal:bg-[rgba(255,255,255,0.05)] signal:border-border-default signal:border-b-2 signal:rounded">
      <span className="text-caption text-text-secondary whitespace-nowrap signal:font-mono signal:text-[10px]">{label}</span>
    </span>
  )

  const iconTile = (content: React.ReactNode) => (
    <div className="flex items-center justify-center size-8 rounded-sm bg-bg-inset shrink-0">{content}</div>
  )

  const sectionHeader = (label: string) => (
    <div key={`hdr-${label}`} className="flex items-center h-7 px-3">
      <SectionLabel className="text-text-secondary">{label}</SectionLabel>
    </div>
  )

  // ── Assemble the rows for the current level ──

  const { rows, headers } = useMemo(() => {
    const rows: Row[] = []
    // headers[i] renders BEFORE row index i
    const headers = new Map<number, React.ReactNode>()

    const simpleRow = (
      key: string,
      icon: React.ReactNode | null,
      title: React.ReactNode,
      subtitle: string | undefined,
      onSelect: () => void,
      trailing?: React.ReactNode
    ): Row => ({
      key,
      onSelect,
      render: (isHl) => (
        <>
          {icon != null && iconTile(icon)}
          <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
            <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{title}</div>
            {subtitle && <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{subtitle}</div>}
          </div>
          {isHl ? enterHint : trailing}
        </>
      ),
    })

    // The form step renders ActionFormPanel instead of rows.
    if (formAction) return { rows, headers }
    // Asking replaces the list with the answer panel, so there are no rows.
    if (asking !== null) return { rows, headers }

    if (scope) {
      const actions = q
        ? scopeActions.filter((a) => a.label.toLowerCase().includes(q))
        : scopeActions
      /*
        Say what is happening rather than showing an empty section. A blank
        list reads as "this app offers nothing", which is a different and wrong
        statement — and the one thing worse than a slow answer is a confident
        wrong one.
      */
      const liveNote =
        scope.id !== 'ship' || actions.length > 0
          ? null
          : liveState === 'failed'
            ? `Could not read ${scope.label}’s manifest — its actions are unavailable.`
            : liveState === 'none'
              ? `${scope.label} offers nothing to create here.`
              : `Reading ${scope.label}’s manifest…`
      if (liveNote) {
        headers.set(0, sectionHeader(`${scope.label} actions`))
        rows.push({
          key: 'live-note',
          compact: true,
          onSelect: () => {},
          render: () => (
            <div className="px-3 py-2 text-[13px] leading-[1.2] text-text-secondary">{liveNote}</div>
          ),
        })
        return { rows, headers }
      }
      if (actions.length > 0) headers.set(0, sectionHeader(`${scope.label} actions`))
      for (const action of actions) {
        // No tile and no app name: the scope chip above already says both
        // (Katerina 2026-08-31 — they were redundant on every row).
        rows.push({ ...simpleRow(action.id, null, action.label, undefined, () => enterForm(action)), compact: true })
      }
      return { rows, headers }
    }

    // ── Global level ──
    /*
      INT-2 — interpret what was typed as a question about this conversation.

      Above the results and above the actions, because it is what a person
      typing a sentence rather than a term is most likely to have meant. It
      appears only with something typed, only with a conversation open (there
      is nothing to ask about otherwise), and only where a model could answer.
    */
    if (q && context.conversation?.messages?.length && modelReady) {
      headers.set(rows.length, sectionHeader('Ask'))
      rows.push({
        ...simpleRow(
          'ask',
          <IconMessageQuestion size={16} stroke={1.5} className="text-text-secondary" />,
          <>
            Ask about this conversation: "<span className="font-medium">{query.trim()}</span>"
          </>,
          undefined,
          () => {
            // The query is deliberately NOT cleared — see popLevel.
            setAsking(query.trim())
          },
        ),
        compact: true,
      })
    }

    /*
      PEE-3 — changing an object the thread already refers to. Above the
      found things, because these are actions rather than results: they
      change the shared record, and burying them under search results would
      put the destructive half of the launcher last.
    */
    const changeHits = q
      ? changeRows.filter(
          ({ action }) =>
            action.label.toLowerCase().includes(q) || (action.targetLabel ?? '').toLowerCase().includes(q),
        )
      : changeRows
    if (changeHits.length > 0) headers.set(rows.length, sectionHeader('In this conversation'))
    for (const { action } of changeHits) {
      rows.push({
        ...simpleRow(
          `change-${action.target}-${action.id}`,
          <IconPencil size={16} stroke={1.5} className="text-text-secondary" />,
          action.label,
          action.targetLabel,
          () => enterForm(action),
        ),
        compact: true,
      })
    }


    /*
      Finding things, which used to be one inert row reading "Search Peek for
      …" (PEE-4). The launcher is the one surface where "do a thing" and "find
      a thing" are the same gesture, so results sit above the apps rather than
      behind a separate mode.
    */
    if (q) {
      const go = (path: string) => () => {
        navigate(path)
        onClose()
      }

      const topicHits = matchTopics(topics ?? [], query)
      if (topicHits.length > 0) {
        headers.set(rows.length, sectionHeader('Topics'))
        for (const t of topicHits) {
          rows.push({
            ...simpleRow(
              `topic-${t.id}`,
              <IconHash size={16} stroke={1.5} className="text-text-secondary" />,
              t.title,
              t.isResolved ? 'Resolved' : undefined,
              go(topicPath(t)),
            ),
            compact: true,
          })
        }
      }

      const peopleHits = matchPeople(people ?? [], query)
      if (peopleHits.length > 0) {
        headers.set(rows.length, sectionHeader('People'))
        for (const person of peopleHits) {
          rows.push({
            ...simpleRow(
              `person-${person.id}`,
              <IconUser size={16} stroke={1.5} className="text-text-secondary" />,
              person.name,
              person.role,
              go(`/people/${encodeURIComponent(person.id)}`),
            ),
            compact: true,
          })
        }
      }

      /*
        A message names its Folder on the `h` tag, and a Topic carries the same
        uuid as `folderId` — so that is the join, and it is also the reason a
        hit can be unroutable: a message in a channel this person has no topic
        row for has nowhere to go. Those are dropped rather than rendered as a
        row that cannot succeed, and the count of what was dropped is shown,
        because a silent cap reads as "that is all there was".
      */
      const byFolder = new Map((topics ?? []).filter((t) => t.folderId).map((t) => [t.folderId as string, t]))
      const routable = messageHits.filter((h) => h.folder && byFolder.has(h.folder))
      const unroutable = messageHits.length - routable.length
      const emptyNote = messageEmptyState(messageState, query)

      if (routable.length > 0 || emptyNote || unroutable > 0) {
        headers.set(rows.length, sectionHeader('Messages'))
      }
      for (const hit of routable) {
        const topic = byFolder.get(hit.folder as string)!
        const who = directory?.[hit.pubkey]?.displayName
        rows.push({
          ...simpleRow(
            `message-${hit.id}`,
            <IconMessage size={16} stroke={1.5} className="text-text-secondary" />,
            // The match in context, not the first 80 characters — a hit whose
            // term is late in a long message would otherwise show none of it.
            snippetAround(hit.content, query.trim()),
            [who, topic.title].filter(Boolean).join(' · '),
            go(topicPath(topic)),
          ),
          compact: true,
        })
      }
      /*
        Said rather than shown as rows: the honest empty state PEE-4's done-when
        asks for, which has to tell "nothing matched" from "nothing you can
        read". `messageEmptyState` owns the wording; this only has to render it.
      */
      const notes = [
        emptyNote,
        unroutable > 0
          ? `${unroutable} more in conversations not in your sidebar.`
          : null,
      ].filter(Boolean) as string[]
      for (const [i, note] of notes.entries()) {
        rows.push({
          key: `message-note-${i}`,
          compact: true,
          onSelect: () => {},
          render: () => (
            <div className="px-3 py-2 text-[13px] leading-[1.2] text-text-secondary">{note}</div>
          ),
        })
      }
    }

    const apps = q
      ? LAUNCHER_APPS.filter((a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      : LAUNCHER_APPS
    if (apps.length > 0) headers.set(rows.length, sectionHeader('Apps'))
    for (const a of apps) {
      rows.push({
        key: a.id,
        onSelect: () => enterScope(a),
        render: (isHl) => (
          <>
            {appTile(a)}
            <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
              <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{a.label}</div>
              <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{`${a.description} · ${a.actions.length} actions`}</div>
            </div>
            {isHl ? enterHint : <IconChevronRight size={16} stroke={1.5} className="text-text-secondary shrink-0" />}
          </>
        ),
      })
    }
    return { rows, headers }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, scope, scopeActions, liveState, formAction, contextCleared, topics, people, directory, messageState, messageHits, navigate, changeRows, modelReady, context.conversation?.messages?.length])

  // Reset the highlight on every level/query change.
  const didInitHighlight = useRef(false)
  useEffect(() => {
    if (!didInitHighlight.current) {
      didInitHighlight.current = true
      return
    }
    setHighlight(0)
  }, [query, scope, formAction])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-highlighted="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // A child that consumed the key keeps it: an open Select preventDefaults
    // its own Escape, and that press must close the menu, not pop the level.
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // Escape ONLY closes; Backspace is the way back (Katerina 2026-08-31 —
      // two meanings on one key was a duplicate command).
      onClose()
      return
    }
    if (formAction) {
      /*
       * The form owns its keyboard, with one exception: Backspace with
       * nothing to delete steps back to the action list — the same gesture
       * the list levels use. A field that consumed it (text being edited,
       * a chip being removed) preventDefaults and never reaches here.
       */
      if (e.key === 'Backspace') {
        const t = e.target as HTMLElement
        const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        if (!editable || (t as HTMLInputElement | HTMLTextAreaElement).value === '') {
          e.preventDefault()
          popLevel()
        }
      }
      return
    }
    if (e.key === 'Backspace' && query === '' && (scope || asking !== null)) {
      e.preventDefault()
      popLevel()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, rows.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    // Tab or ArrowRight on an app row scopes into it (drill-in)
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && !scope) {
      const row = rows[highlight]
      const app = LAUNCHER_APPS.find((a) => a.id === row?.key)
      if (app) {
        e.preventDefault()
        enterScope(app)
        return
      }
      if (e.key === 'Tab') e.preventDefault()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      rows[highlight]?.onSelect()
    }
  }

  const placeholder = scope ? scope.placeholder : 'Search Peek or choose an action...'

  // The chip names the level: "Ship" while listing, "Ship · Create issue"
  // in the form.
  const chipLabel = formAction
    ? // A targeted change names the OBJECT, not an app scope it was not reached through.
      `${formAction.targetLabel ?? scope?.label} · ${formAction.label}`
    : scope?.label

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Launcher - anchored high like a launcher, not centered like a dialog */}
      <div className="fixed inset-x-0 top-[18%] z-50 flex justify-center pointer-events-none">
        <div
          className="w-[658px] bg-bg-elevated border border-border-default rounded-lg shadow-lg pointer-events-auto flex flex-col overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Input row */}
          <div className="flex items-center gap-3 h-12 px-4 border-b border-border-subtle shrink-0">
            <IconSearch size={16} stroke={1.5} className="text-text-secondary shrink-0" />

            {/* Scope chip - the state made visible. Click the X (or Backspace on
                an empty input) to pop one level back out. */}
            {/* Ask chip — deliberately its own, not the scope chip's shape with
                an app icon in it. Ask is a mode, and drawing it beside Ship and
                Peek would read as a third application that does not exist. */}
            {asking !== null && (
              <div className="inline-flex items-center gap-1.5 bg-accent-muted border border-border-default rounded-full pl-2 pr-1 py-0.5 max-h-[24px] shrink-0">
                <IconMessageQuestion size={10} stroke={1.5} className="text-text-secondary" />
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary whitespace-nowrap max-w-[220px] truncate">
                  {asking}
                </span>
                <button
                  type="button"
                  onClick={popLevel}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary"
                  aria-label="Leave Ask"
                >
                  <IconX size={10} stroke={1.5} />
                </button>
              </div>
            )}

            {scope && (
              <div className="inline-flex items-center gap-1.5 bg-bg-inset border border-border-default rounded-full pl-2 pr-1 py-0.5 max-h-[24px] shrink-0">
                {appIcon(scope, 10)}
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary whitespace-nowrap">
                  {chipLabel}
                </span>
                <button
                  type="button"
                  onClick={popLevel}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary"
                  aria-label={formAction ? `Leave ${formAction.label}` : `Leave ${scope.label}`}
                >
                  <IconX size={10} stroke={1.5} />
                </button>
              </div>
            )}

            {/* Context chip - what the launcher is acting on (the composer
                target an insert would land in). X widens back to the
                globally-capable set. Kept in form mode on purpose: it is where
                the created object's reference will land (see submitAction). */}
            {!contextCleared && ctx.composer && (
              <div className="inline-flex items-center gap-1.5 bg-bg-inset border border-border-default rounded-full pl-1.5 pr-1 py-0.5 max-h-[24px] max-w-[220px] shrink-0">
                <IconPencil size={12} stroke={1.5} className="text-text-secondary shrink-0" />
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary truncate">
                  {ctx.composer?.label ?? 'Compose box'}
                </span>
                <button
                  type="button"
                  onClick={() => setContextCleared(true)}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary shrink-0"
                  aria-label="Clear context"
                >
                  <IconX size={10} stroke={1.5} />
                </button>
              </div>
            )}

            {/* A form is not searched: the input yields to the chips there. */}
            {formAction ? (
              <div className="flex-1" />
            ) : (
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent text-input-value text-text-primary placeholder:text-text-muted outline-none"
              />
            )}
          </div>

          {/* Body: the answer panel while asking, the action's form in form
              mode, rows otherwise */}
          {asking !== null ? (
            /*
              INT-2 ships this surface empty on purpose. The gesture, the chip
              and the place an answer goes can all be judged before a single
              prompt exists — which is the whole point of splitting the model
              out of this ticket. INT-3 replaces the placeholder with a
              retrieved-and-cited answer.
            */
            <div className="px-4 py-6 flex flex-col gap-2" data-surface="ask">
              <p className="text-[14px] leading-[1.4] text-text-primary">{asking}</p>
              <p className="text-[13px] leading-[1.4] text-text-secondary">
                Answering is not built yet. Leave Ask to go back to searching — what you typed is still there.
              </p>
            </div>
          ) : formAction && (scope || formAction.target) ? (
            <div>
              <ActionFormPanel
                app={scope ?? undefined}
                action={formAction}
                parentOptions={liveParents}
                /* A change's vocabulary comes off the resolved action, not off
                   an app scope there is none of here (PEE-3). */
                vocabularies={
                  formAction.target
                    ? changeRows.find((r) => r.action.target === formAction.target && r.action.id === formAction.id)
                        ?.vocabularies
                    : undefined
                }
                prefill={prefill}
                onSubmit={(values) => void submitAction(formAction, values)}
              />
              {/* The runtime's own words — "title is required by Add issue",
                  "urgent is not one of todo, …". It is the only participant
                  that knows what the manifest allowed, and a generic failure
                  here would throw that away. */}
              {submitError && (
                <p role="alert" className="px-4 pb-3 -mt-1 text-[12px] leading-[1.4] text-error-default">
                  {submitError}
                </p>
              )}
              {submitting && (
                <p className="px-4 pb-3 -mt-1 text-[12px] leading-[1.4] text-text-secondary">Creating…</p>
              )}
            </div>
          ) : (
          <div ref={listRef} className="max-h-[400px] overflow-y-auto p-1">
            {rows.map((row, i) => (
              <div key={row.key}>
                {headers.get(i)}
                <MenuItem
                  data-highlighted={highlight === i}
                  size={row.compact ? 'default' : 'tall'}
                  // The launcher keeps its shipped geometry exactly: 36px compact
                  // rows, 48px full rows (Katerina, 2026-09-01 — the rows shrank in
                  // the first conversion, and she caught it).
                  className={row.compact ? 'h-9 gap-3 px-3' : 'min-h-12'}
                  selected={highlight === i}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    row.onSelect()
                  }}
                >
                  {row.render(highlight === i)}
                </MenuItem>
              </div>
            ))}
            {rows.length === 0 && headers.get(0)}
            {rows.length === 0 && !headers.get(0) && (
              <div className="flex items-center h-12 px-3">
                <span className="text-[14px] text-text-secondary">Nothing for that here.</span>
              </div>
            )}
          </div>
          )}

          {/* The footer carries the shortcuts in every theme — the input row
              stopped duplicating esc (Katerina 2026-08-31). */}
          <div className="flex items-center gap-4 h-9 px-4 border-t border-border-subtle shrink-0 select-none text-caption text-text-secondary signal:font-mono signal:text-[10px] signal:text-text-muted">
            {formAction ? (
              <>
                <span className="flex items-center gap-1.5">
                  {keyBadge('⌘ ↩')} {formAction.submitLabel.toLowerCase()}
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('⌫')} back</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  {keyBadge('↑')}
                  {keyBadge('↓')} navigate
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('↩')} open</span>
              </>
            )}
            <span className="flex items-center gap-1.5">{keyBadge('esc')} close</span>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
