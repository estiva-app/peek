import type { ForeignObject } from '@estiva-app/interop'

/**
 * The data behind Peek's stories of "Topics: level up the topic experience"
 * (prototype only, branch `concept/topics-level-up`; it never merges). Real
 * topic names from Estiva HQ, invented contents, the same as the estiva-ui
 * prototype's fixtures. A topic's `at` is when anything last happened in it — a
 * message by anyone, the agent's too, a file added, or a save, status or
 * comment on a file it lists — and is the one order the sidebar sorts by.
 */

export const MIKY = '1'.repeat(64)
export const KATERINA = '2'.repeat(64)
export const AGENT = '3'.repeat(64)
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const LEAF = '4'.repeat(64)

export type Person = 'miky' | 'katerina' | 'agent'
export const KEY: Record<Person, string> = { miky: MIKY, katerina: KATERINA, agent: AGENT }
export const NAME: Record<Person, string> = { miky: 'Miky', katerina: 'Katerina Kelepouri', agent: 'Estiva agent' }
/** The directory the members pill and the cards name people from. */
export const DIRECTORY = {
  [MIKY]: { displayName: 'Miky' },
  [KATERINA]: { displayName: 'Katerina Kelepouri' },
  [AGENT]: { displayName: 'Estiva agent', bot: true as const },
}

export type Look = 'row' | 'card'
export type Read = 'ok' | 'loading' | 'failed'

const status = (current: string, options: [string, string][]) => ({
  id: 'set-status',
  label: 'Change status',
  control: 'select' as const,
  field: 'status',
  current,
  options: options.map(([value, label]) => ({ value, label })),
})
const PROJECT_STATUSES: [string, string][] = [['planned', 'Planned'], ['in_progress', 'In Progress'], ['completed', 'Completed']]
const ISSUE_STATUSES: [string, string][] = [['todo', 'Todo'], ['in_progress', 'In Progress'], ['done', 'Done']]

function shipFile(kind: 30850 | 30851, d: string, title: string, state: { value: string; label: string; colour: string }, extra: Partial<ForeignObject> = {}): ForeignObject {
  const address = `${kind}:${SHIP}:${d}`
  return {
    ref: address,
    address,
    eventId: 'e'.repeat(64),
    naddr: '',
    kind,
    noun: kind === 30850 ? 'project' : 'issue',
    widget: 'card',
    appName: 'Estiva Ship',
    slots: {
      title: { value: title, field: 'title' },
      status: { label: 'Status', value: state.label, colour: state.colour, field: 'status' },
    },
    meta: [],
    people: DIRECTORY,
    comments: [],
    folder: 'f',
    openUrl: `https://ship.estiva.app/${kind === 30850 ? 'project' : 'issue'}/${d}`,
    actions: [status(state.value, kind === 30850 ? PROJECT_STATUSES : ISSUE_STATUSES)],
    viaRecommendation: false,
    ...extra,
  } as unknown as ForeignObject
}

function leafDoc(d: string, title: string, extra: Partial<ForeignObject> = {}): ForeignObject {
  const address = `30842:${LEAF}:${d}`
  return {
    ref: address,
    address,
    eventId: 'e'.repeat(64),
    naddr: '',
    kind: 30842,
    noun: 'document',
    widget: 'card',
    appName: 'Estiva Leaf',
    slots: { title: { value: title, field: 'title' } },
    meta: [],
    people: DIRECTORY,
    comments: [],
    folder: 'f',
    openUrl: `https://leaf.estiva.app/document/${d}`,
    actions: [],
    viaRecommendation: false,
    ...extra,
  } as unknown as ForeignObject
}

const PROGRESS = { value: 'in_progress', label: 'In Progress', colour: 'blue' }
const PLANNED = { value: 'planned', label: 'Planned', colour: 'neutral' }
const COMPLETED = { value: 'completed', label: 'Completed', colour: 'green' }
const TODO = { value: 'todo', label: 'Todo', colour: 'neutral' }
const archived = { archived: { by: MIKY, at: 1_760_000_000 } } as unknown as Partial<ForeignObject>
const lead = (who: string) => ({ meta: [{ label: 'Lead', value: who, isPubkey: true, field: 'lead' }] }) as Partial<ForeignObject>
const assignee = (who: string) => ({ meta: [{ label: 'Assignee', value: who, isPubkey: true, field: 'assignee' }] }) as Partial<ForeignObject>

/** Every file a topic lists here, by a short id. */
export const FILES: Record<string, ForeignObject> = {
  w2b2: shipFile(30850, 'widgets-2-build-2', 'Widgets 2: build 2', PROGRESS, lead(MIKY)),
  spec: leafDoc('widgets-spec', 'Widgets spec'),
  status: shipFile(30851, 'card-draws-status', 'Card widget draws status and lead', TODO, assignee(AGENT)),
  w2b1: shipFile(30850, 'widgets-2-build-1', 'Widgets 2: build 1', COMPLETED, lead(MIKY)),
  sketch: leafDoc('widget-sketches', 'Widget sketches'),
  w3: shipFile(30850, 'widgets-3', 'Widgets 3', PLANNED, lead(KATERINA)),
  v0: { ...leafDoc('widgets-v0-notes', 'Widgets v0 notes'), ...archived },
  pickers: { ...shipFile(30850, 'widget-pickers', 'Widget pickers', COMPLETED, lead(AGENT)), ...archived },
  speed: shipFile(30850, 'peek-opens-instantly', 'Peek opens instantly', PROGRESS, lead(AGENT)),
  speedkit: leafDoc('speed-kit', 'Speed kit'),
  level: shipFile(30850, 'topics-level-up', 'Topics: level up the topic experience', PROGRESS, lead(MIKY)),
  proto: shipFile(30851, 'topics-level-up-prototyped', 'Topics level-up, prototyped', PROGRESS, assignee(AGENT)),
  navdoc: leafDoc('navigation-notes', 'Navigation notes'),
  suits: leafDoc('suits-update-6-nov', 'Estiva Suits Update, 6 Nov'),
  onb: leafDoc('onboarding-checklist', 'Onboarding checklist'),
  price: leafDoc('pricing-draft', 'Pricing draft'),
  roles: leafDoc('roles-we-hire-for', 'Roles we hire for'),
  post: shipFile(30851, 'post-the-designer-role', 'Post the designer role', TODO, assignee(KATERINA)),
}

export interface Topic {
  /** The topic as Peek reads it: a bare file. */
  file: ForeignObject
  id: string
  title: string
  summary: string
  /** The team it is filed in. "Company" is everyone's, and has no spaces. */
  team: string
  members: Person[]
  /** Newest activity, in minutes ago: the sidebar's order. */
  at: number
  atLabel: string
  archived?: boolean
  /** The files it lists, in the topic's order, each with how it is drawn. */
  files: { id: string; look: Look }[]
}

const topic = (id: string, title: string, at: number, atLabel: string, files: string[], extra: Partial<Topic> = {}): Topic => {
  const address = `30840:${MIKY}:${id}`
  return {
    file: {
      ref: address,
      address,
      eventId: 'e'.repeat(64),
      naddr: '',
      kind: 30840,
      widget: 'card',
      folder: 'company',
      slots: { title: { value: title } },
      meta: [],
      comments: [],
      actions: [],
      viaRecommendation: false,
      ...(extra.archived ? archived : {}),
    } as unknown as ForeignObject,
    id,
    title,
    summary: '',
    team: 'Company',
    members: ['miky', 'katerina', 'agent'],
    at,
    atLabel,
    // Projects draw as cards, the rest as rows, until somebody picks otherwise.
    files: files.map((f) => ({ id: f, look: FILES[f]!.kind === 30850 ? 'card' : 'row' })),
    ...extra,
  }
}

export const TOPICS: Topic[] = [
  topic('fast', 'Peek, Ship and Leaf are fast', 2, '2m ago', ['speed', 'speedkit'], { summary: 'Every app opens in under a second on Miky’s workspace.', team: 'Engineering' }),
  topic('level', 'Topics level-up', 20, '20m ago', ['level', 'proto']),
  topic('widgets', 'Widgets', 60, '1h ago', ['w2b2', 'spec', 'status', 'w2b1', 'sketch', 'w3', 'v0', 'pickers'], { summary: 'One way to draw a file inside another, in every app.' }),
  topic('nav', 'Universal Navigation', 180, '3h ago', ['navdoc']),
  topic('suits', 'Estiva Suits Update', 1440, 'Yesterday', ['suits'], { members: ['miky', 'agent'] }),
  topic('onb', 'Onboarding', 4000, 'Tue', ['onb'], { team: 'Design' }),
  topic('price', 'Pricing', 9000, 'Last week', ['price'], { members: ['miky'] }),
  topic('hiring', 'Hiring', 300, '5h ago', ['roles', 'post'], { members: ['katerina'], summary: 'Who we look for next.' }),
  topic('brand', 'Brand refresh', 2000, 'Mon', [], { members: ['katerina'], team: 'Design', summary: 'Logo, colours and the site.' }),
  topic('interviews', 'Customer interviews', 6000, 'Last week', [], { members: [], summary: 'What five companies told us.' }),
  topic('comments', 'Comments everywhere', 30000, '17 Oct', ['w2b1'], { archived: true, summary: 'One comment box in Peek, Ship and Leaf.' }),
  topic('signin', 'Stay signed in', 40000, '19 Oct', [], { archived: true }),
]

export const topicOf = (id: string) => TOPICS.find((t) => t.id === id)!

/** Your topics, newest activity first: the sidebar's order, and Explore's "Your topics". */
export const yourTopics = (who: Person, topics: Topic[] = TOPICS) =>
  topics.filter((t) => !t.archived && t.members.includes(who)).sort((a, b) => a.at - b.at)

type Message = { id: string; who: Person; time: string; day: string; body: string }

/** A few messages for a topic's conversation; what they say is not what this project changes. */
export const messagesOf = (topicId: string): Message[] =>
  topicId === 'widgets'
    ? WIDGETS_MESSAGES
    : [
        { id: `${topicId}-1`, who: 'katerina', time: '4:12 PM', day: 'Yesterday', body: 'I put my notes from today in the files on the right.' },
        { id: `${topicId}-2`, who: 'miky', time: '9:03 AM', day: 'Today', body: 'Thanks, read them. Let’s pick this up on Monday.' },
      ]

const WIDGETS_MESSAGES: Message[] = [
  { id: 'm1', who: 'katerina', time: '10:02 AM', day: 'Yesterday', body: 'The card widget now draws its status and lead. Row next.' },
  { id: 'm2', who: 'miky', time: '10:14 AM', day: 'Yesterday', body: 'Looks right. Can the row keep the status as words when the topic is archived?' },
  { id: 'm3', who: 'agent', time: '9:40 AM', day: 'Today', body: 'Widgets 2: build 2 is at 3 of 7. The pickers PR is open for review.' },
  { id: 'm4', who: 'miky', time: '11:05 AM', day: 'Today', body: 'Thanks. Let’s put the sketches on the topic so we stop hunting for them.' },
]
