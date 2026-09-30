import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconDownload, IconEraser, IconFileText, IconMessageQuestion, IconPencil, IconRefresh, IconSparkles, IconWriting, IconCornerDownLeft } from '@tabler/icons-react'
import {
  CommandPalette,
  CommandPaletteAnswer,
  CommandPaletteForm,
  CommandPaletteProposal,
  CommandPaletteQuote,
  CommandPaletteSearch,
  CommandPaletteWorking,
  FieldLine,
  type CommandPaletteChip,
  type CommandPaletteGroup,
  type CommandPaletteRow,
} from '@estiva-app/ui'
import { Avatar } from './ui/Avatar'
import { PeekLogoMark } from './ui/PeekLogo'
import { ShipLogoMark } from './ui/ShipLogo'
import { TopicState } from './ui/TopicState'
import { ActionFormFields } from './ActionFormPanel'
import { applyPrefill, draftValues, missingFields, seedDraft, type FormDraft } from '@/lib/formDraft'
import { formatDateLabel, useForeignObjects, useMessageSearch, useWorkspaceDirectory, useWorkspacePeople, type Person } from '@/api'
import { KIND_BARE_FILE, type ResolvedAction } from '@estiva-app/interop'
import { addrToNaddr } from '@estiva-app/protocol'
import { matchPeople, messageEmptyState, snippetAround } from '@/lib/launcherSearch'
import { filePath, fileRouteFromPath, refNamesFile } from '@/lib/objectUrl'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'
import { canPrefill, downloadModel, prefillAvailability, promptForObject, promptForText, type PrefillAvailability } from '@/lib/promptApi'
import { PROPOSAL_SCHEMA, isProposable, probeable, proposalInstruction, readProposal, type CatalogueEntry, type Proposal } from '@/lib/actionCatalogue'
import { draftInstruction, formSchema, prefillInstruction, threadContext, usablePrefill } from '@/lib/prefill'
import { answerInstruction, parseAnswer, selectMessages, type NumberedMessage } from '@/lib/askThread'
import { scrollToMessage, scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { openConversation } from '@/lib/threadOpener'
import {
  PARENT_FIELD,
  changeActionFrom,
  changeVocabulariesFrom,
  creationsFor,
  launcherActionFrom,
  proseSubmission,
  splitSubmission,
  vocabulariesFrom,
  type CreatableKindRead,
} from '@/lib/liveAction'
import type { LauncherContext } from '@/lib/launcherContext'
import { insertReferenceIntoActiveComposer, insertTextIntoActiveComposer } from '@/lib/composerRegistry'
import { bodies } from '@/lib/conversationRegistry'
import { useLastSelection } from '@/lib/lastSelection'
import { clearRecents, forgetRecent, useRecents } from '@/lib/recents'
import { isApplePlatform } from '@estiva-app/ui'
import { previewText } from '@/lib/textParsing'
import { useToast } from '@/lib/toast'
import { LAUNCHER_APPS, type LauncherAction, type LauncherApp, type VocabOption } from '@/lib/launcherActions'

/**
 * The launcher (Cmd/Ctrl+K anywhere, or the top bar's search field) — Peek's
 * words, rows and levels, drawn in the package's `CommandPalette` (UIG-29).
 *
 * **What moved to the package, and what stayed.** The window, the field, the
 * rows, the footer and every key are `CommandPalette`'s (Katerina, 16
 * September, P1 and P2): the arrows, Enter, Tab to go in, Backspace to go back,
 * Ctrl+Enter, where focus goes. This file keeps what only Peek knows: which
 * levels there are, which rows exist on each, what the search finds, what the
 * apps' manifests declare, Ask, Draft and Make, and what a form sends.
 *
 * **The levels are a stack**, so every way back puts back what was there:
 *
 * - the first level: this conversation, recents and apps before you type;
 *   apps, Ask, this conversation, people, actions and messages as you do
 * - inside an app: the actions its manifest declares
 * - Ask, Draft or Make: the result, then what you can do with it as rows
 * - a form: creating something, or changing something the thread refers to
 *
 * The design is the approved prototype and the key list
 * (`uig29-review/KEY-LIST.md`), with the UX review's rulings R1–R15 and the
 * nine bugs F1–F9 it found in the launcher this replaces.
 */

type Intent = 'ask' | 'draft' | 'propose'

type Level =
  | { kind: 'first' }
  | { kind: 'app'; app: LauncherApp }
  | { kind: 'ai'; intent: Intent }
  | {
      kind: 'form'
      action: LauncherAction
      /** The app it was reached through, when it was. */
      app?: LauncherApp
      /**
       * The catalogue entry a proposal opened it from (INT-5). A proposal opens
       * another app's form directly, so its vocabularies and parent list travel
       * with it — there is no app scope to read them off, and a form drawn
       * without either is one the runtime refuses (PEE-1).
       */
      entry?: CatalogueEntry
    }

/** One level, and what was typed on it — kept when you go further in and come back. */
interface Frame {
  level: Level
  query: string
}

/**
 * An answer and the messages it is allowed to have come from (INT-3).
 *
 * `sources` is a subset of what retrieval chose, never a superset. Nothing
 * here is persisted: the answer is shown and forgotten.
 */
interface AskAnswer {
  text: string
  sources: NumberedMessage[]
  /** Nothing in the question matched, so recency chose the messages. */
  byRecency: boolean
  /** Messages the context budget could not take. */
  omitted: number
  /** Replies the snapshot never held (INT-8). */
  repliesNotRead: number
}

/** What an app's manifest says it can create, read when first needed. */
type LiveRead =
  | { state: 'loading' }
  /** `parents` by action id: Ship's issue goes under a project, its project in a Folder (MAN-8). */
  | { state: 'ready'; actions: LauncherAction[]; parents: Record<string, VocabOption[]> }
  | { state: 'none' }
  | { state: 'failed' }

interface CommandLauncherProps {
  /** Captured at the invoking keystroke/click - see lib/launcherContext. */
  context: LauncherContext
  onClose: () => void
  /** Open inside an app (tests only). */
  initialAppId?: string
  /** Open with an action's form already up (tests only; needs initialAppId). */
  initialActionId?: string
}

const icon = (Glyph: typeof IconPencil) => <Glyph size={16} stroke={1.5} />

const appMark = (app: { id: string }, size = 14) =>
  app.id === 'peek' ? <PeekLogoMark height={size} /> : <ShipLogoMark height={size} />

/** A stored body as one line of words — markdown and a heading's marker gone. */
const asWords = (body: string) =>
  previewText(body.replace(/^#{1,6}\s+/gm, ''))
    .replace(/\s*\n+\s*/g, ' ')
    .trim()

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** The footer's "where": the composer the launcher was opened over, in words. */
function whereFrom(context: LauncherContext): string {
  const label = context.composer?.label
  if (!label) return context.conversation ? 'In this conversation' : 'Anywhere in Peek'
  if (label.startsWith('Reply to ')) return `In a reply to ${label.slice('Reply to '.length)}`
  return `In ${label}`
}

function initialStack(appId?: string, actionId?: string): Frame[] {
  const first: Frame = { level: { kind: 'first' }, query: '' }
  const app = LAUNCHER_APPS.find((a) => a.id === appId)
  if (!app) return [first]
  const inApp: Frame = { level: { kind: 'app', app }, query: '' }
  const action = app.actions.find((a) => a.id === actionId)
  return action ? [first, inApp, { level: { kind: 'form', action, app }, query: '' }] : [first, inApp]
}

/** A form's draft is kept per action, so leaving and coming back finds it as it was (R1 A). */
const formKey = (level: Extract<Level, { kind: 'form' }>) =>
  `${level.action.target ?? level.app?.id ?? level.entry?.appId ?? ''}:${level.action.id}`

export function CommandLauncher({ context, onClose, initialAppId, initialActionId }: CommandLauncherProps) {
  const [stack, setStack] = useState<Frame[]>(() => initialStack(initialAppId, initialActionId))
  const frame = stack[stack.length - 1]
  const level = frame.level
  const query = frame.query
  const q = query.trim().toLowerCase()

  const setQuery = (next: string) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], query: next }])
  const push = (...levels: Level[]) => setStack((s) => [...s, ...levels.map((l) => ({ level: l, query: '' }))])
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))

  const navigate = useNavigate()
  const { showToast } = useToast()
  const { setPendingTopicMessage, dmId: selectedPersonId } = useLastSelection()
  const { pathname } = useLocation()
  /* Where the launcher was opened: a recent that is the page you are on is not somewhere to go (Katerina, 16 September). */
  const openPersonId = pathname.startsWith('/app/people/') ? selectedPersonId : null
  // A file's page is `/<word>/<slug>-<d>` or `/topic/<address>` (FOL-19, FOL-37, FOL-39); the ref in the path names the file that is open.
  const openFileRef = fileRouteFromPath(pathname)?.ref ?? null
  // The People page's list, keyed by pubkey — a row opens the DM (REM-3).
  const people = useWorkspacePeople()
  const directory = useWorkspaceDirectory()
  const recents = useRecents()

  /*
    PEE-4's three corpora. Messages live on the relay and match whole tokens
    only; `lib/launcherSearch` carries the reasoning and the wording that
    difference forces. Searched on the first level only (F9): inside an app the
    results were never shown, and the relay was asked anyway on every pause.
  */
  const { state: messageState, hits: messageHits } = useMessageSearch(level.kind === 'first' ? query : '')

  const { creatableUnder, applyAction, resolveObject } = useForeignObjects()

  /*
    PEE-3's targets: the objects this conversation already refers to, resolved
    for their titles and their declared field-setting actions. Captured at the
    invoking keystroke, so the list is the thread the person was looking at. A
    reference that will not resolve, or has no naddr to act on, is dropped: a
    row for an object nobody can act on is a row that cannot succeed.
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
            if (!object?.naddr) return null
            return {
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

  /* One row per (object, field-setting action) pair: "Set status · Billing entry" is the thing somebody means. */
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

  /*
    What each app declares it can create — INT-9: a row exists only because a
    manifest, read just now, says the action does.

    Read per app and kept per app, which is F2's fix: the list was one slot,
    so after visiting Ship, Peek offered Ship's "Add issue". Read when first
    needed rather than at every open — going into an app, or typing on the
    first level, where an action can be found by its name (C4).
  */
  const [live, setLive] = useState<Record<string, LiveRead>>({})
  const asked = useRef(new Set<string>())
  /*
    One read per parent kind, shared by every app — MAN-8. An app's creations
    are no longer all on its own kind: Ship's `add-project` is on a Folder,
    which is Peek's, so Ship's section reads Peek's kind too and Peek's reads
    it once for both. `creationsFor` sorts the actions back to the app that
    declared them.
  */
  const kindReads = useRef(new Map<number, Promise<CreatableKindRead | null>>())
  const readKinds = useCallback(
    // Rejects only when `required` — the app's own kind — could not be read;
    // another kind that failed is read as nothing there.
    async (required: number): Promise<Map<number, CreatableKindRead | null>> => {
      const kinds = [...new Set(probeable(LAUNCHER_APPS).map((app) => app.parentKind as number))]
      const reads = await Promise.allSettled(
        kinds.map((kind) => {
          let read = kindReads.current.get(kind)
          if (!read) {
            read = creatableUnder(kind)
            // A failure is not kept, so the next visit asks again.
            read.catch(() => kindReads.current.delete(kind))
            kindReads.current.set(kind, read)
          }
          return read
        }),
      )
      const out = new Map<number, CreatableKindRead | null>()
      kinds.forEach((kind, i) => {
        const read = reads[i]
        if (read.status === 'fulfilled') out.set(kind, read.value)
        else if (kind === required) throw read.reason
        else out.set(kind, null)
      })
      return out
    },
    [creatableUnder],
  )
  const readLive = useCallback(
    (app: LauncherApp) => {
      // An app with no parent kind is never probed: nothing about it is live.
      if (typeof app.parentKind !== 'number' || asked.current.has(app.id)) return
      asked.current.add(app.id)
      setLive((l) => ({ ...l, [app.id]: { state: 'loading' } }))
      readKinds(app.parentKind)
        .then((reads) => {
          const found = creationsFor(app, reads)
          if (!found) {
            // Signed out, or the app declares nothing creatable. Not an error.
            setLive((l) => ({ ...l, [app.id]: { state: 'none' } }))
            return
          }
          const actions: LauncherAction[] = []
          const parents: Record<string, VocabOption[]> = {}
          for (const creation of found) {
            // The noun of the kind it goes on — the app's own for its own kind (INT-9), "Folder" on a Folder.
            const action = launcherActionFrom(creation.action, { parentNoun: creation.parentNoun, submitLabel: creation.action.label })
            if (!action) continue
            actions.push(action)
            parents[action.id] = creation.parents
          }
          setLive((l) => ({ ...l, [app.id]: { state: 'ready', actions, parents } }))
        })
        .catch((error: unknown) => {
          // A read that fails must produce a sentence, not silence.
          console.warn('[nostr] reading another app’s creatable actions failed:', error)
          setLive((l) => ({ ...l, [app.id]: { state: 'failed' } }))
        })
    },
    [readKinds],
  )
  useEffect(() => {
    if (level.kind === 'app') readLive(level.app)
    if (level.kind === 'first' && q) probeable(LAUNCHER_APPS).forEach(readLive)
  }, [level, q, readLive])

  const liveActions = (app: LauncherApp): LauncherAction[] => {
    const read = live[app.id]
    return read?.state === 'ready' ? read.actions : []
  }

  /*
    What the browser says about the model, resolved once per open.

    'unavailable' counts as ready on purpose: it is a browser that answered,
    and Chrome says it while working, so a session is attempted. 'unanswered'
    does not — a browser that never answers is how a row hangs for ever.
  */
  const [availability, setAvailability] = useState<PrefillAvailability | null>(null)
  useEffect(() => {
    let cancelled = false
    void prefillAvailability().then((answer) => !cancelled && setAvailability(answer))
    return () => {
      cancelled = true
    }
  }, [])
  const modelReady = availability === 'available' || availability === 'unavailable'

  /*
    INT-10 — the model can be fetched, and the launcher offers it, where the Ask
    rows would have been. Nothing starts a download but choosing the row (PEE-6).
  */
  const modelDownloadable = availability === 'downloadable' || availability === 'downloading'
  const [download, setDownload] = useState<number | 'failed' | null>(null)
  const startDownload = useCallback(() => {
    if (typeof download === 'number') return
    setDownload(0)
    void downloadModel((fraction) => setDownload(Math.round(fraction * 100))).then((ok) => {
      // No cancellation guard: the fetch belongs to the browser and outlives the launcher.
      setDownload(ok ? null : 'failed')
      if (ok) setAvailability('available')
    })
  }, [download])

  const hasThread = (context.conversation?.messages?.length ?? 0) > 0

  // ── Ask, Draft and Make ─────────────────────────────────────────────────────

  /*
    The question being answered, and what kind of answer. Separate from what is
    in the field: changing the field does not ask again until you say so, and a
    changed question puts "Ask: …" at the top for exactly that (the key list).
  */
  const [request, setRequest] = useState<{ intent: Intent; text: string } | null>(null)
  const [draft, setDraft] = useState<string | null | false>(null)
  const [answer, setAnswer] = useState<AskAnswer | null | false>(null)
  const [proposal, setProposal] = useState<Proposal | null | false>(null)
  /** A cited message the thread has not loaded — see the source row. */
  const [unreachable, setUnreachable] = useState<string | null>(null)

  useEffect(() => {
    setDraft(null)
    setAnswer(null)
    setUnreachable(null)
    setProposal(null)
    if (!request) return
    const messages = context.conversation?.messages ?? []
    if (messages.length === 0) return
    let cancelled = false

    void (async () => {
      if (request.intent === 'draft') {
        // A draft is written from the thread as a whole: the brief is what to say.
        const conversation = threadContext(bodies(context.conversation))
        if (!conversation) return
        const written = await promptForText(draftInstruction(conversation, request.text))
        if (!cancelled) setDraft(written ?? false)
        return
      }

      if (request.intent === 'propose') {
        const conversation = threadContext(bodies(context.conversation))
        if (!conversation) return
        /*
          INT-5 — every probeable app, not one. A label alone means nothing
          across apps, so the catalogue carries which app each action belongs to.
        */
        const found = await Promise.all(
          probeable(LAUNCHER_APPS).map(async (app) => {
            try {
              // Every kind, sorted back to the declaring app, as a section reads it (MAN-8).
              const found = creationsFor(app, await readKinds(app.parentKind as number))
              if (!found) return []
              return found.filter(({ action }) => isProposable(action)).flatMap(({ action, parents, parentNoun }) => {
                // The app's own word for the parent, not "Parent" (R10).
                const launcher = launcherActionFrom(action, { parentNoun, submitLabel: action.label })
                if (!launcher) return []
                return [
                  {
                    appId: app.id,
                    appLabel: app.label,
                    action,
                    launcher,
                    vocabularies: vocabulariesFrom(action),
                    parents,
                  },
                ]
              })
            } catch (error: unknown) {
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
        // Validated against the real set: an id nothing declared is dropped, never guessed at.
        setProposal(readProposal(answered, entries) ?? false)
        return
      }

      /*
        Retrieval first, generation second (INT-3): which messages the answer
        could have come from is decided here, without a model, so a citation can
        be chosen from or ignored but never invented.
      */
      const selection = selectMessages(request.text, messages)
      const raw = await promptForText(answerInstruction(request.text, selection.chosen))
      if (cancelled) return
      if (!raw) {
        setAnswer(false)
        return
      }
      const { text, cited } = parseAnswer(raw, selection.chosen.length)
      // Citations narrow the source list; they never widen it.
      const sources = cited.length > 0 ? selection.chosen.filter((c) => cited.includes(c.n)) : selection.chosen
      setAnswer({
        text,
        sources,
        byRecency: selection.byRecency,
        omitted: selection.omitted,
        repliesNotRead: selection.chosen.reduce((n, c) => n + (c.message.repliesNotRead ?? 0), 0),
      })
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, bodies(context.conversation).join('\u0000'), readKinds])

  /** Go into Ask, Draft or Make with what was typed on the first level (R8: leaving keeps it). */
  const openIntent = (intent: Intent) => {
    const text = query.trim()
    setStack((s) => [...s, { level: { kind: 'ai', intent }, query: text }])
    // Make reads the conversation, not the words, so it starts at once.
    setRequest(intent === 'propose' || text ? { intent, text } : null)
  }

  // ── Forms ───────────────────────────────────────────────────────────────────

  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({})
  const [attempted, setAttempted] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const formLevel = level.kind === 'form' ? level : null
  const formDraft = formLevel ? (drafts[formKey(formLevel)] ?? seedDraft(formLevel.action)) : null
  const setFormDraft = (next: FormDraft) => formLevel && setDrafts((d) => ({ ...d, [formKey(formLevel)]: next }))

  // A form's error belongs to that visit to it.
  useEffect(() => setSubmitError(null), [level])

  /*
    PEE-5 — the form arrives filled in from the conversation, where the model
    is already on the person's own device. Nothing is offered or waited for
    (PEE-6): the form opens at once, and this lands values in the fields
    nobody has touched, or does not.
  */
  const prefillFor = formLevel && !formLevel.action.target ? formKey(formLevel) : null
  useEffect(() => {
    if (!formLevel || !prefillFor) return
    const conversation = threadContext(bodies(context.conversation))
    if (!conversation) return
    const built = formSchema(formLevel.action.fields, formLevel.app?.vocabularies ?? formLevel.entry?.vocabularies ?? {})
    if (!built) return
    let cancelled = false
    void (async () => {
      if (!(await canPrefill())) return
      const suggested = await promptForObject(prefillInstruction(formLevel.action.label, conversation), built.schema)
      if (cancelled) return
      const usable = usablePrefill(suggested, built.keys)
      if (Object.keys(usable).length === 0) return
      setDrafts((d) => ({ ...d, [prefillFor]: applyPrefill(d[prefillFor] ?? seedDraft(formLevel.action), usable) }))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillFor, bodies(context.conversation).join('\u0000')])

  const parentOptionsFor = (form: Extract<Level, { kind: 'form' }>): Record<string, VocabOption[]> => {
    const out: Record<string, VocabOption[]> = {}
    /*
      A retired topic's channel is never somewhere to start a conversation
      (FOL-26): its conversation is on a file now, and a `kind:9` into it is
      what FOL-25 has to be sure nothing can write before the channel goes.
      The relay lists it among the newest `39000`s until then, so it is
      dropped here, by the same table the old links redirect through.
    */
    const live39000 = (options: VocabOption[]) =>
      options.filter((p) => !(p.value.startsWith('39000:') && legacyTopicByChannel(p.value.split(':')[2] ?? '')))
    const read = form.app ? live[form.app.id] : undefined
    if (read?.state === 'ready') out[PARENT_FIELD] = live39000(read.parents[form.action.id] ?? [])
    if (!form.app && form.entry) out[PARENT_FIELD] = live39000(form.entry.parents)
    return out
  }

  /**
   * A validated form arrives here as `{ fieldKey: value }`. `applyAction` turns
   * it into the event the declaration describes, signs and publishes it
   * (PEE-1), and the new object's reference goes into the active composer
   * (PEE-2).
   */
  const submitAction = async (form: Extract<Level, { kind: 'form' }>, values: Record<string, string>) => {
    const { action } = form
    /*
      A CHANGE carries a target chosen with the row, and the runtime takes a
      scalar for it (PEE-3). It is declared by the object's own manifest, so
      the live-read check below does not apply to it.
    */
    if (action.target) {
      const value = values[action.fields[0]?.key ?? '']
      if (!value) return
      setSubmitting(true)
      setSubmitError(null)
      const result = await applyAction({ naddr: action.target, actionId: action.id, value })
      setSubmitting(false)
      if (!result.ok) {
        setSubmitError(result.reason ?? 'The relay rejected the change.')
        return
      }
      showToast({ label: `${action.label} · ${action.targetLabel ?? 'saved'}`, type: 'success' })
      onClose()
      return
    }

    /*
      Declared means "a manifest read just now says this exists", reached by
      going into the app or by accepting a proposal — INT-9. A submission that
      closes saying nothing is indistinguishable from one that worked, which is
      how three dead rows survived being used.
    */
    const appLabel = form.app?.label ?? form.entry?.appLabel ?? 'That app'
    const declared =
      (form.app ? liveActions(form.app).some((a) => a.id === action.id) : false) || form.entry?.launcher.id === action.id
    if (!declared) {
      setSubmitError(`${appLabel} has not published this action, so there is nothing to send.`)
      return
    }
    const { parent, properties: typed } = splitSubmission(values)
    const { properties, contentFormat } = proseSubmission(action, typed)
    if (!parent) {
      setSubmitError('Choose where this should go before creating it.')
      return
    }
    // The pickers drop a retired topic's channel (FOL-26); a prefilled draft
    // does not go through a picker, so the same rule holds here too.
    if (parent.startsWith('39000:') && legacyTopicByChannel(parent.split(':')[2] ?? '')) {
      setSubmitError('That topic has moved to a file. Open it from Topics and write there.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    let result: Awaited<ReturnType<typeof applyAction>>
    try {
      // The parent is addressed, not named: `applyAction` resolves the manifest from the object —
      // or, for another app's creation on it, the manifest that declared it (MAN-8).
      result = await applyAction({
        naddr: addrToNaddr(parent, []),
        actionId: action.id,
        value: properties,
        ...(contentFormat ? { contentFormat } : {}),
        ...(action.declaredBy ? { declaredBy: action.declaredBy } : {}),
      })
    } catch (error) {
      setSubmitting(false)
      setSubmitError(error instanceof Error ? error.message : String(error))
      return
    }
    setSubmitting(false)
    if (!result.ok) {
      // The runtime's own words: it is the only participant that knows what the manifest allowed.
      setSubmitError(result.reason ?? 'The relay rejected it.')
      return
    }
    if (result.created) {
      let placed: boolean
      try {
        placed = insertReferenceIntoActiveComposer(addrToNaddr(result.created, []))
      } catch (error) {
        // The object WAS created, so "failed" would be a lie about the half that worked.
        setSubmitError(`Created, but its reference could not be encoded: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      // No composer is legitimate; a composer that was open and is gone is the trace going missing.
      if (!placed && context.composer) {
        setSubmitError('Created, but its reference could not be placed — the composer is gone.')
        return
      }
    }
    // A `listed` creation whose Folder command was refused (SPEC §7.3): the
    // object exists and its Folder does not show it, which is not a success.
    if (result.incomplete) {
      setSubmitError(`Created, but its folder does not list it yet: ${result.incomplete}`)
      return
    }
    const title = properties.title?.trim()
    // C5: say it worked, where the person is looking.
    showToast({ label: title ? `“${title}” created in ${appLabel}` : `Created in ${appLabel}`, type: 'success' })
    onClose()
  }

  // ── Rows ────────────────────────────────────────────────────────────────────

  const close = (then: () => void) => () => {
    then()
    onClose()
  }

  /*
    A file the person opened — a bare-file topic, a Ship issue — by its address
    and the title it had then (FOL-36, `lib/recents`). A bare file is Peek's
    own topic and gets the topic's icon; anything else is another app's object
    and is drawn as a file, since nothing here knows what it is.
  */
  const fileRow = (f: { id: string; title: string }, forget?: () => void): CommandPaletteRow => ({
    id: `file-${f.id}`,
    label: f.title,
    ...(f.id.startsWith(`${KIND_BARE_FILE}:`)
      ? { leading: <TopicState type="topic" status="unresolved" /> }
      : { icon: icon(IconFileText) }),
    onSelect: close(() => navigate(filePath(f.id, f.title))),
    onForget: forget,
  })

  const personRow = (p: Person, forget?: () => void): CommandPaletteRow => ({
    id: `person-${p.id}`,
    label: p.name,
    description: p.role,
    leading: <Avatar src={p.avatarSrc} name={p.name} size={24} />,
    onSelect: close(() => navigate(`/app/people/${encodeURIComponent(p.id)}`)),
    onForget: forget,
  })

  const appRow = (app: LauncherApp): CommandPaletteRow => ({
    id: `app-${app.id}`,
    label: app.label,
    // No count: it counted the registry's proposals, not what the app offers (R12).
    description: app.description,
    icon: appMark(app),
    onSelect: () => push({ kind: 'app', app }),
    onGoIn: () => push({ kind: 'app', app }),
  })

  const changeRowsFor = (list: typeof changeRows): CommandPaletteRow[] =>
    list.map(({ action }) => ({
      id: `change-${action.target}-${action.id}`,
      label: action.label,
      description: action.targetLabel,
      icon: icon(IconPencil),
      onSelect: () => push({ kind: 'form', action }),
    }))

  /** Ask, Draft and Make as rows — or, where the model could run but is not here yet, the offer to fetch it. */
  const intentRows = (typed: string): CommandPaletteRow[] => {
    if (!hasThread) return []
    if (modelDownloadable) {
      // INT-10: offered only once something is typed, so it is never a nag.
      if (!typed) return []
      const label =
        download === 'failed'
          ? 'This browser refused the model — asking is unavailable here'
          : typeof download === 'number'
            ? `Downloading the on-device model… ${download}%`
            : availability === 'downloading'
              ? 'The on-device model is downloading — show progress'
              : 'Download the on-device model to ask about conversations'
      return [
        {
          id: 'model-download',
          label,
          description:
            download === 'failed'
              ? undefined
              : typeof download === 'number'
                ? 'Keep working — this continues if you close the launcher.'
                : 'Several gigabytes, once per browser. It runs on this device; nothing is sent anywhere.',
          icon: icon(IconDownload),
          // The progress is on this row, and a person who asked for the download is owed sight of it.
          onSelect: () => download !== 'failed' && startDownload(),
        },
      ]
    }
    if (!modelReady) return []
    return [
      {
        id: 'ask',
        label: typed ? `Ask: “${typed}”` : 'Ask about this conversation',
        icon: icon(IconMessageQuestion),
        onSelect: () => openIntent('ask'),
      },
      // A draft needs somewhere to go.
      ...(context.composer
        ? [{ id: 'draft', label: typed ? `Draft a reply: “${typed}”` : 'Draft a reply', icon: icon(IconWriting), onSelect: () => openIntent('draft') }]
        : []),
      { id: 'propose', label: 'Suggest what to make from this conversation', icon: icon(IconSparkles), onSelect: () => openIntent('propose') },
    ]
  }

  const firstLevel = (): { groups: CommandPaletteGroup[]; pending?: string; notes: string[]; empty?: string } => {
    const typed = query.trim()

    if (!q) {
      /*
        Files take the three slots, in the order they were opened (FOL-36): a
        topic started since #194 is a bare file and opens on the file's page.
        A file carries its own title. A recent Convex topic has nothing to open
        since FOL-23 and is skipped.
      */
      const recentTopics = recents
        .flatMap((r) =>
          r.kind === 'file' && !(openFileRef && refNamesFile(openFileRef, r.id))
            ? [fileRow(r, () => forgetRecent({ kind: 'file', id: r.id }))]
            : [],
        )
        .slice(0, 3)
      const recentPeople = recents
        .filter((r) => r.kind === 'person' && r.id !== openPersonId)
        .flatMap((r) => (people ?? []).filter((p) => p.id === r.id))
        .slice(0, 2)
      const recentRows = [...recentTopics, ...recentPeople.map((p) => personRow(p, () => forgetRecent({ kind: 'person', id: p.id })))]
      return {
        groups: [
          { label: 'This conversation', rows: [...intentRows(''), ...changeRowsFor(changeRows)] },
          {
            label: 'Recent',
            rows: recentRows.length
              ? [...recentRows, { id: 'clear-recent', label: 'Clear recent', icon: icon(IconEraser), onSelect: clearRecents }]
              : [],
          },
          { label: 'Apps', rows: LAUNCHER_APPS.map(appRow) },
        ],
        notes: [],
      }
    }

    // An app whose name starts with what was typed goes first (R6).
    const apps = LAUNCHER_APPS.filter((a) => a.label.toLowerCase().startsWith(q)).map(appRow)
    // A word is a search, a sentence is a question (R5 C, C2).
    const sentence = wordCount(typed) >= 2
    const ask: CommandPaletteGroup = { label: 'Ask', rows: intentRows(typed) }
    const changes = changeRowsFor(
      changeRows.filter(({ action }) => action.label.toLowerCase().includes(q) || (action.targetLabel ?? '').toLowerCase().includes(q)),
    )
    const peopleHits = matchPeople(people ?? [], query).map((p) => personRow(p))
    // An app's action by its name: "add" finds "Add issue · Ship", and Enter opens its form (C4).
    const actionHits = probeable(LAUNCHER_APPS).flatMap((app) =>
      liveActions(app)
        .filter((a) => a.label.toLowerCase().includes(q))
        .map((action) => ({
          id: `action-${app.id}-${action.id}`,
          label: action.label,
          description: app.label,
          icon: icon(IconPencil),
          onSelect: () => push({ kind: 'app', app }, { kind: 'form', action, app }),
        })),
    )

    /*
      A message names its Folder on the `h` tag. The only channels whose talk
      has somewhere to open are an old topic's, which lands on the file its
      conversation moved to — the same table the old links redirect through
      (FOL-26); the Convex topic rows this joined on went in FOL-23. Any other
      hit is unroutable. Those are not rows; how many there were is said,
      because a silent cap reads as "that is all there was".

      A comment on a file names the file instead (FOL-36), and the file's page
      resolves the address on its own, so a comment is routable wherever the
      file is — its `h` is the team's channel, which is not where the comment
      is anyway.
    */
    const topicOf = (folder: string | undefined) => (folder ? legacyTopicByChannel(folder) : undefined)
    const routable = messageHits.filter((h) => h.file || topicOf(h.folder))
    const unroutable = messageHits.length - routable.length
    const messageRows = routable.slice(0, 5).map((hit): CommandPaletteRow => {
      const topic = hit.file ? undefined : topicOf(hit.folder)
      const who = directory?.[hit.pubkey]
      // The thread is the conversation, and a reply lands on itself once it is open (R13).
      const pending = hit.folder ? { folder: hit.folder, eventId: hit.root ?? hit.id, ...(hit.root ? { reply: hit.id } : {}) } : null
      return {
        id: `message-${hit.id}`,
        // Words, never markdown; the match in context, not the first 80 characters.
        label: snippetAround(asWords(hit.content), typed),
        description: [who?.displayName, hit.fileTitle ?? topic?.title, formatDateLabel(hit.createdAt * 1000)].filter(Boolean).join(' · '),
        leading: <Avatar src={who?.picture} name={who?.displayName} size={24} />,
        // The topic, at that message (R13) — the one-shot `ObjectPage` already uses;
        // or the file, with the thread open from the URL and the same one-shot for the scroll.
        onSelect: close(() => {
          if (pending) setPendingTopicMessage(pending)
          if (hit.file) navigate(`${filePath(hit.file, hit.fileTitle)}?thread=${encodeURIComponent(hit.root ?? hit.id)}`)
          else if (topic) navigate(channelDestination(topic.channel))
        }),
      }
    })

    const searching = messageState.kind === 'searching'
    const messageNote = searching ? null : messageEmptyState(messageState, query)
    const groups: CommandPaletteGroup[] = [
      { label: 'Apps', rows: apps },
      ...(sentence ? [ask] : []),
      { label: 'This conversation', rows: changes },
      { label: 'People', rows: peopleHits },
      { label: 'Actions', rows: actionHits },
      { label: 'Messages', rows: messageRows },
      ...(!sentence ? [ask] : []),
    ]
    const anyRows = groups.some((g) => g.rows.length > 0)
    return {
      groups,
      pending: searching ? 'Searching messages…' : undefined,
      notes: [
        // A plain "No messages matched" says nothing new beside rows that did match;
        // the whole-word hint does, mid-word, where a flat "none" would be wrong.
        ...(messageNote && !(anyRows && messageNote === 'No messages matched.') ? [messageNote] : []),
        ...(unroutable > 0 ? [`${unroutable} more in conversations not in your sidebar.`] : []),
      ],
      empty: !anyRows && !searching ? `Nothing is called “${typed}”. Try a person or an app.` : undefined,
    }
  }

  const appLevel = (app: LauncherApp): { groups: CommandPaletteGroup[]; pending?: string; empty?: string } => {
    const read = live[app.id]
    const actions = liveActions(app)
    const rows = actions
      .filter((a) => !q || a.label.toLowerCase().includes(q))
      .map((action) => ({ id: action.id, label: action.label, icon: icon(IconPencil), onSelect: () => push({ kind: 'form', action, app }) }))
    const loading = typeof app.parentKind === 'number' && (!read || read.state === 'loading')
    return {
      groups: [{ label: `${app.label} actions`, rows }],
      // Say what is happening rather than showing an empty section: a blank list
      // reads as "this app offers nothing", which is a different and wrong statement.
      pending: loading ? `Reading ${app.label}’s manifest…` : undefined,
      empty: loading
        ? undefined
        : read?.state === 'failed'
          ? `Could not read ${app.label}’s manifest — its actions are unavailable.`
          : actions.length === 0
            ? `${app.label} has not published anything to create here yet.`
            : `${app.label} has no action called “${query.trim()}”.`,
    }
  }

  const intentLevel = (intent: Intent): { groups: CommandPaletteGroup[]; body: React.ReactNode } => {
    const typed = query.trim()
    const changed = intent !== 'propose' && typed !== '' && typed !== request?.text
    const askAgain: CommandPaletteRow[] = changed
      ? [
          {
            id: 'again',
            label: intent === 'ask' ? `Ask: “${typed}”` : `Write a draft: “${typed}”`,
            icon: icon(request ? IconRefresh : intent === 'ask' ? IconMessageQuestion : IconWriting),
            onSelect: () => setRequest({ intent, text: typed }),
          },
        ]
      : []
    const againLabel = intent === 'ask' ? (request ? 'Ask again' : 'Ask') : request ? 'Write again' : 'Draft'

    if (intent === 'ask') {
      const body =
        !request ? (
          <FieldLine>Type a question, then press Enter.</FieldLine>
        ) : answer === null ? (
          <CommandPaletteWorking>Reading the thread…</CommandPaletteWorking>
        ) : answer === false ? (
          <FieldLine>No answer came back. Edit the question and press Enter to try again.</FieldLine>
        ) : (
          <div data-testid="answer">
          <CommandPaletteAnswer
            note={
              [
                changed ? 'You changed the question. Press Enter to ask again.' : null,
                answer.byRecency
                  ? 'Nothing here matched the question, so the most recent messages were read instead.'
                  : answer.omitted > 0
                    ? `${answer.omitted} earlier ${answer.omitted === 1 ? 'message' : 'messages'} did not fit and ${answer.omitted === 1 ? 'was' : 'were'} not read.`
                    : null,
                answer.repliesNotRead > 0
                  ? `${answer.repliesNotRead} ${answer.repliesNotRead === 1 ? 'reply was' : 'replies were'} not read — open a conversation to ask about its replies.`
                  : null,
                unreachable ? 'That message is not loaded in the thread — scroll up to load earlier messages.' : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            {answer.text}
          </CommandPaletteAnswer>
          </div>
        )
      const sources: CommandPaletteRow[] =
        answer && request
          ? answer.sources.map(({ n, message }) => ({
              id: `source-${message.id}`,
              label: asWords(message.body),
              description: `[${n}] ${message.author} · ${message.timestamp}`,
              leading: <Avatar name={message.author} size={24} />,
              onSelect: () => {
                // Scroll first, close second: a cited message can sit above the loaded window.
                if (scrollToMessage(message.id)) {
                  onClose()
                  return
                }
                // Not on screen: a topic-wide answer cites across conversations (INT-8).
                if (message.conversationId && openConversation(message.conversationId)) {
                  onClose()
                  void scrollToMessageWhenReady(message.id)
                  return
                }
                setUnreachable(message.id)
              },
            }))
          : []
      const next: CommandPaletteRow[] =
        answer && request && context.composer
          ? [
              {
                id: 'answer-to-composer',
                label: 'Put the answer in the composer',
                description: 'It will not send. Edit it first.',
                icon: icon(IconCornerDownLeft),
                onSelect: close(() => insertTextIntoActiveComposer(answer.text.replace(/\s*\[\d+\]/g, ''))),
              },
            ]
          : []
      return {
        body,
        groups: [
          { label: againLabel, rows: askAgain },
          { label: sources.length === 1 ? 'Source' : 'Sources', rows: sources },
          { label: 'Next', rows: next },
        ],
      }
    }

    if (intent === 'draft') {
      const body = !request ? (
        <FieldLine>Say what the reply should say, then press Enter.</FieldLine>
      ) : draft === null ? (
        <CommandPaletteWorking>Writing a draft…</CommandPaletteWorking>
      ) : draft === false ? (
        <FieldLine>No draft came back. Edit what it should say and press Enter to try again.</FieldLine>
      ) : (
        // Shown before it goes anywhere: seeing it first costs nothing.
        <div data-testid="draft">
          <CommandPaletteQuote>{draft}</CommandPaletteQuote>
        </div>
      )
      const next: CommandPaletteRow[] =
        typeof draft === 'string' && request
          ? [
              {
                id: 'draft-to-composer',
                label: 'Put it in the composer',
                description: 'It will not send. Edit it first.',
                icon: icon(IconCornerDownLeft),
                // At the cursor, never replacing, and never sending.
                onSelect: close(() => insertTextIntoActiveComposer(draft)),
              },
              { id: 'draft-again', label: 'Write it again', icon: icon(IconRefresh), onSelect: () => setRequest({ ...request }) },
            ]
          : []
      return { body, groups: [{ label: againLabel, rows: askAgain }, { label: 'Next', rows: next }] }
    }

    // Make — about the conversation rather than the words.
    const body =
      proposal === null ? (
        <CommandPaletteWorking>Reading the conversation and what apps can create…</CommandPaletteWorking>
      ) : proposal === false ? (
        <FieldLine>Nothing here matches what any app offers to make.</FieldLine>
      ) : (
        // Which app, always: two apps may declare something plausibly matching.
        // The palette's own part since UIG-40 (ruling P4), drawn as it was.
        <div data-testid="proposal">
          <CommandPaletteProposal source={`${proposal.entry.appLabel} › ${proposal.entry.launcher.label}`} mark={appMark({ id: proposal.entry.appId }, 10)}>
            {proposal.preview}
          </CommandPaletteProposal>
        </div>
      )
    const next: CommandPaletteRow[] = [
      ...(proposal
        ? [
            {
              id: 'make-open',
              label: 'Open the form',
              description: `${proposal.entry.appLabel} › ${proposal.entry.launcher.label} · nothing is created until you submit`,
              icon: icon(IconPencil),
              // Opens the form; it does not publish. The model proposed and a person submits.
              onSelect: () => push({ kind: 'form', action: proposal.entry.launcher, entry: proposal.entry }),
            },
          ]
        : []),
      ...(proposal !== null
        ? [{ id: 'make-again', label: 'Suggest something else', icon: icon(IconRefresh), onSelect: () => setRequest({ intent: 'propose', text: '' }) }]
        : []),
    ]
    return { body, groups: [{ label: 'Next', rows: next }] }
  }

  // ── The level on screen ─────────────────────────────────────────────────────

  const modKey = isApplePlatform() ? 'Cmd' : 'Ctrl'
  const where = whereFrom(context)

  const content = (() => {
    if (level.kind === 'form' && formDraft) {
      const { action, app, entry } = level
      const vocabularies = action.target
        ? changeRows.find((r) => r.action.target === action.target && r.action.id === action.id)?.vocabularies
        : entry?.vocabularies
      const owner = app?.label ?? entry?.appLabel
      const chip: CommandPaletteChip = { label: `${action.targetLabel ?? owner ?? ''} · ${action.label}`, onBack: back }
      /*
        A change that changes nothing waits, and says why (F4). The field holds
        the value the object has now until somebody picks another.
      */
      const field = action.target ? action.fields[0] : undefined
      const unchanged = field && draftValues(action, formDraft)[field.key] === (field.defaultValue ?? '')
      const key = formKey(level)
      return (
        <CommandPaletteForm
          chip={chip}
          icon={action.target ? icon(IconPencil) : appMark({ id: app?.id ?? entry?.appId ?? '' }, 16)}
          submitLabel={action.submitLabel}
          onSubmit={() => {
            setAttempted((a) => ({ ...a, [key]: true }))
            if (Object.keys(missingFields(action, formDraft)).length > 0) return
            void submitAction(level, draftValues(action, formDraft))
          }}
          submitWaits={unchanged && field ? `Choose a different ${field.label.toLowerCase()} first` : undefined}
          working={
            submitting
              ? action.target
                ? { button: 'Saving…', line: `Saving to ${action.targetLabel ?? 'it'}…` }
                : { button: 'Creating…', line: `Creating it in ${owner ?? 'the app'}…` }
              : undefined
          }
          error={submitError ?? undefined}
        >
          <ActionFormFields
            app={app}
            action={action}
            vocabularies={vocabularies}
            parentOptions={parentOptionsFor(level)}
            draft={formDraft}
            onDraft={setFormDraft}
            missing={attempted[key] ? missingFields(action, formDraft) : undefined}
          />
        </CommandPaletteForm>
      )
    }

    if (level.kind === 'app') {
      const { groups, pending, empty } = appLevel(level.app)
      return (
        <CommandPaletteSearch
          query={query}
          onQueryChange={setQuery}
          placeholder={level.app.placeholder}
          groups={groups}
          chip={{ label: level.app.label, leading: appMark(level.app, 16), onBack: back }}
          pending={pending}
          empty={empty}
        />
      )
    }

    if (level.kind === 'ai') {
      const { groups, body } = intentLevel(level.intent)
      const Glyph = level.intent === 'ask' ? IconMessageQuestion : level.intent === 'draft' ? IconWriting : IconSparkles
      return (
        <CommandPaletteSearch
          query={query}
          onQueryChange={setQuery}
          placeholder={
            level.intent === 'ask'
              ? `Ask anything about ${context.composer?.label ?? 'this conversation'}`
              : level.intent === 'draft'
                ? 'What should the reply say?'
                : 'Looking at the conversation'
          }
          groups={groups}
          // The mode only; the field keeps the sentence (R9).
          chip={{ label: level.intent === 'ask' ? 'Ask' : level.intent === 'draft' ? 'Draft' : 'Make', leading: <Glyph size={16} stroke={1.5} />, onBack: back }}
        >
          {body}
        </CommandPaletteSearch>
      )
    }

    const { groups, pending, notes, empty } = firstLevel()
    return (
      <CommandPaletteSearch
        query={query}
        onQueryChange={setQuery}
        placeholder={hasThread ? 'Search, or ask about this conversation' : 'Search Peek, or choose an app'}
        groups={groups}
        pending={pending}
        notes={notes}
        empty={empty}
      />
    )
  })()

  return (
    <CommandPalette open onOpenChange={(open) => !open && onClose()} label="Launcher" where={where} modKey={modKey}>
      {content}
    </CommandPalette>
  )
}
