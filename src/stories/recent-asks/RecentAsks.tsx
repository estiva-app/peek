import { useEffect, useState } from 'react'
import { IconEraser, IconPencil, IconSparkles } from '@tabler/icons-react'
import {
  Avatar,
  CommandPalette,
  CommandPaletteAnswer,
  CommandPaletteSearch,
  CommandPaletteWorking,
  KindIcon,
  NavItem,
  TopBar,
  cn,
  type CommandPaletteGroup,
  type CommandPaletteRow,
} from '@estiva-app/ui'
import { PeekLogoMark } from '@/components/ui/PeekLogo'
import { ShipLogoMark } from '@/components/ui/ShipLogo'

/**
 * KIN-8 prototype: in Peek's ⌘K, Recent lists the asks you made in this tab.
 *
 * Drawn from the parts Peek's ⌘K is made of on main today (the kit's
 * CommandPalette, its first level: This conversation, Actions, Recent, Apps;
 * the prompt and its answer; the top bar's search and its dot). Not wired to
 * the launcher: Storybook is the only place it renders.
 *
 * What is new, all decided by Miky at the kickoff (25 Nov 2026):
 * - ⌘K opened somewhere other than where you asked opens fresh, about where you
 *   are. In the conversation you asked in, it shows the ask as it does today.
 * - Every sentence you sent in this tab waits under Recent: the sentence, where
 *   it was asked, and a dot while it is worked on (pulsing) or its answer is
 *   unseen (solid). An answer you have seen has no mark.
 * - Picking one brings back the sentence and its answer, about the
 *   conversation it was asked in.
 * - Only you forget one: Ctrl+Backspace on its row, Clear recent, or a reload.
 *   Opening a result or using the answer leaves it there.
 * - The search's dot, clicked anywhere else, opens the fresh box with the
 *   waiting ask lit first.
 */

type AskState = 'working' | 'waiting' | 'seen'

interface Ask {
  id: string
  sentence: string
  /** The conversation it was asked in. */
  where: string
  state: AskState
  answer: string
}

const CONVERSATIONS = ['Weekly sync', 'Intelligence in Peek', 'Website launch'] as const
type Conversation = (typeof CONVERSATIONS)[number]

const ANSWERS: Record<string, string> = {
  'Intelligence in Peek':
    'Katerina asked for the preview to run the full height of the box [1], and Miky agreed to leave the card as it is for now [2]. Nothing is waiting on you.',
  'Website launch': 'The launch waits on two things: the pricing page copy, which Katerina is writing [1], and the domain move, planned for Thursday [2].',
  'Weekly sync': 'This week: ⌘K reached Leaf and Ship [1], and the guess orders actions in Edge [2]. Speed work moves to next week [3].',
}

const RECENT_FILES = [
  {
    id: 'f1',
    label: '⌘K in every app',
    description: 'Project · Ship',
    kind: 'project' as const,
  },
  {
    id: 'f2',
    label: 'Highlights and the intelligence layer',
    description: 'Document · Leaf',
    kind: 'file' as const,
  },
]

const icon = (I: typeof IconSparkles) => <I size={16} stroke={1.5} />

/** The ask's mark: the prompt's sparkles on the row's tile, with the search's own dot when it is working or unseen. */
function AskMark({ state }: { state: AskState }) {
  return (
    <span className="relative flex size-8 items-center justify-center rounded-sm bg-bg-inset text-text-secondary">
      <IconSparkles size={16} stroke={1.5} />
      {state !== 'seen' && (
        <>
          <span className="sr-only">{state === 'working' ? 'working on what you asked' : 'an answer is waiting'}</span>
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent-primary',
              state === 'working' && 'animate-working motion-reduce:animate-none',
            )}
          />
        </>
      )}
    </span>
  )
}

export interface RecentAsksProps {
  /** The conversation you are in. */
  at?: Conversation
  /** The asks this tab holds, newest first. */
  asks?: Ask[]
  /** The box is shown. */
  open?: boolean
  /** The box shows this ask, as picked from Recent (or as kept, in the conversation it was asked in). */
  showing?: string
}

export function RecentAsks({ at: startAt = 'Weekly sync', asks: startAsks = [], open: startOpen = true, showing: startShowing }: RecentAsksProps) {
  const [at, setAt] = useState<Conversation>(startAt)
  const [asks, setAsks] = useState<Ask[]>(startAsks)
  const [open, setOpen] = useState(startOpen)
  /** The ask the box shows, or none: a fresh box. */
  const [showing, setShowing] = useState<string | undefined>(startShowing)
  const [query, setQuery] = useState(() => startAsks.find((a) => a.id === startShowing)?.sentence ?? '')
  const [last, setLast] = useState('')

  const shown = asks.find((a) => a.id === showing)
  const words = query.trim().split(/\s+/).filter(Boolean).length
  const prompting = !!shown || words >= 3

  // An answer arrives 2.5 s after it is asked. Seen if the box shows it then.
  useEffect(() => {
    const working = asks.filter((a) => a.state === 'working')
    if (!working.length) return
    const timer = setTimeout(() => {
      setAsks((list) => list.map((a) => (a.state === 'working' ? { ...a, state: open && showing === a.id ? 'seen' : 'waiting' } : a)))
    }, 2500)
    return () => clearTimeout(timer)
  }, [asks, open, showing])

  // Looking at an answer is seeing it.
  useEffect(() => {
    if (open && shown?.state === 'waiting') setAsks((list) => list.map((a) => (a.id === shown.id ? { ...a, state: 'seen' } : a)))
  }, [open, shown])

  const searchStatus = open ? undefined : asks.some((a) => a.state === 'working') ? 'working' : asks.some((a) => a.state === 'waiting') ? 'waiting' : undefined

  /** ⌘K or the search: in the conversation of the ask it last showed, that ask; anywhere else, a fresh box. */
  const openBox = () => {
    if (open) return hide()
    if (shown && shown.where === at) {
      setOpen(true)
      return
    }
    setShowing(undefined)
    setQuery('')
    setOpen(true)
  }
  const hide = () => setOpen(false)
  const show = (ask: Ask) => {
    setShowing(ask.id)
    setQuery(ask.sentence)
  }
  const forget = (id: string) => {
    setAsks((list) => list.filter((a) => a.id !== id))
    if (showing === id) setShowing(undefined)
  }
  const act = (what: string) => {
    setLast(what)
    setOpen(false)
    setShowing(undefined)
    setQuery('')
  }
  const ask = () => {
    const sentence = query.trim()
    if (shown && shown.sentence === sentence) return
    const next: Ask = {
      id: `ask-${Date.now()}`,
      sentence,
      where: at,
      state: 'working',
      answer: ANSWERS[at],
    }
    setAsks((list) => [next, ...list.filter((a) => a.id !== showing)])
    setShowing(next.id)
  }

  // ── The first level, as Peek draws it, with the asks at the top of Recent.
  const waitingFirst = [...asks].sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting'))
  const askRows: CommandPaletteRow[] = waitingFirst.slice(0, 3).map((a) => ({
    id: a.id,
    label: a.sentence,
    description: `in ${a.where}`,
    leading: <AskMark state={a.state} />,
    onSelect: () => show(a),
    onForget: () => forget(a.id),
  }))
  const fileRows: CommandPaletteRow[] = RECENT_FILES.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    icon: <KindIcon kind={f.kind} size={16} />,
    onSelect: () => act(`Opened ${f.label}`),
  }))
  const personRow: CommandPaletteRow = {
    id: 'p1',
    label: 'Katerina',
    description: 'Person',
    leading: <Avatar name="Katerina" size={24} />,
    onSelect: () => act('Opened a conversation with Katerina'),
  }
  const recentRows = [...askRows, ...fileRows, personRow]
  const conversationGroups: CommandPaletteGroup[] = [
    {
      label: 'This conversation',
      rows: [
        {
          id: 'rename',
          label: 'Rename',
          icon: icon(IconPencil),
          onSelect: () => act('Rename'),
        },
      ],
    },
    {
      label: 'Actions',
      rows: [
        {
          id: 'topic',
          label: 'Create topic',
          icon: icon(IconPencil),
          onSelect: () => act('Create topic'),
        },
        {
          id: 'start',
          label: 'Start a conversation',
          icon: icon(IconPencil),
          onSelect: () => act('Start a conversation'),
        },
      ],
    },
  ]
  /* An answer waits: Recent comes first, so the waiting ask is the lit row and Enter opens it (Miky, KIN-8 kickoff). */
  const waits = asks.some((a) => a.state === 'waiting')
  const recentGroup: CommandPaletteGroup = {
    label: 'Recent',
    rows: [
      ...recentRows,
      {
        id: 'clear-recent',
        label: 'Clear recent',
        icon: icon(IconEraser),
        onSelect: () => {
          setAsks([])
        },
      },
    ],
  }
  const appsGroup: CommandPaletteGroup = {
    label: 'Apps',
    rows: [
      {
        id: 'ship',
        label: 'Ship',
        leading: <ShipLogoMark height={20} />,
        onSelect: () => act('Went into Ship'),
      },
    ],
  }
  const firstGroups = waits ? [recentGroup, ...conversationGroups, appsGroup] : [...conversationGroups, recentGroup, appsGroup]

  // ── A prompt: the asked sentence and its answer, about where it was asked.
  const about = shown?.where ?? at
  const suggested: CommandPaletteGroup = {
    label: 'Suggested',
    rows: [
      {
        id: 'draft',
        label: 'Draft a reply',
        icon: icon(IconPencil),
        onSelect: () => act('Put the answer in the message box (the ask stays under Recent)'),
      },
      {
        id: 'issue',
        label: 'Add issue',
        description: 'Ship',
        leading: <ShipLogoMark height={20} />,
        onSelect: () => act('Opened Add issue'),
      },
    ],
  }
  const body =
    shown && shown.sentence === query.trim() ? (
      shown.state === 'working' ? (
        <CommandPaletteWorking>Reading the thread…</CommandPaletteWorking>
      ) : (
        <CommandPaletteAnswer>{shown.answer}</CommandPaletteAnswer>
      )
    ) : undefined

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        logo={<PeekLogoMark height={20} />}
        onSearch={openBox}
        searchPlaceholder="Search Peek"
        searchStatus={searchStatus}
        searchStatusLabel={searchStatus === 'working' ? 'working on what you asked' : 'an answer is waiting'}
      />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-60 flex-col gap-1 border-r border-border-subtle p-3" aria-label="Conversations">
          {CONVERSATIONS.map((c) => (
            <NavItem
              key={c}
              label={c}
              href="#"
              active={c === at}
              onClick={(event) => {
                event.preventDefault()
                setAt(c)
              }}
            />
          ))}
        </nav>
        <main className="flex-1 p-6">
          <h1 className="text-h3 text-text-primary">{at}</h1>
          <p className="mt-2 max-w-prose text-body-2 text-text-muted">
            The conversation would be here. Press Ctrl+K or click the search, ask something with three words or more, press Enter, then pick another
            conversation on the left and press Ctrl+K again.
          </p>
          {last && <p className="mt-4 text-body-2 text-text-secondary">Last: {last}</p>}
        </main>
      </div>
      <CommandPalette open={open} onOpenChange={(next) => !next && hide()} label="Launcher" modKey="Ctrl" escWord={asks.length || query ? 'hide' : 'close'}>
        <CommandPaletteSearch
          query={query}
          onQueryChange={(q) => {
            setQuery(q)
            if (shown && q.trim() !== shown.sentence) setShowing(undefined)
          }}
          placeholder="Search, or ask about this conversation"
          groups={prompting ? (body && shown?.state !== 'working' ? [suggested] : []) : firstGroups}
          about={prompting ? about : undefined}
          prompt={prompting ? { onSubmit: ask, submitWord: 'ask' } : undefined}
        >
          {body}
        </CommandPaletteSearch>
      </CommandPalette>
    </div>
  )
}

export const SAMPLE_ASKS: Record<string, Ask> = {
  seen: {
    id: 'a1',
    sentence: 'what did Katerina decide about the preview?',
    where: 'Intelligence in Peek',
    state: 'seen',
    answer: ANSWERS['Intelligence in Peek'],
  },
  waiting: {
    id: 'a2',
    sentence: 'what is the launch still waiting on?',
    where: 'Website launch',
    state: 'waiting',
    answer: ANSWERS['Website launch'],
  },
  working: {
    id: 'a3',
    sentence: 'summarise what changed this week',
    where: 'Weekly sync',
    state: 'working',
    answer: ANSWERS['Weekly sync'],
  },
}
