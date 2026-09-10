import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Kbd } from '@estiva-app/ui'
import { shortcutLabel } from '@/lib/shortcuts'
import { createPortal } from 'react-dom'
import { IconSearch, IconChevronRight, IconX, IconPencil, IconMessage, IconUser, IconHash, IconMessageQuestion, IconWriting, IconSparkles, IconDownload } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { EnterHint, MenuItem } from '@estiva-app/ui'
import { Button } from '@/components/ui/Button'
import { SectionLabel } from '@/components/ui/SectionHeader'
import { ActionFormPanel } from './ActionFormPanel'
import { PeekLogoMark } from './ui/PeekLogo'
import { ShipLogoMark } from './ui/ShipLogo'
import { useForeignObjects, useMessageSearch, useTopics, usePeople, useWorkspaceDirectory } from '@/api'
import type { ResolvedAction } from '@estiva-app/interop'
import { matchPeople, matchTopics, messageEmptyState, snippetAround } from '@/lib/launcherSearch'
import { topicPath } from '@/lib/objectUrl'
import { canPrefill, downloadModel, prefillAvailability, promptForObject, promptForText, type PrefillAvailability } from '@/lib/promptApi'
import {
  PROPOSAL_SCHEMA,
  isProposable,
  probeable,
  proposalInstruction,
  readProposal,
  type CatalogueEntry,
  type Proposal,
} from '@/lib/actionCatalogue'
import { draftInstruction, formSchema, prefillInstruction, threadContext, usablePrefill } from '@/lib/prefill'
import { answerInstruction, parseAnswer, selectMessages, type NumberedMessage } from '@/lib/askThread'
import { scrollToMessage, scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { openConversation } from '@/lib/threadOpener'
import { PARENT_FIELD, changeActionFrom, changeVocabulariesFrom, launcherActionFrom, splitSubmission, vocabulariesFrom } from '@/lib/liveAction'
import { addrToNaddr } from '@estiva-app/protocol'
import type { LauncherContext } from '@/lib/launcherContext'
import { insertReferenceIntoActiveComposer, insertTextIntoActiveComposer } from '@/lib/composerRegistry'
import { bodies } from '@/lib/conversationRegistry'
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

/** One selectable row: what it renders and what selecting it does. */
interface Row {
  key: string
  render: () => React.ReactNode
  onSelect: () => void
  /** The row's resting right edge — a chevron, a value. The "↩ Enter" hint is
   *  not here: it is MenuItem's `hint` slot, revealed by the row's own hover
   *  so it can never come apart from the highlight. */
  trailing?: React.ReactNode
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
 * The apps come from `lib/launcherActions.ts`; **the actions come from the
 * apps' own manifests, read at open time**. The registry's action declarations
 * are drawn by Storybook and are never offered here — a row a person can
 * select is a promise, and the registry's are proposals for manifests that do
 * not declare them yet (INT-9). An agent filling the same forms from context
 * instead of by hand is PEE-5.
 *
 * The third-party mock apps that used to live here (Figma, Linear, GitHub,
 * Zendesk — and the Figma find mode) were removed 2026-08-31 with the design
 * decision to make the launcher list real Estiva apps only.
 */
/**
 * An answer and the messages it is allowed to have come from (INT-3).
 *
 * `sources` is a subset of what retrieval chose, never a superset — see where
 * it is built. Nothing here is persisted, deliberately: the answer is shown and
 * forgotten. "Save this answer" is the obvious next request and is exactly what
 * the roadmap holds back, because `kind:9802` is append-only and a shape
 * settled while the model is unsettled is permanent.
 */
interface AskAnswer {
  text: string
  sources: NumberedMessage[]
  /** Nothing in the question matched, so recency chose the messages. */
  byRecency: boolean
  /** Messages the context budget could not take. */
  omitted: number
  /**
   * Replies the snapshot never held (INT-8). Zero for a thread, which has all
   * of its own; usually large for a topic, which has none of them.
   */
  repliesNotRead: number
}

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
  /*
    The catalogue entry a form came from when it was not reached by scoping
    into an app (INT-5).

    A proposal opens another app's form directly, so its vocabularies and its
    parent list have to travel with it — there is no scope to read them off,
    and a form drawn without either is one the runtime refuses, which closes
    silently and looks like success (PEE-1).
  */
  const [formEntry, setFormEntry] = useState<CatalogueEntry | null>(null)
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
    // Whatever the app says to query, rather than a number this file knows
    // (INT-5). An app that declares no parent kind is simply not probed.
    if (!scope?.parentKind) return
    let cancelled = false
    setLiveState('loading')
    creatableUnder(scope.parentKind)
      .then((found) => {
        if (cancelled) return
        if (!found) {
          // Signed out, or the app declares nothing creatable. Not an error,
          // and not something to draw a mock in place of.
          setLiveState('none')
          return
        }
        const actions = found.actions
          // The app's own noun, not a literal `'project'` — a person starting a
          // conversation was being asked to choose a Project (INT-9).
          .map((a) => launcherActionFrom(a, { parentNoun: scope.parentNoun, submitLabel: a.label }))
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
    Only what an app actually declares — INT-9.

    The rule this file already kept for Ship's *replaced* rows now covers every
    row: a launcher entry exists because some manifest, read just now, says the
    action exists. The registry contributes the app, its parent kind and the
    labels; it no longer contributes an action.

    **Before this, three of the four create rows published nothing.** Ship
    declares no `add-project` and Peek declares no actions at all, so Create
    project, Create topic and Start a conversation each opened a form,
    validated it, and closed on submit — `submitAction`'s `!live` branch,
    reached in silence. Miky hit all three in a row on 2026-09-04 and read it,
    correctly, as the app being broken.

    Keeping them as proposals was the earlier call, on the argument that they
    are the design's record of what a manifest should grow. That record is
    worth having and the launcher is the wrong place for it: a row a person can
    select is a promise. The declarations stay in `launcherActions.ts`, where
    Storybook draws them and nothing publishes them, until PRO-18 lets Ship and
    Peek declare them for real.

    So the empty case is now normal rather than exceptional, and the section
    note below is what says why — see `liveNote`, which had to grow past Ship
    for exactly that reason.
  */
  const scopeActions = useMemo<LauncherAction[]>(() => {
    if (!scope) return []
    // An app with no parent kind is never probed (see the effect above), so
    // nothing about it is live and there is nothing honest to offer.
    if (!scope.parentKind) return []
    // No live declaration, for any reason — still loading, refused, or the app
    // offers nothing. In every one of those the registry's entry is a mock, and
    // a mock here is a form whose submission the runtime refuses and which
    // therefore closes saying nothing. None is better than that.
    if (!liveShip) return []
    return liveShip.actions
  }, [scope, liveShip])

  const liveParents = useMemo<Record<string, VocabOption[]>>(() => {
    const out: Record<string, VocabOption[]> = {}
    if (scope?.id === 'peek') {
      out.topic = (topics ?? [])
        .filter((t) => !t.isResolved)
        .map((t) => ({ value: t.id, label: t.title }))
    }
    if (scope?.parentKind && liveShip) out[PARENT_FIELD] = liveShip.parents
    // Same list, carried on the entry: a proposal opens the form without
    // scoping in, and a parent field with no options is a form the runtime
    // refuses — which closes silently and looks like success (PEE-1).
    if (!scope && formEntry) out[PARENT_FIELD] = formEntry.parents
    return out
  }, [scope, topics, liveShip, formEntry])

  const enterScope = (app: LauncherApp) => {
    setScope(app)
    setFormAction(null)
    setFormEntry(null)
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
  const [asking, setAsking] = useState<{ request: string; intent: 'ask' | 'draft' | 'propose' } | null>(null)

  /*
    INT-4 — the draft itself. `null` while it is being written, so the panel can
    say it is working rather than looking empty; `false` once the model has been
    asked and produced nothing.
  */
  const [draft, setDraft] = useState<string | null | false>(null)

  /*
    INT-3 — the answer, and the messages it is allowed to have come from.
    Same tri-state as the draft: `null` while it is being written, `false` once
    the model has been asked and produced nothing.
  */
  const [answer, setAnswer] = useState<AskAnswer | null | false>(null)

  /** A cited message the thread has not loaded. See the source row's onClick. */
  const [unreachable, setUnreachable] = useState<string | null>(null)

  /*
    INT-5 — what the conversation calls for, chosen from what apps declare.
    Same tri-state again: `null` while looking, `false` once nothing came back
    or nothing fitted.
  */
  const [proposal, setProposal] = useState<Proposal | null | false>(null)

  /*
    What the browser says about the model, resolved once per open.

    The launcher's own rule is that an action appears only where it can succeed,
    so the row is absent rather than disabled where nothing can run — Edge 154
    gates generative execution outright, and a row that always fails there is
    worse than no row.

    The raw answer rather than `canPrefill`'s boolean, since INT-10: the two
    answers `canPrefill` refuses are not one case. 'unavailable' means nothing
    to offer, while 'downloadable' means the machine can run it and has not
    been asked — which is a row, not a silence.
  */
  const [availability, setAvailability] = useState<PrefillAvailability | null>(null)
  useEffect(() => {
    let cancelled = false
    void prefillAvailability().then((answer) => !cancelled && setAvailability(answer))
    return () => {
      cancelled = true
    }
  }, [])
  /*
    Unresolved counts as not ready, which is why this is `null` until the
    promise lands rather than a guess: the rows are assembled on the first
    render and an optimistic default would flash a row that then vanishes.

    'unanswered' counts as not ready too, and is why this names the answers
    that pass rather than the ones that fail. A browser that will not say
    whether it has a model is not a browser to open a session against — that is
    how the Ask row ends up sitting on "Reading the thread…" for ever.
  */
  const modelReady = availability === 'available' || availability === 'unavailable'

  /*
    INT-10 — the model can be fetched, and until this ticket nothing offered.

    `canPrefill` refuses 'downloadable' so that opening a form never starts a
    22 GB fetch (PEE-6), and the browser downloads only when a page calls
    `create()`. Both are right and together they deadlock: Miky's machine could
    run the model for a week and only got it by pasting `create()` into the
    console. Every colleague would have reached the same dead end.

    The offer resolves it without touching PEE-6, which forbids a download
    starting as a *side effect* rather than forbidding one at all. It appears
    exactly where the Ask rows would have appeared — same conditions, same
    section — so it reads as the reason they are missing, and it is never a
    nag: nothing is offered until somebody types a question at a conversation.
  */
  const modelDownloadable = availability === 'downloadable' || availability === 'downloading'
  /** Percent while fetching, 'failed' once refused, null when neither. */
  const [download, setDownload] = useState<number | 'failed' | null>(null)
  const startDownload = useCallback(() => {
    if (typeof download === 'number') return
    setDownload(0)
    void downloadModel((fraction) => setDownload(Math.round(fraction * 100))).then((ok) => {
      /*
        No cancellation guard, deliberately. The fetch belongs to the browser
        and survives this launcher closing; if it is still mounted the row
        should say what happened, and if it is not, React drops the update.
      */
      setDownload(ok ? null : 'failed')
      if (ok) setAvailability('available')
    })
  }, [download])

  useEffect(() => {
    setDraft(null)
    setAnswer(null)
    setUnreachable(null)
    setProposal(null)
    if (!asking) return
    const messages = context.conversation?.messages ?? []
    if (messages.length === 0) return
    let cancelled = false

    void (async () => {
      if (asking.intent === 'draft') {
        // A draft is written from the thread as a whole: the brief is what to
        // say, and there is no claim to trace back to a message.
        const conversation = threadContext(bodies(context.conversation))
        if (!conversation) return
        const written = await promptForText(draftInstruction(conversation, asking.request))
        if (!cancelled) setDraft(written ?? false)
        return
      }

      if (asking.intent === 'propose') {
        // The whole thread, bounded — a proposal is about what the
        // conversation is, not about one claim in it, so there is nothing to
        // retrieve against and nothing to cite.
        const conversation = threadContext(bodies(context.conversation))
        if (!conversation) return

        /*
          INT-5 — every probeable app, not one.

          A label alone means nothing across apps: two of them may declare
          something plausibly matching, so the catalogue carries which app each
          action belongs to and so does the proposal. Which apps to ask comes off
          the registry's `parentKind`; nothing here names one.
        */
        const found = await Promise.all(
          probeable(LAUNCHER_APPS).map(async (app) => {
            try {
              const live = await creatableUnder(app.parentKind as number)
              if (!live) return []
              return live.actions.filter(isProposable).flatMap((action) => {
                const launcher = launcherActionFrom(action, { parentNoun: 'parent', submitLabel: action.label })
                if (!launcher) return []
                return [
                  {
                    appId: app.id,
                    appLabel: app.label,
                    action,
                    launcher,
                    vocabularies: vocabulariesFrom(action),
                    parents: live.parents.map((p) => ({ value: p.address, label: p.title })),
                  },
                ]
              })
            } catch (error: unknown) {
              // A read that fails must produce a sentence, not silence — the
              // lesson the scoped read above was fixed for.
              console.warn('[nostr] reading an app’s creatable actions failed:', error)
              return []
            }
          }),
        )
        const entries = found.flat()
        if (cancelled) return
        if (entries.length === 0) {
          setProposal(false)
          return
        }
        const answered = await promptForObject(proposalInstruction(conversation, entries), PROPOSAL_SCHEMA)
        if (cancelled) return
        /*
          Validated against the real set. Structured output is refused on some
          builds, so this answer arrived through the lenient path and can be
          anything at all — an id nothing declared is dropped rather than guessed
          at, the discipline `buildCreationEvent` already applies to properties.
        */
        setProposal(readProposal(answered, entries) ?? false)
        return
      }
      /*
        Retrieval first, generation second (INT-3). Which messages the answer
        could have come from is decided here, deterministically and without a
        model — so a citation cannot be invented, only chosen from or ignored.
      */
      const selection = selectMessages(asking.request, messages)
      const raw = await promptForText(answerInstruction(asking.request, selection.chosen))
      if (cancelled) return
      if (!raw) {
        setAnswer(false)
        return
      }
      const { text, cited } = parseAnswer(raw, selection.chosen.length)
      /*
        Citations narrow the source list; they never widen it. A model that
        cited nothing gets the whole retrieved set shown instead — those are
        the only messages it saw, so the claim "the answer came from these" is
        true either way, and an answer with no sources at all is the one thing
        this feature exists to prevent.
      */
      const sources = cited.length > 0 ? selection.chosen.filter((c) => cited.includes(c.n)) : selection.chosen
      setAnswer({
        text,
        sources,
        byRecency: selection.byRecency,
        omitted: selection.omitted,
        // Counted over what was *read*, not over the topic: a reply under a
        // conversation the budget dropped is already inside `omitted`.
        repliesNotRead: selection.chosen.reduce((n, c) => n + (c.message.repliesNotRead ?? 0), 0),
      })    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, bodies(context.conversation).join('\u0000'), creatableUnder])

  const [prefill, setPrefill] = useState<Record<string, string> | undefined>()
  useEffect(() => {
    setPrefill(undefined)
    // A change acts on an object that already exists; there is nothing to
    // suggest. Only a creation has empty fields worth filling.
    if (!formAction || formAction.target) return
    const conversation = threadContext(bodies(context.conversation))
    if (!conversation) return
    // A proposed form was never scoped into, so its vocabularies come off the
    // entry the proposal carried (INT-5) — otherwise the prefill constraint
    // would offer a free string where the manifest declared an enum.
    const built = formSchema(formAction.fields, scope?.vocabularies ?? formEntry?.vocabularies ?? {})
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
  }, [formAction, scope, formEntry, bodies(context.conversation).join('\u0000')])
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
    if (formAction) {
      setFormAction(null)
      // Or the next form drawn would inherit a proposal's vocabularies.
      setFormEntry(null)
    } else if (scope) setScope(null)
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

    /*
      Declared means "a manifest read just now says this exists", and a form
      reaches here by **two** routes — INT-9.

      Scoping into an app is the one this checked: `liveShip`. Accepting a
      proposal is the other, and it has no scope at all, so `liveShip` is null
      and every proposal's form took the silent close below. INT-5's own
      safety tests pass either way — they assert `applyAction` is *not* called
      before a person submits — so the half that publishes was never exercised
      and Make could not create anything.

      `formEntry` is the proposal's catalogue entry, built from the same live
      manifests, which is why it counts as a declaration and the registry's
      rows do not.
    */
    const declared =
      liveShip?.actions.some((a) => a.id === action.id) === true ||
      formEntry?.launcher.id === action.id
    const { parent, properties } = splitSubmission(values)
    /*
      Both branches used to be one silent `onClose()`. That is the bug this
      ticket is named for: a submit that closes is indistinguishable from a
      submit that worked, and it is how three dead rows survived being used.

      Unreachable from the list now — `scopeActions` offers only declared
      actions — and kept because unreachable is a claim about this file, not
      about the app: a story passing `initialActionId`, a proposal, or the next
      registry entry all arrive here.
    */
    if (!declared) {
      setSubmitError(`${scope?.label ?? 'That app'} has not published this action, so there is nothing to send.`)
      return
    }
    if (!parent) {
      setSubmitError('Choose where this should go before creating it.')
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

  /**
   * The shared hint now (2026-09-05). This was the launcher's own
   * caption-sized copy, restored deliberately on 2026-09-01 because the
   * shared `EnterHint` was then the pickers' smaller 9px voice and this
   * surface wanted caption.
   *
   * That difference is gone: `EnterHint` is the `Kbd` chip, at the same 10px
   * mono the launcher's own footer uses two rows below it. Keeping a private
   * copy now would mean a row saying `↩ Enter` in plain text directly above a
   * footer saying it in a chip — the split Katerina asked to close.
   */
  const enterHint = <EnterHint />

  /**
   * Every key the footer names, drawn as the shared chip — not a fourth copy
   * of it: `SearchInput`, `MenuItem` and `Tooltip` all render the same `Kbd`.
   *
   * Labels are words (Katerina, 2026-09-05). `↩` and `⌫` are not in Geist
   * Mono, so the browser borrowed each from another face — measured at 10px,
   * a character the font owns advances 6px, `↩` came back 8.63px and `⌫`
   * 12.81px, which is why those two chips sat wider than `↑` and `↓` beside
   * them. `↑` and `↓` stay: the font has them, on the grid, and an arrow is
   * what the key itself says.
   */
  const keyBadge = (label: string) => <Kbd>{label}</Kbd>

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
      // The hint is NOT rendered here: it rides MenuItem's `hint` slot, which
      // reveals it from the row's own :hover on the same transition as the
      // fill. Rendering it from `isHl` mounted it, and a mount is instant
      // while the fill is a 150ms fade — the flicker Katerina caught.
      trailing,
      render: () => (
        <>
          {icon != null && iconTile(icon)}
          <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
            <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{title}</div>
            {subtitle && <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{subtitle}</div>}
          </div>
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

        **Every app, not only Ship** (INT-9). It was Ship-only because Ship was
        the only app whose rows could be empty; now that a row exists only
        where a manifest declares one, Peek's list is empty too and an
        unexplained blank there is the same wrong statement.

        Keyed off `scopeActions` rather than the filtered `actions`, because an
        app that offers three things none of which match what was typed has not
        stopped offering them. That case draws no rows and no note, which is
        how every other section of the launcher already reports a miss.
      */
      const liveNote =
        scopeActions.length > 0
          ? null
          : liveState === 'failed'
            ? `Could not read ${scope.label}’s manifest — its actions are unavailable.`
            : // Never probed, or probed and finished: either way this is the
              // whole answer. Only an app with a parent kind can still be
              // mid-flight, and `idle` is the tick before the effect runs.
              scope.parentKind && (liveState === 'idle' || liveState === 'loading')
              ? `Reading ${scope.label}’s manifest…`
              : `${scope.label} has not published anything to create here yet.`
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
      INT-10 — where a model could answer but has not been fetched, offer it.

      Above the INT-2 block and gated on the same three conditions, so it
      occupies exactly the space the Ask rows would have and reads as the
      reason they are absent. Selecting it is the only thing in Peek that
      starts the download, and the label says what it costs beforehand.
    */
    if (q && context.conversation?.messages?.length && modelDownloadable) {
      headers.set(rows.length, sectionHeader('Ask'))
      const label =
        download === 'failed'
          ? 'This browser refused the model — asking is unavailable here'
          : typeof download === 'number'
            ? `Downloading the on-device model… ${download}%`
            : availability === 'downloading'
              ? 'The on-device model is downloading — show progress'
              : 'Download the on-device model to ask about conversations'
      const subtitle =
        download === 'failed'
          ? undefined
          : typeof download === 'number'
            ? 'Keep working — this continues if you close the launcher.'
            : 'Several gigabytes, once per browser. It runs on this device; nothing is sent anywhere.'
      rows.push({
        ...simpleRow(
          'model-download',
          <IconDownload size={16} stroke={1.5} className="text-text-secondary" />,
          label,
          subtitle,
          () => {
            // Not `closeAll()`: the progress is on this row, and a person who
            // asked for the download is owed sight of it.
            if (download !== 'failed') startDownload()
          },
        ),
      })
    }

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
            setAsking({ request: query.trim(), intent: 'ask' })
          },
        ),
        compact: true,
      })

      /*
        INT-4 — the same sentence, read as a brief rather than a question.

        A second row rather than a model deciding which was meant. Asking and
        drafting fail in opposite directions: a question answered as a draft
        wastes a read, a draft answered as a question wastes the request, and
        the launcher already refused that guess once when PEE-4 ruled out
        "no search hits means they meant something else". Two rows cost one
        arrow key and are never wrong.

        It needs a composer as well as a conversation — with nowhere to put a
        draft there is no point writing one.
      */
      /*
        INT-5 — the same sentence read as "make something of this".

        A third row for the same reason there is a second one: asking, drafting
        and making are three things a typed sentence could mean, and the
        launcher does not guess which. What it needs is a conversation and a
        model; whether any app declares anything usable is not known until it
        looks, and the panel says so rather than the row pretending to know.
      */
      rows.push({
        ...simpleRow(
          'propose',
          <IconSparkles size={16} stroke={1.5} className="text-text-secondary" />,
          <>Make something from this conversation</>,
          undefined,
          () => {
            setAsking({ request: query.trim(), intent: 'propose' })
          },
        ),
        compact: true,
      })

      if (context.composer) {
        rows.push({
          ...simpleRow(
            'draft',
            <IconWriting size={16} stroke={1.5} className="text-text-secondary" />,
            <>
              Draft a reply: "<span className="font-medium">{query.trim()}</span>"
            </>,
            undefined,
            () => {
              setAsking({ request: query.trim(), intent: 'draft' })
            },
          ),
          compact: true,
        })
      }
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
        trailing: <IconChevronRight size={16} stroke={1.5} className="text-text-secondary shrink-0" />,
        render: () => (
          <>
            {appTile(a)}
            <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
              <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{a.label}</div>
              <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{`${a.description} · ${a.actions.length} actions`}</div>
            </div>
          </>
        ),
      })
    }
    return { rows, headers }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, scope, scopeActions, liveState, formAction, contextCleared, topics, people, directory, messageState, messageHits, navigate, changeRows, modelReady, modelDownloadable, availability, download, startDownload, context.conversation?.messages?.length])

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
      /*
        In the Ask panel there is no list, but `rows` is still computed and
        `highlight` still points into it — so Enter used to fire a row nobody
        could see (shipped in INT-2, fixed here). Asking again is what Enter
        means on this level, and it is how a question gets refined: edit the
        box, press Enter, same sources machinery, new answer.
      */
      if (asking !== null) {
        const request = query.trim()
        if (request) setAsking({ request, intent: asking.intent })
        return
      }
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
                {asking.intent === 'draft' ? (
                  <IconWriting size={10} stroke={1.5} className="text-text-secondary" />
                ) : asking.intent === 'propose' ? (
                  <IconSparkles size={10} stroke={1.5} className="text-text-secondary" />
                ) : (
                  <IconMessageQuestion size={10} stroke={1.5} className="text-text-secondary" />
                )}
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary whitespace-nowrap max-w-[220px] truncate">
                  {asking.intent === 'propose' && !asking.request ? 'Make something' : asking.request}
                </span>
                <button
                  type="button"
                  onClick={popLevel}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary"
                  aria-label={
                    asking.intent === 'draft' ? 'Leave Draft' : asking.intent === 'propose' ? 'Leave Make' : 'Leave Ask'
                  }
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
              One panel, three modes, and the sentence at the top of each.

              INT-2 shipped this surface empty on purpose — the gesture, the
              chip and the place an answer goes could all be judged before a
              prompt existed. What fills it now are three readings of the same
              typed sentence, and the launcher never guesses which was meant:

              - **Ask** (INT-3) answers it from retrieved messages, and cites
                them.
              - **Draft** (INT-4) treats it as a brief and writes a reply.
              - **Make** (INT-5) ignores the words and asks what the
                *conversation* calls for, over what any app declares.

              All three have the same three states — working, a result, and
              nothing came back — because all three have a model behind them
              and a person who pressed Enter is owed an answer or a reason.
            */
            <div className="px-4 py-6 flex flex-col gap-3" data-surface="ask">
              {/* Make is about the conversation rather than the words, so it
                  has nothing to echo back. */}
              {asking.intent !== 'propose' && (
                <p className="text-[14px] leading-[1.4] text-text-primary">{asking.request}</p>
              )}

              {asking.intent === 'propose' ? (
                proposal === null ? (
                  // Two waits behind this one: a relay read for the manifests
                  // and then the model. Saying so beats a blank panel.
                  <p className="text-[13px] leading-[1.4] text-text-secondary">Reading the conversation…</p>
                ) : proposal === false ? (
                  <p className="text-[13px] leading-[1.4] text-text-secondary">
                    Nothing here matches what any app offers to make. Leave Make to go back to searching.
                  </p>
                ) : (
                  <>
                    {/*
                      Which app, always. A label alone means nothing across
                      apps — two of them may declare something plausibly
                      matching, and this names the one about to be written to.
                    */}
                    <p className="text-[12px] leading-[1.2] text-text-secondary">
                      {proposal.entry.appLabel} · {proposal.entry.launcher.label}
                    </p>
                    <p data-testid="proposal" className="text-[14px] leading-[1.5] text-text-primary">
                      {proposal.preview}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() => {
                          /*
                            Opens the form; it does not publish. The model
                            proposed and a person submits — PEE-5's "nothing
                            submits without a person", reached here through a
                            declared field rather than a rule invented in Peek.
                          */
                          setFormEntry(proposal.entry)
                          setAsking(null)
                          enterForm(proposal.entry.launcher)
                        }}
                      >
                        Open the form
                      </Button>
                      <span className="text-[12px] leading-[1.2] text-text-secondary">
                        Nothing is created until you submit it.
                      </span>
                    </div>
                  </>
                )
              ) : asking.intent === 'ask' ? (
                answer === null ? (
                  <p className="text-[13px] leading-[1.4] text-text-secondary">Reading the thread…</p>
                ) : answer === false ? (
                  /*
                    Silence inverts here. PEE-6's "say nothing rather than
                    apologise" was written for prefill nobody asked for; a
                    person who typed a question and pressed Enter is owed an
                    answer or a reason, never nothing.
                  */
                  <p className="text-[13px] leading-[1.4] text-text-secondary">
                    No answer came back. Edit the question and press Enter to try again.
                  </p>
                ) : (
                  <>
                    <p
                      data-testid="answer"
                      className="text-[14px] leading-[1.5] text-text-primary whitespace-pre-wrap"
                    >
                      {answer.text}
                    </p>

                    {/*
                      The sources are the frame, which is why there is no
                      apologetic "AI may be wrong" badge — that would fight
                      PEE-6's stance and say less. A wrong answer with three
                      citations is recoverable in seconds.
                    */}
                    <SectionLabel>{answer.sources.length === 1 ? 'Source' : 'Sources'}</SectionLabel>
                    <div data-testid="sources" className="flex flex-col">
                      {answer.sources.map(({ n, message }) => (
                        <button
                          key={message.id}
                          type="button"
                          onClick={() => {
                            /*
                              Scroll first, close second. A thread paginates, so
                              a cited message can sit above the loaded window —
                              closing first would leave a click that appeared to
                              work and did nothing, which is worse than a row
                              that was never offered.
                            */
                            if (scrollToMessage(message.id)) {
                              onClose()
                              return
                            }
                            /*
                              Not on screen. A topic-wide answer (INT-8) cites
                              across conversations, and all but the open one are
                              unmounted — so ask the topic view to open it and
                              scroll once it has rendered.

                              Closing here is deliberate even though the scroll
                              may still miss: the conversation *did* open, so the
                              person is looking at the right thread either way.
                              That is a smaller failure than staying put.
                            */
                            if (message.conversationId && openConversation(message.conversationId)) {
                              onClose()
                              void scrollToMessageWhenReady(message.id)
                              return
                            }
                            setUnreachable(message.id)
                          }}
                          className="text-left px-3 py-2 rounded-md hover:bg-bg-hover flex flex-col gap-0.5"
                        >
                          <span className="text-[12px] leading-[1.2] text-text-secondary">
                            [{n}] {message.author} · {message.timestamp}
                          </span>
                          <span className="text-[13px] leading-[1.4] text-text-primary line-clamp-2">
                            {message.body}
                          </span>
                          {unreachable === message.id && (
                            <span className="text-[12px] leading-[1.2] text-text-secondary">
                              Not loaded in the thread — scroll up to load earlier messages.
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/*
                      What retrieval did, when it did something other than
                      retrieve. A silent cap reads as "that is all there was" —
                      the failure PEE-4 named for unroutable hits, and the one
                      `threadContext` still has.
                    */}
                    {(answer.byRecency || answer.omitted > 0 || answer.repliesNotRead > 0) && (
                      <p className="text-[12px] leading-[1.4] text-text-secondary">
                        {[
                          answer.byRecency
                            ? 'Nothing here matched the question, so the most recent messages were read instead.'
                            : answer.omitted > 0
                              ? `${answer.omitted} earlier ${answer.omitted === 1 ? 'message' : 'messages'} did not fit and ${answer.omitted === 1 ? 'was' : 'were'} not read.`
                              : null,
                          /*
                            INT-8. Asking about a whole topic reads its
                            conversations' opening messages; replies are fetched
                            per thread and are not in memory. At topic scale that
                            is usually most of what was said, so it is stated
                            rather than left to be assumed away.
                          */
                          answer.repliesNotRead > 0
                            ? `${answer.repliesNotRead} ${answer.repliesNotRead === 1 ? 'reply was' : 'replies were'} not read — open a conversation to ask about its replies.`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    )}
                  </>
                )
              ) : draft === null ? (
                // Saying it is working, because a blank panel for several
                // seconds reads as a broken one. Measured: 8000 characters of
                // thread costs about 2.3s before a word is generated (INT-1).
                <p className="text-[13px] leading-[1.4] text-text-secondary">Writing a draft…</p>
              ) : draft === false ? (
                <p className="text-[13px] leading-[1.4] text-text-secondary">
                  No draft came back. Leave Draft to go back to searching — what you typed is still there.
                </p>
              ) : (
                <>
                  {/* The draft is shown BEFORE it goes anywhere. An unwanted
                      draft in the composer costs a selection and a delete;
                      seeing it first costs nothing. */}
                  <p
                    data-testid="draft"
                    className="text-[14px] leading-[1.5] text-text-primary whitespace-pre-wrap border-l-2 border-border-default pl-3"
                  >
                    {draft}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => {
                        // At the cursor, never replacing, and never sending.
                        insertTextIntoActiveComposer(draft)
                        onClose()
                      }}
                    >
                      Put it in the composer
                    </Button>
                    <span className="text-[12px] leading-[1.2] text-text-secondary">
                      It will not send — edit it first.
                    </span>
                  </div>
                </>
              )}
            </div>
          ) : formAction && (scope || formAction.target || formEntry) ? (
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
                    : // A proposed action was never scoped into, so its own
                      // declaration is the only place its vocabularies are
                      // (INT-5).
                      formEntry?.vocabularies
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
                  trailing={row.trailing}
                  hint={enterHint}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    row.onSelect()
                  }}
                >
                  {row.render()}
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
                  {keyBadge(shortcutLabel('Mod-Enter'))} {formAction.submitLabel.toLowerCase()}
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('Backspace')} back</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  {keyBadge('↑')}
                  {keyBadge('↓')} navigate
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('Enter')} open</span>
              </>
            )}
            <span className="flex items-center gap-1.5">{keyBadge('Esc')} close</span>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
