import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconSearch } from '@tabler/icons-react'
import {
  Avatar,
  Button,
  Chip,
  CommandPaletteAnswer,
  CommandPaletteProposal,
  CommandPaletteWorking,
  Kbd,
  KindIcon,
  SearchInput,
  TopBar,
  isApplePlatform,
  type ThingKind,
  cn,
} from '@estiva-app/ui'
import { PeekLogoMark } from '@/components/ui/PeekLogo'

/**
 * The next Intelligence box, as a prototype. It is not wired to the launcher:
 * Storybook is the only place it renders, so the shape can be judged before
 * any of it replaces Cmd+K.
 *
 * One field. Up to two words it is a search. More than that, it is a prompt:
 * the field grows, the topic's files stay as reference, and two suggested
 * actions sit at the bottom. A file, and only a file, opens a preview.
 * Escape hides the box and keeps an unfinished sentence. While it is working,
 * or an answer is waiting and the box is hidden, a dot sits on the top-bar search.
 */

type Phase = 'idle' | 'working' | 'answered' | 'acted'

interface Row {
  id: string
  label: string
  description: string
  /** A person has no preview. A file, a project and a topic do, and only a file or a project shows the pane. */
  kind: ThingKind | 'person'
  app?: string
  lines?: string[]
  meta?: string
}

const TOPIC = 'Intelligence in Peek'

const ROWS: Row[] = [
  {
    id: 'leaf',
    label: 'Intelligence',
    description: 'Leaf · in Peek',
    kind: 'file',
    app: 'Leaf',
    lines: [
      'A preview beside the file you are about to open.',
      'The sentence stays when you close the box.',
      'The field grows once you are writing a prompt.',
    ],
    meta: 'Updated today',
  },
  {
    id: 'project',
    label: "Peek's Intelligence",
    description: 'Ship · project',
    kind: 'project',
    app: 'Ship',
    lines: [
      'One box for a search, a question and an action.',
      'A selected message can be what the question is about.',
    ],
    meta: 'From September',
  },
  {
    id: 'topic',
    label: TOPIC,
    description: 'Topic',
    kind: 'topic',
  },
  {
    id: 'katerina',
    label: 'Katerina',
    description: 'Person',
    kind: 'person',
  },
]

const ANSWER =
  "Today's note describes this box: a preview when a file is highlighted, the sentence kept when you close it, and the field growing once you are writing a prompt. The September note asked for one box that can tell a draft from a question. None of that is in Peek yet."

const wordsOf = (value: string) => value.trim().split(/\s+/).filter(Boolean)

const matches = (row: Row, query: string) => {
  const words = wordsOf(query)
  if (words.length === 0) return true
  const hay = `${row.label} ${row.description}`.toLowerCase()
  return words.every((word) => hay.includes(word.toLowerCase()))
}

export interface IntelligenceNextProps {
  /** The sentence already in the field. */
  query?: string
  /** The box starts hidden. The working story uses this, because a boolean `false` does not survive as a story arg. */
  hidden?: boolean
  phase?: Phase
  /** Which row is lit. A file or a project lights the preview. */
  litId?: string
  /** Stay on `phase`. The working story holds the dot instead of finishing. */
  hold?: boolean
}

export function IntelligenceNext({
  query: initialQuery = '',
  hidden = false,
  phase: initialPhase = 'idle',
  litId: initialLit = 'leaf',
  hold = false,
}: IntelligenceNextProps) {
  const [query, setQuery] = useState(initialQuery)
  const [open, setOpen] = useState(!hidden)
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [litId, setLitId] = useState(initialLit)
  const [pointed, setPointed] = useState(false)
  const [action, setAction] = useState<'project' | 'document' | null>(null)
  const [landed, setLanded] = useState<Row | null>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const modKey = isApplePlatform() ? 'Cmd' : 'Ctrl'

  const prompt = wordsOf(query).length > 2
  const visible = useMemo(() => (prompt ? ROWS.filter((row) => row.lines) : ROWS.filter((row) => matches(row, query))), [prompt, query])
  const lit = visible.find((row) => row.id === litId) ?? visible[0]
  // A prompt keeps the files as reference. The pane opens when a file is the one you are on: the highlighted row while searching, the row under the pointer while prompting.
  const preview = lit?.lines && (!prompt || pointed) ? lit : null
  const dot = !open && (phase === 'working' || phase === 'answered')

  useEffect(() => {
    if (visible.some((row) => row.id === litId)) return
    const first = visible[0]
    if (first) setLitId(first.id)
  }, [visible, litId])

  useEffect(() => {
    if (!open) return
    fieldRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (phase !== 'working' || hold) return
    const timer = setTimeout(() => setPhase('answered'), 1300)
    return () => clearTimeout(timer)
  }, [phase, hold])

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      if (phaseRef.current === 'acted') {
        setQuery('')
        setPhase('idle')
        setAction(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const edit = (value: string) => {
    setQuery(value)
    setAction(null)
    if (phase !== 'idle') setPhase('idle')
  }

  const hide = () => {
    setOpen(false)
    if (phase === 'acted') {
      setQuery('')
      setPhase('idle')
      setAction(null)
    }
  }

  const choose = (row: Row) => {
    setLanded(row)
    setQuery('')
    setPhase('idle')
    setAction(null)
    setOpen(false)
  }

  const ask = () => {
    if (!prompt || phase === 'working') return
    setAction(null)
    setPhase('working')
  }

  const finish = (next: 'project' | 'document') => {
    setAction(next)
    setPhase('acted')
  }

  const onFieldKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
      return
    }
    if (!prompt && event.key === 'ArrowDown') {
      event.preventDefault()
      const index = visible.findIndex((row) => row.id === lit?.id)
      const next = visible[Math.min(visible.length - 1, index + 1)]
      if (next) setLitId(next.id)
      return
    }
    if (!prompt && event.key === 'ArrowUp') {
      event.preventDefault()
      const index = visible.findIndex((row) => row.id === lit?.id)
      const next = visible[Math.max(0, index - 1)]
      if (next) setLitId(next.id)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (prompt) ask()
      else if (lit) choose(lit)
    }
  }

  return (
    <div className="relative flex h-screen flex-col bg-bg-base text-text-primary">
      <style>{`
        @keyframes intelligence-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .intelligence-dot.is-working { animation: intelligence-dot 1.6s ease-in-out infinite; }
      `}</style>
      <TopBar
        logo={<PeekLogoMark height={20} />}
        search={
          <div
            role="button"
            tabIndex={0}
            aria-label={dot && phase === 'working' ? 'Intelligence is working' : dot ? 'Intelligence is ready' : 'Search'}
            className="relative cursor-pointer"
            onMouseDown={(event) => {
              event.preventDefault()
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            <SearchInput placeholder="Search Peek..." shortcut={modKey === 'Cmd' ? '⌘K' : 'Ctrl K'} className="pointer-events-none w-[290px]" readOnly tabIndex={-1} />
            {dot && (
              <span
                aria-hidden
                className={cn('intelligence-dot absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent-primary', phase === 'working' && 'is-working')}
              />
            )}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[240px] shrink-0 flex-col gap-1 border-r border-border-default p-3">
          <p className="px-3 py-2 text-caption text-text-secondary">Topics</p>
          <div className="rounded-lg bg-bg-hover px-3 py-2">
            <p className="truncate text-body-2 text-text-primary">{TOPIC}</p>
            <p className="truncate text-caption text-text-secondary">Peek</p>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col px-10 py-8">
          <h1 className="text-body-2 font-medium text-text-primary">{landed?.label ?? TOPIC}</h1>
          <div className="mt-6 flex max-w-[560px] flex-col gap-4 text-body-2 text-text-secondary">
            {(landed?.lines ?? [
              'September — one box that can tell a draft from a question, with the topic, a thread or a message as its context.',
              "Today — a sketch of the field growing, a preview for the file you are choosing, and a dot while it works.",
            ]).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </main>
      </div>

      {open && (
        <div className="absolute inset-0 z-40 bg-scrim" onMouseDown={hide}>
          <div className="flex w-full items-start justify-center pt-[12vh]" onMouseDown={(event) => event.stopPropagation()}>
            <div
              role="dialog"
              aria-label="Intelligence"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  hide()
                }
              }}
              className="flex max-h-[min(640px,72vh)] w-max max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-border-default bg-bg-elevated shadow-lg"
            >
              <div className="flex w-[640px] max-w-full min-w-0 flex-col">
                <div className={cn('flex gap-3 border-b border-border-subtle px-5', prompt ? 'items-start py-3' : 'h-12 items-center')}>
                  <IconSearch size={16} stroke={1.5} className={cn('shrink-0 text-text-secondary', prompt && 'mt-1.5')} />
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Chip label={TOPIC} className={cn('shrink-0', prompt && 'mt-1')} />
                    <textarea
                      ref={fieldRef}
                      value={query}
                      rows={prompt ? 3 : 1}
                      aria-label={prompt ? 'Ask about this topic' : 'Search'}
                      placeholder={prompt ? 'Ask about this topic' : 'Search, or ask about this topic'}
                      onChange={(event) => edit(event.target.value)}
                      onKeyDown={onFieldKey}
                      className={cn(
                        'min-w-0 flex-1 resize-none bg-transparent text-input-value text-text-primary outline-none transition-[height] duration-200 placeholder:text-text-muted',
                        prompt ? 'h-[4.5rem]' : 'h-6',
                      )}
                    />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
                  {phase === 'working' && (
                    <div className="px-3 pt-2">
                      <CommandPaletteWorking>Reading this topic</CommandPaletteWorking>
                    </div>
                  )}
                  {phase === 'answered' && (
                    <div className="px-3 pt-2">
                      <CommandPaletteAnswer>{ANSWER}</CommandPaletteAnswer>
                    </div>
                  )}
                  {phase === 'acted' && action && (
                    <div className="px-3 pt-2">
                      <CommandPaletteProposal source={action === 'project' ? 'Ship' : 'Leaf'} mark={<KindIcon kind={action === 'project' ? 'project' : 'file'} />}>
                        {action === 'project' ? query.trim() : 'A draft of the answer, ready to edit.'}
                      </CommandPaletteProposal>
                    </div>
                  )}

                  {visible.length > 0 && (
                    <div className="flex flex-col" role="listbox" aria-label={prompt ? 'From this topic' : 'Results'}>
                      {visible.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          role="option"
                          aria-selected={row.id === lit?.id && (!prompt || pointed)}
                          onMouseEnter={() => {
                            setLitId(row.id)
                            setPointed(true)
                          }}
                          onClick={() => choose(row)}
                          className={cn(
                            'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left',
                            row.id === lit?.id && (!prompt || pointed) && 'bg-bg-hover',
                          )}
                        >
                          <Leading row={row} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-2 text-text-primary">{row.label}</span>
                            <span className="block truncate text-caption text-text-secondary">{row.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {visible.length === 0 && phase === 'idle' && <p className="px-3 py-2 text-caption text-text-muted">Nothing under that name.</p>}

                  {prompt && phase !== 'working' && phase !== 'acted' && (
                    <div className="flex flex-wrap gap-2 px-3 pb-2">
                      <Button variant="outlined" size="small" type="button" onClick={() => finish('project')}>
                        Create project
                      </Button>
                      <Button variant="outlined" size="small" type="button" onClick={() => finish('document')}>
                        Draft document
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border-subtle px-5 text-caption text-text-secondary">
                  <span className="min-w-0 flex-1 truncate">{TOPIC}</span>
                  {!prompt && visible.length > 1 && (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Kbd>↑↓</Kbd> move
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Kbd>Enter</Kbd> {prompt ? 'ask' : 'open'}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Kbd>Esc</Kbd> {phase === 'working' ? 'hide' : 'close'}
                  </span>
                </div>
              </div>

              {preview && (
                <aside className="flex w-[280px] shrink-0 flex-col gap-3 border-l border-border-subtle p-5">
                  <span className="flex items-center gap-2 text-caption text-text-secondary">
                    <KindIcon kind={preview.kind === 'person' ? 'file' : preview.kind} />
                    {preview.app}
                  </span>
                  <p className="text-body-2 font-medium text-text-primary">{preview.label}</p>
                  {preview.lines?.map((line) => (
                    <p key={line} className="text-caption text-text-secondary">
                      {line}
                    </p>
                  ))}
                  {preview.meta && <p className="mt-auto text-caption text-text-muted">{preview.meta}</p>}
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Leading({ row }: { row: Row }) {
  if (row.kind === 'person') return <Avatar name={row.label} size={32} />
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-bg-inset">
      <KindIcon kind={row.kind} />
    </span>
  )
}
