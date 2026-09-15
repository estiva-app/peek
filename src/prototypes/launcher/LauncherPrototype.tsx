/*
  UIG-29 launcher prototype — a design proposal to click through, not the build.

  Built the way Base UI's own command palette is built: Dialog + Autocomplete
  with its list inline. Peek's parts draw it (MenuItem rows, SectionLabel,
  TopicState, Avatar, Kbd, InputChip, EmptyState, Field, Select).

  It imports Base UI directly, which Peek code must not do: it is the design
  reference while the package's `CommandPalette` is built (Katerina, 16
  September), and it is deleted when the real launcher replaces it.

  The behaviour is the review's advice line (R1 A · R2–R4 yes · R5 C · R6–R10
  yes · R11 A · R12–R14 yes · R15 B) plus Katerina's notes on the screenshots:
  a visible "creating" state, a widget in the composer instead of raw naddr,
  messages as words, topics with their real icon.
*/
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Autocomplete } from '@base-ui/react/autocomplete'
import {
  IconChevronRight,
  IconLoader2,
  IconMessageQuestion,
  IconPencil,
  IconSearch,
  IconSparkles,
  IconWriting,
  IconArrowBackUp,
  IconCornerDownLeft,
  IconRefresh,
} from '@tabler/icons-react'
import { EmptyState, EnterHint, FieldLine, InputChip, Kbd, MenuItem, ScrollArea } from '@estiva-app/ui'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { PeekLogoMark } from '@/components/ui/PeekLogo'
import { SectionLabel } from '@/components/ui/SectionHeader'
import { Select } from '@/components/ui/Select'
import { ShipLogoMark } from '@/components/ui/ShipLogo'
import { TextInput } from '@/components/ui/TextInput'
import { Textarea } from '@/components/ui/Textarea'
import { TopicState } from '@/components/ui/TopicState'
import { previewText } from '@/lib/textParsing'
import { cn } from '@/lib/utils'
import {
  ANSWERS,
  APPS,
  ISSUE_STATUSES,
  MESSAGES,
  PEOPLE,
  RECENT,
  THREAD,
  THREAD_ISSUE,
  TOPICS,
  type ProtoApp,
} from './data'

// ── What the launcher was opened on ─────────────────────────────────────────

export interface ProtoContext {
  /** Where it was opened: nowhere, reading a topic, or writing a reply. */
  from: 'nowhere' | 'topic' | 'reply'
  /** How the footer names it: "#Feedback on the launcher", "Replying to Amie". */
  label?: string
}

type Mode = 'ask' | 'draft' | 'make'

type Level =
  | { kind: 'home' }
  | { kind: 'app'; appId: ProtoApp['id'] }
  | { kind: 'ai'; mode: Mode }
  | { kind: 'form'; appId: 'ship'; actionId: string }
  | { kind: 'change' }

interface Frame {
  level: Level
  query: string
}

interface Row {
  id: string
  label: string
  description?: string
  leading?: ReactNode
  trailing?: ReactNode
  /** Tab or → (at the end of the text) goes in. */
  into?: () => void
  run: () => void
}

interface Group {
  value: string
  items: Row[]
}

interface IssueDraft {
  title: string
  description: string
  status: string
  parent: string
}

const EMPTY_DRAFT: IssueDraft = { title: '', description: '', status: 'todo', parent: '' }

export interface LauncherPrototypeProps {
  context: ProtoContext
  open: boolean
  onOpenChange: (open: boolean) => void
  /** An issue was created: the page shows it as a widget and an activity line. */
  onCreated: (issue: { key: string; title: string }) => void
  /** Text for the composer (a draft, an answer). */
  onInsert: (text: string) => void
  /** A result was opened: the page shows where it went. */
  onNavigate: (where: string) => void
  /** Relay and model answers take longer, as against production. */
  slow?: boolean
  /** Ship refuses the new issue. */
  failCreate?: boolean
  /**
   * Esc steps back one level and closes only from the first, as Raycast does
   * by default (manual.raycast.com/keyboard-shortcuts). Off: Esc always
   * closes, Katerina's ruling of 31 August.
   */
  escGoesBack?: boolean
}

/** Every row leads with the same 32px tile, so icons, faces and topics line up. */
const icon = (Glyph: typeof IconSearch) => (
  <span className="flex size-8 items-center justify-center rounded-sm bg-bg-inset">
    <Glyph size={16} stroke={1.5} className="text-text-secondary" />
  </span>
)

function appTile(app: ProtoApp) {
  return (
    <span className="flex size-8 items-center justify-center rounded-sm bg-bg-inset">
      {app.id === 'ship' ? <ShipLogoMark height={14} /> : <PeekLogoMark height={14} />}
    </span>
  )
}

/** A stored body as one line of words: markdown gone, a heading's marker gone. */
function asWords(body: string) {
  return previewText(body.replace(/^#{1,6}\s+/gm, '')).replace(/\s*\n+\s*/g, ' ').trim()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function LauncherPrototype({
  context,
  open,
  onOpenChange,
  onCreated,
  onInsert,
  onNavigate,
  slow = false,
  failCreate = false,
  escGoesBack = false,
}: LauncherPrototypeProps) {
  const HOME: Frame = { level: { kind: 'home' }, query: '' }
  const [stack, setStack] = useState<Frame[]>([HOME])
  const frame = stack[stack.length - 1]
  const level = frame.level
  const hasThread = context.from !== 'nowhere'
  const canReply = context.from === 'reply' || context.from === 'topic'
  const inputRef = useRef<HTMLInputElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState<Row | undefined>()

  // A fresh launcher every time it opens.
  useEffect(() => {
    if (open) setStack([HOME])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const setQuery = (query: string) => setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], query }])
  const push = (next: Level, query = '') => setStack((s) => [...s, { level: next, query }])
  const back = () => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // ── Message search: arrives later, as the relay does ──────────────────────
  const term = level.kind === 'home' ? frame.query.trim().toLowerCase() : ''
  const [searched, setSearched] = useState<string>('')
  useEffect(() => {
    if (!term) return
    const timer = setTimeout(() => setSearched(term), slow ? 1500 : 500)
    return () => clearTimeout(timer)
  }, [term, slow])
  const searching = !!term && searched !== term

  // ── Ask / Draft / Make ─────────────────────────────────────────────────────
  const [asked, setAsked] = useState<{ mode: Mode; question: string; state: 'thinking' | 'done' } | null>(null)
  const startAI = async (mode: Mode, question: string) => {
    setAsked({ mode, question, state: 'thinking' })
    await wait(slow ? 2600 : 1200)
    setAsked((a) => (a && a.mode === mode && a.question === question ? { ...a, state: 'done' } : a))
  }
  const openAI = (mode: Mode) => {
    const question = level.kind === 'home' ? frame.query.trim() : ''
    push({ kind: 'ai', mode }, question)
    setAsked(null)
    if (mode === 'make' || question) void startAI(mode, question)
  }

  /*
    Picking a row with Enter removes that row from the list, and the dialog
    then gives focus to itself: every key after it went nowhere (measured). A
    list level keeps its keys in the field.
  */
  useEffect(() => {
    if (level.kind === 'form' || level.kind === 'change') return
    const frameId = requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body || active === popupRef.current) inputRef.current?.focus()
    })
    return () => cancelAnimationFrame(frameId)
  }, [stack, asked, level.kind])

  // ── Forms keep what was typed until the launcher closes (R1 A) ────────────
  const [drafts, setDrafts] = useState<Record<string, IssueDraft>>({})
  useEffect(() => {
    if (!open) setDrafts({})
  }, [open])

  const close = () => onOpenChange(false)

  // ── The rows for the current level ────────────────────────────────────────
  const groups = useMemo<Group[]>(() => {
    const q = frame.query.trim().toLowerCase()
    const words = q.split(/\s+/).filter(Boolean).length

    if (level.kind === 'app') {
      const app = APPS.find((a) => a.id === level.appId)!
      return [
        {
          value: `${app.name} actions`,
          items: app.actions
            .filter((a) => !q || a.label.toLowerCase().includes(q))
            .map((a) => ({
              id: `${app.id}-${a.id}`,
              label: a.label,
              description: a.description,
              leading: icon(IconPencil),
              run: () => push({ kind: 'form', appId: 'ship', actionId: a.id }),
            })),
        },
      ].filter((g) => g.items.length > 0)
    }

    if (level.kind === 'ai') {
      if (!asked || asked.state !== 'done') return []
      const edited = frame.query.trim() !== asked.question && level.mode !== 'make'
      const again: Row[] = edited
        ? [{
            id: 'again',
            label: level.mode === 'ask' ? `Ask: “${frame.query.trim()}”` : `Write a draft: “${frame.query.trim()}”`,
            leading: icon(IconRefresh),
            run: () => void startAI(level.mode, frame.query.trim()),
          }]
        : []
      if (level.mode === 'ask') {
        const sources = ANSWERS.ask.sources.map((id, i) => {
          const m = THREAD.find((t) => t.id === id)!
          return {
            id: `source-${id}`,
            label: asWords(m.body),
            description: `[${i + 1}] ${m.author} · ${m.time}`,
            leading: <Avatar name={m.author} size={20} />,
            run: () => {
              onNavigate(`the message from ${m.author} at ${m.time}`)
              close()
            },
          }
        })
        return [
          ...(edited ? [{ value: 'Ask again', items: again }] : []),
          { value: 'Sources', items: sources },
          {
            value: 'Next',
            items: canReply
              ? [{
                  id: 'answer-to-composer',
                  label: 'Put the answer in the composer',
                  leading: icon(IconCornerDownLeft),
                  run: () => {
                    onInsert(ANSWERS.ask.paragraphs.join(' ').replace(/\s*\[\d\]/g, ''))
                    close()
                  },
                }]
              : [],
          },
        ].filter((g) => g.items.length > 0)
      }
      if (level.mode === 'draft') {
        return [
          ...(edited ? [{ value: 'Write again', items: again }] : []),
          {
            value: 'Next',
            items: [
              { id: 'draft-to-composer', label: 'Put it in the composer', description: 'It will not send. Edit it first.', leading: icon(IconCornerDownLeft), run: () => { onInsert(ANSWERS.draft); close() } },
              { id: 'draft-again', label: 'Write it again', leading: icon(IconRefresh), run: () => void startAI('draft', asked.question) },
            ],
          },
        ]
      }
      return [
        {
          value: 'Next',
          items: [
            {
              id: 'make-open',
              label: 'Open the form',
              description: `${ANSWERS.make.app} › ${ANSWERS.make.action} · nothing is created until you submit`,
              leading: icon(IconPencil),
              run: () => {
                setDrafts((d) => ({ ...d, 'add-issue': { ...EMPTY_DRAFT, ...(d['add-issue'] ?? {}), ...ANSWERS.make.prefill } }))
                push({ kind: 'form', appId: 'ship', actionId: 'add-issue' })
              },
            },
            { id: 'make-again', label: 'Suggest something else', leading: icon(IconRefresh), run: () => void startAI('make', '') },
          ],
        },
      ]
    }

    // ── home ──
    const threadRows: Row[] = hasThread
      ? [
          { id: 'ask', label: q ? `Ask: “${frame.query.trim()}”` : 'Ask about this conversation', leading: icon(IconMessageQuestion), run: () => openAI('ask') },
          ...(canReply
            ? [{ id: 'draft', label: q ? `Draft a reply: “${frame.query.trim()}”` : 'Draft a reply', leading: icon(IconWriting), run: () => openAI('draft') }]
            : []),
          { id: 'make', label: 'Suggest what to make from this conversation', leading: icon(IconSparkles), run: () => openAI('make') },
        ]
      : []
    const changeRow: Row = {
      id: 'change',
      label: 'Set status',
      description: `${THREAD_ISSUE.key} · ${THREAD_ISSUE.title}`,
      leading: icon(IconPencil),
      run: () => push({ kind: 'change' }),
    }

    const appRow = (app: ProtoApp): Row => ({
      id: `app-${app.id}`,
      label: app.name,
      description: app.description,
      leading: appTile(app),
      trailing: <IconChevronRight size={16} stroke={1.5} className="text-text-muted" />,
      run: () => push({ kind: 'app', appId: app.id }),
      into: () => push({ kind: 'app', appId: app.id }),
    })
    const topicRow = (t: (typeof TOPICS)[number]): Row => ({
      id: `topic-${t.id}`,
      label: t.title,
      description: t.resolved ? `Resolved · ${t.active}` : t.active,
      leading: <span className="flex size-8 items-center justify-center"><TopicState type="topic" status={t.resolved ? 'resolved' : 'unresolved'} /></span>,
      run: () => { onNavigate(`#${t.title}`); close() },
    })
    const personRow = (p: (typeof PEOPLE)[number]): Row => ({
      id: `person-${p.id}`,
      label: p.name,
      description: p.role,
      leading: <span className="flex size-8 items-center justify-center"><Avatar name={p.name} size={24} /></span>,
      run: () => { onNavigate(p.name); close() },
    })

    if (!q) {
      return [
        { value: 'This conversation', items: hasThread ? [...threadRows, changeRow] : [] },
        {
          value: 'Recent',
          items: [
            ...RECENT.topics.map((id) => topicRow(TOPICS.find((t) => t.id === id)!)),
            ...RECENT.people.map((id) => personRow(PEOPLE.find((p) => p.id === id)!)),
          ],
        },
        { value: 'Apps', items: APPS.map(appRow) },
      ].filter((g) => g.items.length > 0)
    }

    const apps = APPS.filter((a) => a.name.toLowerCase().startsWith(q)).map(appRow)
    const actions = APPS.flatMap((app) =>
      app.actions
        .filter((a) => a.label.toLowerCase().includes(q))
        .map((a) => ({
          id: `action-${a.id}`,
          label: a.label,
          description: app.name,
          leading: icon(IconPencil),
          run: () => {
            setStack((s) => [...s, { level: { kind: 'app', appId: app.id }, query: '' }, { level: { kind: 'form', appId: 'ship', actionId: a.id }, query: '' }])
          },
        })),
    )
    const topics = TOPICS.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 5).map(topicRow)
    const people = PEOPLE.filter((p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)).slice(0, 5).map(personRow)
    const messages = searching
      ? []
      : MESSAGES.filter((m) => asWords(m.body).toLowerCase().includes(q)).slice(0, 5).map((m) => {
          const topic = TOPICS.find((t) => t.id === m.topicId)!
          return {
            id: `message-${m.id}`,
            label: asWords(m.body),
            description: `${m.author} · ${topic.title} · ${m.time}`,
            leading: <span className="flex size-8 items-center justify-center"><Avatar name={m.author} size={24} /></span>,
            run: () => { onNavigate(`the message in #${topic.title}`); close() },
          }
        })
    const change = hasThread && ('set status'.includes(q) || THREAD_ISSUE.title.toLowerCase().includes(q)) ? [changeRow] : []
    const ask = { value: 'Ask', items: threadRows }
    const sentence = words >= 2

    return [
      { value: 'Apps', items: apps },
      ...(sentence ? [ask] : []),
      { value: 'This conversation', items: change },
      { value: 'Topics', items: topics },
      { value: 'People', items: people },
      { value: 'Actions', items: actions },
      { value: 'Messages', items: messages },
      ...(!sentence ? [ask] : []),
    ].filter((g) => g.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, level, asked, searching, hasThread, canReply])

  const rowCount = groups.reduce((n, g) => n + g.items.length, 0)

  // ── Keys the list level adds to Base UI's ─────────────────────────────────
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    const atEnd = el.selectionStart === el.value.length
    if (e.key === 'Backspace' && atStart && stack.length > 1) {
      // R8: at the very start, Backspace steps back and keeps the text.
      e.preventDefault()
      back()
      return
    }
    if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && atEnd)) {
      if (highlighted?.into) {
        e.preventDefault()
        highlighted.into()
      } else if (e.key === 'Tab') {
        e.preventDefault()
      }
      return
    }
    if (e.key === 'Enter' && level.kind === 'ai' && rowCount === 0 && frame.query.trim() && level.mode !== 'make') {
      e.preventDefault()
      void startAI(level.mode, frame.query.trim())
    }
  }

  // ── Top row ────────────────────────────────────────────────────────────────
  const chip = (() => {
    if (level.kind === 'app') {
      const app = APPS.find((a) => a.id === level.appId)!
      return <InputChip label={app.name} leading={app.id === 'ship' ? <ShipLogoMark height={10} /> : <PeekLogoMark height={10} />} onRemove={back} />
    }
    if (level.kind === 'ai') {
      const Glyph = level.mode === 'ask' ? IconMessageQuestion : level.mode === 'draft' ? IconWriting : IconSparkles
      const label = level.mode === 'ask' ? 'Ask' : level.mode === 'draft' ? 'Draft' : 'Make'
      return <InputChip label={label} leading={<Glyph size={12} stroke={1.5} className="text-text-secondary" />} onRemove={back} />
    }
    return null
  })()

  const placeholder =
    level.kind === 'app'
      ? `Search ${APPS.find((a) => a.id === level.appId)!.name}'s actions`
      : level.kind === 'ai'
        ? level.mode === 'ask'
          ? `Ask anything about ${context.label ?? 'this conversation'}`
          : level.mode === 'draft'
            ? 'What should the reply say?'
            : 'Looking at the conversation'
        : hasThread
          ? 'Search, or ask about this conversation'
          : 'Search Peek, or choose an app'

  // ── Footer: where you are, and the keys that work here ────────────────────
  const keys: [string, string][] =
    level.kind === 'form' || level.kind === 'change'
      ? [['Ctrl+Enter', level.kind === 'form' ? 'add issue' : 'set status'], escGoesBack ? ['Esc', 'back'] : ['Backspace', 'back'], ...(escGoesBack ? [] : ([['Esc', 'close']] as [string, string][]))]
      : [
          ['↑↓', 'move'],
          [highlighted?.into ? 'Tab' : 'Enter', highlighted?.into ? 'go in' : 'open'],
          ...(stack.length > 1 && !escGoesBack ? ([['Backspace', 'back']] as [string, string][]) : []),
          ['Esc', escGoesBack && stack.length > 1 ? 'back' : 'close'],
        ]

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && escGoesBack && details.reason === 'escape-key' && stack.length > 1) {
          back()
          return
        }
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]">
          <Dialog.Popup
            ref={popupRef}
            aria-label="Launcher"
            onFocus={(e) => {
              // The dialog took focus from a row that just left the list: give it to this level's first control.
              if (e.target !== popupRef.current) return
              if (level.kind === 'form' || level.kind === 'change') {
                popupRef.current?.querySelector<HTMLElement>('input:not([tabindex="-1"]), textarea, [role="combobox"]')?.focus()
              } else {
                inputRef.current?.focus()
              }
            }}
            initialFocus={() => popupRef.current?.querySelector<HTMLElement>('input, textarea, [role="combobox"]') ?? true}
            className="flex w-[658px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-border-default bg-bg-elevated shadow-lg outline-none"
          >
            {level.kind === 'form' ? (
              <IssueForm
                key={`form-${stack.length}`}
                draft={drafts['add-issue'] ?? EMPTY_DRAFT}
                onDraft={(d) => setDrafts((all) => ({ ...all, 'add-issue': d }))}
                onBack={back}
                onCreated={(issue) => { onCreated(issue); close() }}
                slow={slow}
                failCreate={failCreate}
              />
            ) : level.kind === 'change' ? (
              <ChangeForm onBack={back} onDone={() => { onNavigate(`${THREAD_ISSUE.key} set to a new status`); close() }} slow={slow} />
            ) : (
              <Autocomplete.Root
                items={groups}
                mode="none"
                inline
                open
                value={frame.query}
                onValueChange={(value, details) => {
                  // Picking a row must not write the row's name into the field.
                  if (details.reason === 'item-press') return
                  setQuery(value)
                }}
                itemToStringValue={(row) => (row as Row).label}
                autoHighlight="always"
                keepHighlight
                loopFocus={false}
                onItemHighlighted={(row) => setHighlighted(row as Row | undefined)}
              >
                <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
                  <IconSearch size={16} stroke={1.5} className="shrink-0 text-text-secondary" />
                  {chip}
                  <Autocomplete.Input
                    ref={inputRef}
                    placeholder={placeholder}
                    onKeyDown={onInputKeyDown}
                    className="min-w-0 flex-1 bg-transparent text-input-value text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>

                <ScrollArea viewportClassName="max-h-[420px]" contentClassName="p-1">
                  {level.kind === 'ai' && <AIBody mode={level.mode} asked={asked} question={frame.query.trim()} />}

                  <Autocomplete.List>
                    {(group: Group) => (
                      <Autocomplete.Group key={group.value} items={group.items}>
                        <Autocomplete.GroupLabel className="flex h-7 items-center px-3">
                          <SectionLabel>{group.value}</SectionLabel>
                        </Autocomplete.GroupLabel>
                        <Autocomplete.Collection>
                          {(row: Row) => (
                            <Autocomplete.Item
                              key={row.id}
                              value={row}
                              nativeButton
                              onClick={() => row.run()}
                              render={
                                <MenuItem
                                  size="tall"
                                  leading={row.leading}
                                  label={row.label}
                                  description={row.description}
                                  trailing={row.trailing}
                                  hint={row.into ? <Kbd>Tab</Kbd> : <EnterHint />}
                                />
                              }
                            />
                          )}
                        </Autocomplete.Collection>
                      </Autocomplete.Group>
                    )}
                  </Autocomplete.List>

                  {level.kind === 'home' && searching && (
                    <Autocomplete.Status className="flex h-8 items-center gap-2 px-3">
                      <IconLoader2 size={12} stroke={1.5} className="animate-spin text-text-muted" />
                      <span className="text-caption text-text-muted">Searching messages…</span>
                    </Autocomplete.Status>
                  )}
                  {level.kind === 'home' && frame.query.trim() && !searching && rowCount === 0 && (
                    <div className="px-3 py-3">
                      <EmptyState scope="section" message={`Nothing is called “${frame.query.trim()}”. Try a topic, a person or an app.`} />
                    </div>
                  )}
                  {level.kind === 'app' && rowCount === 0 && (
                    <div className="px-3 py-3">
                      <EmptyState
                        scope="section"
                        message={
                          frame.query.trim()
                            ? `${APPS.find((a) => a.id === level.appId)!.name} has no action called “${frame.query.trim()}”.`
                            : `${APPS.find((a) => a.id === level.appId)!.name} doesn't offer anything to create here yet.`
                        }
                      />
                    </div>
                  )}
                </ScrollArea>
              </Autocomplete.Root>
            )}

            <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border-subtle px-4 text-caption text-text-secondary signal:font-mono signal:text-small signal:text-text-muted">
              <span className="min-w-0 flex-1 truncate">
                {context.label ? `In ${context.label}` : 'Anywhere in Peek'}
              </span>
              {keys.map(([k, word]) => (
                <span key={k} className="flex shrink-0 items-center gap-1.5">
                  <Kbd>{k}</Kbd> {word}
                </span>
              ))}
            </div>
            <Dialog.Title className="sr-only">Launcher</Dialog.Title>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Ask / Draft / Make: the result above the rows ──────────────────────────

function AIBody({ mode, asked, question }: { mode: Mode; asked: { mode: Mode; question: string; state: string } | null; question: string }) {
  if (!asked) {
    return (
      <div className="px-3 py-3">
        <p className="text-caption text-text-muted">
          {mode === 'ask' ? 'Type a question, then press Enter.' : 'Say what the reply should say, then press Enter.'}
        </p>
      </div>
    )
  }
  if (asked.state === 'thinking') {
    return (
      <div role="status" className="flex flex-col gap-2 px-3 py-3">
        <span className="flex items-center gap-2 text-caption text-text-secondary">
          <IconLoader2 size={14} stroke={1.5} className="animate-spin" />
          {mode === 'make' ? 'Reading the conversation and what apps can create…' : `Reading ${THREAD.length} messages…`}
        </span>
        <span className="h-3 w-4/5 animate-pulse rounded-sm bg-bg-inset" />
        <span className="h-3 w-3/5 animate-pulse rounded-sm bg-bg-inset" />
      </div>
    )
  }
  if (mode === 'ask') {
    return (
      <div className="flex flex-col gap-2 px-3 pb-2 pt-3">
        {ANSWERS.ask.paragraphs.map((p) => (
          <p key={p} className="text-body-2 text-text-primary">
            {p.split(/(\[\d\])/).map((part, i) =>
              /^\[\d\]$/.test(part) ? (
                <sup key={i} className="ml-0.5 font-mono text-small text-accent-primary">{part.slice(1, -1)}</sup>
              ) : (
                part
              ),
            )}
          </p>
        ))}
        {question !== asked.question && <FieldLine>You changed the question. Press Enter to ask again.</FieldLine>}
      </div>
    )
  }
  if (mode === 'draft') {
    return (
      <div className="px-3 pb-2 pt-3">
        <p className="border-l-2 border-border-default pl-3 text-body-2 text-text-primary">{ANSWERS.draft}</p>
      </div>
    )
  }
  return (
    <div className="px-3 pb-2 pt-3">
      <div className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-surface p-3">
        <span className="flex items-center gap-2 text-caption text-text-secondary">
          <ShipLogoMark height={10} /> {ANSWERS.make.app} › {ANSWERS.make.action}
        </span>
        <p className="text-body-2 text-text-primary">{ANSWERS.make.preview}</p>
      </div>
    </div>
  )
}

// ── Create: Ship › Add issue ────────────────────────────────────────────────

function IssueForm({
  draft,
  onDraft,
  onBack,
  onCreated,
  slow,
  failCreate,
}: {
  draft: IssueDraft
  onDraft: (d: IssueDraft) => void
  onBack: () => void
  onCreated: (issue: { key: string; title: string }) => void
  slow: boolean
  failCreate: boolean
}) {
  const ship = APPS.find((a) => a.id === 'ship')!
  const [state, setState] = useState<'editing' | 'creating' | 'failed'>('editing')
  const [missing, setMissing] = useState<{ title?: string; parent?: string }>({})
  const formRef = useRef<HTMLDivElement>(null)
  const set = (patch: Partial<IssueDraft>) => onDraft({ ...draft, ...patch })

  const submit = async () => {
    const need = {
      title: draft.title.trim() ? undefined : 'Give the issue a title.',
      parent: draft.parent ? undefined : `Choose a ${ship.parentNoun!.toLowerCase()}.`,
    }
    setMissing(need)
    if (need.title || need.parent) {
      formRef.current?.querySelector<HTMLElement>(need.title ? 'input' : '[role="combobox"]:last-of-type')?.focus()
      return
    }
    setState('creating')
    await wait(slow ? 2500 : 1200)
    if (failCreate) {
      setState('failed')
      return
    }
    onCreated({ key: 'SHI-128', title: draft.title.trim() })
  }

  const busy = state === 'creating'

  return (
    <div
      ref={formRef}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          if (!busy) void submit()
          return
        }
        // R1 A: only an empty text field steps back, and the draft survives.
        const t = e.target as HTMLInputElement | HTMLTextAreaElement
        if (e.key === 'Backspace' && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.value === '' && !busy) {
          e.preventDefault()
          onBack()
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <ShipLogoMark height={14} />
        <InputChip label={`${ship.name} · Add issue`} onRemove={onBack} />
      </div>
      <ScrollArea viewportClassName="max-h-[420px]" contentClassName="flex flex-col gap-4 p-4 [&>*]:shrink-0">
        <fieldset disabled={busy} className="contents">
          <Field label="Title" required error={missing.title}>
            <TextInput autoFocus value={draft.title} placeholder="What is wrong, in a few words" onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={draft.description} placeholder="What happens, and what should happen" onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={draft.status} onChange={(status) => set({ status })} options={ISSUE_STATUSES} disabled={busy} />
          </Field>
          <Field label={ship.parentNoun!} required error={missing.parent}>
            <Select value={draft.parent} onChange={(parent) => set({ parent })} options={ship.parents!} placeholder={`Choose a ${ship.parentNoun!.toLowerCase()}…`} disabled={busy} />
          </Field>
        </fieldset>
      </ScrollArea>
      <div className="flex items-center gap-3 px-4 pb-4">
        <span className="min-w-0 flex-1" role="status">
          {busy && <span className="text-caption text-text-secondary">Creating the issue in Ship…</span>}
          {state === 'failed' && <FieldLine tone="error">Ship didn't accept it: the project is archived. Choose another one.</FieldLine>}
        </span>
        <Button variant="primary" onClick={() => void submit()} disabled={busy} leadingIcon={busy ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" /> : undefined}>
          {busy ? 'Creating…' : 'Add issue'}
        </Button>
      </div>
    </div>
  )
}

// ── Change: Set status on the issue this thread refers to ──────────────────

function ChangeForm({ onBack, onDone, slow }: { onBack: () => void; onDone: () => void; slow: boolean }) {
  const [status, setStatus] = useState(THREAD_ISSUE.status)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unchanged = status === THREAD_ISSUE.status
  useEffect(() => {
    // F3: arrive with the list focused, inside the launcher.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus())
  }, [])
  const submit = async () => {
    if (unchanged || busy) return
    setBusy(true)
    await wait(slow ? 2000 : 900)
    onDone()
  }
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          void submit()
        }
        if (e.key === 'Backspace' && !busy) {
          e.preventDefault()
          onBack()
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <IconArrowBackUp size={16} stroke={1.5} className="text-text-secondary" />
        <InputChip label={`${THREAD_ISSUE.key} · Set status`} onRemove={onBack} />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-body-2 text-text-secondary">{THREAD_ISSUE.title}</p>
        <Field label="Status">
          <Select value={status} onChange={setStatus} options={ISSUE_STATUSES} disabled={busy} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3 px-4 pb-4">
        {busy && <span className={cn('flex-1 text-caption text-text-secondary')} role="status">Saving…</span>}
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabledReason={unchanged ? 'Choose a different status first' : undefined}
          disabled={busy}
          leadingIcon={busy ? <IconLoader2 size={16} stroke={1.5} className="animate-spin" /> : undefined}
        >
          {busy ? 'Saving…' : 'Set status'}
        </Button>
      </div>
    </div>
  )
}
