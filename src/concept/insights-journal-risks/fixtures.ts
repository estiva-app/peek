/**
 * CONCEPT — real examples from the Leaf page "Insights, Journal and Risks: real examples" (Estiva HQ, 16 Nov).
 * Every line happened; dates and words are the real ones. Copied unchanged into each app's concept folder.
 */
import type { ItemType, MarkWord, Status } from './MarkAs'
// The real briefs' diagrams, captured from ~/estiva/decision-briefs, and Main as shipped.
import teamOrFolder from './assets/team-or-folder.png'
import teamsAndTopics from './assets/teams-and-topics.png'
import navigationToday from './assets/navigation-today.png'
import mainShot from './assets/main.jpg'

export interface Person { key: string; name: string; bot?: boolean }
export const MIKY: Person = { key: 'miky', name: 'Miky' }
export const KATERINA: Person = { key: 'katerina', name: 'Katerina' }
export const CLAUDE: Person = { key: 'claude', name: 'Claude', bot: true }
export const PEOPLE = [MIKY, KATERINA, CLAUDE]
/** Imagined tools on the protocol that send insights (Miky, 16 Nov). */
export const POSTHOG: Person = { key: 'posthog', name: 'PostHog', bot: true }
export const INTERCOM: Person = { key: 'intercom', name: 'Intercom', bot: true }

/** PostHog and Intercom are imagined on the protocol (Miky, 16 Nov): what an analytics tool and a support desk would send. */
export type SourceApp = 'Peek' | 'Ship' | 'Leaf' | 'PostHog' | 'Intercom'
export interface Source {
  app: SourceApp
  /** What was marked: a message in a topic, a comment on an issue, a block of a document; a chart, a support conversation. */
  what: 'message' | 'comment' | 'block' | 'chart' | 'conversation'
  /** Where it lives: the topic, issue or document's title. */
  place: string
  author: Person
  /** The words as they read when marked. */
  quote: string
  /** When the source was changed after the mark: the words now. */
  now?: string
  /** The source was deleted. */
  gone?: boolean
}

/** An Insight's category: the company's own field, on top of the core fields (record, 16 Nov). Estiva's four. */
export type Category = 'Customer' | 'Product' | 'Technical' | 'Process'
export const CATEGORIES: Category[] = ['Customer', 'Product', 'Technical', 'Process']

/** An insight's own picture, sent by the tool it came from: PostHog's number, bars or line; a support desk's quote. */
export type Visual =
  | { kind: 'number'; range: string; value: string; change: string; up: boolean; good?: boolean }
  | { kind: 'bars' | 'line'; range: string; points: number[]; labels: [string, string]; unit?: string; marker?: { at: number; label: string } }
  | { kind: 'quote'; quote: string; customer: string; company: string }

/** A Risk's severity (Miky, 16 Nov), most severe first; none yet right after Mark as…. */
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low']

export type QuestionStep = 'raised' | 'options' | 'review' | 'decide'

export interface Item {
  id: string
  type: ItemType
  word: MarkWord
  /** A Risk's severity. */
  severity?: Severity
  /** What an insight from another tool shows in its box: a number, a chart, a customer's words. */
  visual?: Visual
  /** The brief or picture a Decision was made on (Miky, 16 Nov: "with each decision there was an artifact or a diagram"). */
  artifact?: { title: string; caption: string; image: string }
  /** An Update's numbers, before and after. */
  measures?: { caption: string; rows: [string, string, string][] }
  /** An Update's "Still slow", "Next": what it leaves open. */
  stillOpen?: string[]
  /** An Insight's category; none yet right after Mark as… (it marks at once). */
  category?: Category
  title: string
  summary?: string
  details?: string
  status: Status
  /** When it reached this status, the day it was marked when unchanged. */
  at: string
  day: string
  team: string
  /** What it is about: an issue, else the project, else nothing (the team's own). */
  about?: { kind: 'issue' | 'project'; title: string }
  markedBy: Person
  /** A Journal entry's decider. */
  decidedBy?: Person
  acceptedBy?: Person
  source?: Source
  /** New since your last visit. */
  isNew?: boolean
  /** A Blocker: who has to act, and what stops until they do. */
  waitingOn?: Person
  blocks?: string
  /** An open Question: its options as researched (by Claude, say), and the talk about them so far. */
  options?: { label: string; gist: string; lean?: boolean; favouredBy?: Person[]; addedBy?: Person; decision?: string }[]
  optionsBy?: Person
  /** Where an open question is (Miky, 16 Nov): raised, its options researched, in review, ready to decide. */
  step?: QuestionStep
  /** Who decides it: the Decision it ends in inherits them. */
  decider?: Person
  discussion?: { people: Person[]; replies: number; last: string }
  /** A decided Question: the Decision it ended in, in the Journal. */
  decidedIn?: string
  /** A Decision that answered a Question: what was chosen, what was not, and the question. */
  decision?: { chosen: string; notChosen: string[]; question: string }
}

/**
 * Decide (Miky, 16 Nov: draw what happens after Decide): the question is Resolved, pointing at its Decision; the
 * Decision goes into the Journal with the option chosen, the ones not chosen, and why. Its decider is the question's,
 * so it is accepted at once.
 */
export function decide(items: Item[], id: string, choice: number, why = ''): Item[] {
  const q = items.find((i) => i.id === id)
  const opt = q?.options?.[choice]
  if (!q || !opt) return items
  const title = opt.decision ?? `${q.title} ${opt.label}`
  const by = q.decider ?? MIKY
  const entry: Item = {
    id: `d-${id}`, type: 'journal', word: 'Decision', status: 'accepted', at: '16 Nov', day: '2026-11-16', team: q.team, about: q.about, acceptedBy: by, decidedBy: by, isNew: true,
    title,
    summary: why || opt.gist,
    markedBy: by,
    decision: { chosen: opt.label, notChosen: (q.options ?? []).filter((o) => o !== opt).map((o) => o.label), question: q.title },
  }
  return [entry, ...items.map((i) => (i.id === id ? { ...i, status: 'resolved' as const, decidedIn: title, isNew: false } : i))]
}

export const PROJECT = 'Teams and Topics navigation'
export const TEAM = 'Estiva HQ'
const onProject = { kind: 'project' as const, title: PROJECT }
const onIssue = (title: string) => ({ kind: 'issue' as const, title })

export const ITEMS: Item[] = [
  // Insights
  {
    id: 'i1', type: 'insight', word: 'Insight', category: 'Product', status: 'proposed', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onIssue('Ship and Leaf sidebar match Peek'), isNew: true,
    title: 'Nothing on the left says where an open file belongs',
    summary: 'Katerina opened a file and could not tell which team or topic it was in: nothing on the left was selected.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: KATERINA, quote: 'I can’t find where the file belongs to. Nothing is selected on the left panel.' },
  },
  {
    id: 'i2', type: 'insight', word: 'Insight', category: 'Customer', status: 'proposed', at: '10 Nov', day: '2026-11-10', team: TEAM, about: onProject, isNew: true,
    title: 'A first-time reader spots the sidebar inconsistencies at once',
    summary: 'Miky’s brother saw straight away that Ship’s and Leaf’s sidebars work differently from Peek’s.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'One thing I’m not happy about is the sidebar navigation in Ship and Leaf. My brother called out immediately the inconsistencies.' },
  },
  {
    id: 'i3', type: 'insight', word: 'Insight', category: 'Process', status: 'accepted', at: '9 Oct', day: '2026-10-09', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Being a member of many Ship issues is an annoyance',
    summary: 'There are at least three types of topics.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: MIKY, quote: 'Meeting notes … we discussed the annoyance caused by being member of many Ship issues… we see at least 3 types of topics. Anything I missed?', now: 'Meeting notes … we discussed the annoyance caused by being member of many Ship issues… we see at least 3 types of topics (people, work, places). Anything I missed?' },
  },
  {
    id: 'i4', type: 'insight', word: 'Insight', category: 'Product', status: 'accepted', at: '18 Aug', day: '2026-08-18', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'One search for everything',
    summary: 'Katerina looks for a thing, not for an app: one search box should find messages, issues and pages alike.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: KATERINA, quote: 'One search for everything, and an “All topics” switch.' },
  },
  {
    id: 'i5', type: 'insight', word: 'Insight', category: 'Product', status: 'outdated', at: '8 Sep', day: '2026-09-08', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'An “All topics” switch helps people find a place',
    summary: 'Nobody should have to know which team a topic is in. Main and All replaced the switch.',
    markedBy: MIKY,
    source: { app: 'Leaf', what: 'block', place: 'Navigation notes', author: KATERINA, quote: 'An “All topics” switch, so nobody has to know which team a topic is in.' },
  },
  {
    id: 'i6', type: 'insight', word: 'Insight', category: 'Technical', status: 'accepted', at: '13 Oct', day: '2026-10-13', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Speed measured on a near-empty workspace says nothing',
    summary: 'Opening a topic passed on the QA account’s near-empty workspace and took 5–10 seconds on Miky’s. Measure on a workspace his size.',
    markedBy: MIKY,
  },
  // Imagined senders (Miky, 16 Nov): PostHog and Intercom on the protocol, sending insights of their own. PostHog's
  // numbers are real: our own speed measurements of 26 Oct–16 Nov, from the Performance update (Miky: "replace the
  // posthog data with performance data that we really have"). Intercom's customer is still imagined.
  {
    id: 'i7', type: 'insight', word: 'Insight', category: 'Technical', status: 'accepted', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'A Leaf page opens in 2.5 seconds',
    summary: 'Opening a Leaf page in Miky’s workspace took 38 seconds on 26 Oct; after the speed work, 2.5.',
    markedBy: POSTHOG,
    visual: { kind: 'number', range: 'Today', value: '2.5 s', change: 'Was 38 s on 26 Oct', up: false, good: true },
    source: { app: 'PostHog', what: 'chart', place: 'Speed dashboard', author: POSTHOG, quote: 'Time to open a Leaf page, Miky’s workspace: 2.5 s (26 Oct: 38 s).' },
  },
  {
    id: 'i8', type: 'insight', word: 'Insight', category: 'Technical', status: 'accepted', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Claude reads a Peek topic in under 2 seconds',
    summary: 'An agent reading a Peek topic waited 79 seconds on 26 Oct; now 1.7.',
    markedBy: POSTHOG,
    visual: { kind: 'bars', range: '26 Oct – 16 Nov', points: [79, 1.7], labels: ['26 Oct', '16 Nov'], unit: ' s', marker: { at: 1, label: 'Speed work' } },
    source: { app: 'PostHog', what: 'chart', place: 'Speed dashboard', author: POSTHOG, quote: 'Time for an agent to read a Peek topic: 79 s on 26 Oct, 1.7 s on 16 Nov.' },
  },
  {
    id: 'i9', type: 'insight', word: 'Insight', category: 'Technical', status: 'proposed', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, isNew: true,
    title: 'Weekly Plans is growing again: 59 MB',
    summary: 'A page still downloads every edit ever made to it: 79 MB on 26 Oct, 43 MB at the end of October, 59 MB today.',
    markedBy: POSTHOG,
    visual: { kind: 'line', range: '26 Oct – 16 Nov', points: [79, 43, 59], labels: ['26 Oct', '16 Nov'], unit: ' MB', marker: { at: 1, label: 'End of October' } },
    source: { app: 'PostHog', what: 'chart', place: 'Speed dashboard', author: POSTHOG, quote: 'Bytes to open the Weekly Plans page: 79 MB, 43 MB, 59 MB.' },
  },
  {
    id: 'i10', type: 'insight', word: 'Insight', category: 'Customer', status: 'proposed', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, isNew: true,
    title: 'A shared link doesn’t say which team the file is in',
    summary: 'Three customers asked this week; each opened a file from a link and couldn’t tell who else could read it.',
    markedBy: INTERCOM,
    visual: { kind: 'quote', quote: 'I opened the doc from a link and had no idea which team it was in, so I didn’t know who I could share it with.', customer: 'Dana', company: 'Acme' },
    source: { app: 'Intercom', what: 'conversation', place: 'Support inbox', author: { key: 'dana', name: 'Dana at Acme' }, quote: 'I opened the doc from a link and had no idea which team it was in, so I didn’t know who I could share it with.' },
  },
  // Journal
  {
    // Real: the latest update in Peek's Performance topic, 16 Nov, as Miky pointed to it (verbatim, its measurements as a table).
    id: 'j0', type: 'journal', word: 'Update', status: 'accepted', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY, isNew: true,
    title: 'Peek, Ship and Leaf open in about 2 seconds',
    summary: 'Leaf shows the page you open in a couple of seconds, even from a Peek conversation; Ship opens in about 2 seconds again; Claude answers in about 2 seconds.',
    details: 'Leaf shows the page you open in a couple of seconds, even from a Peek conversation, while the sidebar fills in behind it. Ship projects and issues open in about 2 seconds again. When Claude reads Ship or Peek for you, it answers in about 2 seconds instead of half a minute or more.',
    measures: {
      caption: 'Measured on a fresh open, 26 October → today',
      rows: [
        ['A Leaf page (Weekly Plans)', '38 s', '2.5 s'],
        ['The same page from Peek’s “Open ↗”', '113 s', '2.3 s'],
        ['A Ship project', '7.2 s', '2.0 s'],
        ['A Ship issue', '5.8 s', '2.1 s'],
        ['Claude reading a Ship issue', '40 s', '1.8 s'],
        ['Claude reading a Peek topic', '79 s', '1.7 s'],
        ['Peek’s Desk on a large workspace', '20–33 MB', '10–13 MB'],
      ],
    },
    stillOpen: [
      'A page still downloads every edit ever made to it, so it grows as you work: Weekly Plans went from 79 MB to 43 MB at the end of October and is back to 59 MB today. It opens fast, but it costs data and time on a slow connection.',
      'Speed work continues. If something still feels slow to you, say where in Peek, and it goes into the next round.',
    ],
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Performance', author: CLAUDE, quote: 'Update 11/16/2026 — Faster: Leaf shows the page you open in a couple of seconds…' },
  },
  {
    id: 'j1', type: 'journal', word: 'Decision', status: 'proposed', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onIssue('Ship and Leaf sidebar match Peek'), isNew: true,
    title: 'The sidebar shows Teams and Topics, never Folders',
    summary: 'Teams and Topics go at the top of Ship’s and Leaf’s sidebars, and Folders leave the sidebar completely.',
    artifact: { title: 'Cross-app navigation concepts', caption: 'Teams decide who reads; topics gather files from any team', image: teamsAndTopics },
    markedBy: MIKY, decidedBy: KATERINA,
    source: { app: 'Ship', what: 'comment', place: 'Ship and Leaf sidebar match Peek', author: KATERINA, quote: 'Let’s go with Teams and Topics at the top and drop Folders from the sidebar completely.' },
  },
  {
    id: 'j2', type: 'journal', word: 'Decision', status: 'accepted', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onProject, acceptedBy: MIKY, isNew: true,
    title: 'Cross-app work is an Initiative; a team room is a Topic',
    summary: 'Work that spans apps is an Initiative, a team’s room is a Topic, and People become DMs. Katerina judges the names on the prototype.',
    artifact: { title: 'Navigation brainstorm', caption: 'Today, in one picture: a team holds chat, spaces and topics; each app shows its own sidebar', image: navigationToday },
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Leaf', what: 'block', place: 'Universal Navigation brainstorm', author: MIKY, quote: 'Cross-app work = Initiatives, team rooms = Topics, People → DMs.' },
  },
  {
    id: 'j3', type: 'journal', word: 'Update', status: 'accepted', at: '10 Nov', day: '2026-11-10', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Topics: Main and All shipped in Peek',
    summary: 'In Peek, the level you set on a topic is what you see.',
    details: 'Topics: Main and All is done, in Peek only: the level you set on a topic is what you see of it.\n\nNext: the Activity indicator on each topic and team, ahead of sending a thread up and highlights. What is new in Ship and Leaf waits; it needs more thinking.',
    artifact: { title: 'Main, All, Activity', caption: 'A Peek topic’s Main, as shipped', image: mainShot },
    markedBy: MIKY,
  },
  {
    id: 'j4', type: 'journal', word: 'Update', status: 'accepted', at: '4 Nov', day: '2026-11-04', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Ship’s and Leaf’s Topics navigation shipped',
    summary: 'Ship and Leaf list Topics in the sidebar, as Peek does.',
    details: 'Ship and Leaf now list Topics in the sidebar, as Peek does: a file shows under the topic it belongs to.\n\nNext: Main and All in all three apps.',
    markedBy: MIKY,
  },
  {
    id: 'j5', type: 'journal', word: 'Decision', status: 'accepted', at: '2 Nov', day: '2026-11-02', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'A Folder is called a team',
    summary: 'Everywhere a person reads it, a Folder is called a team. Code and the wire still say folder.',
    artifact: { title: 'Team or Folder', caption: 'Today a Folder is a box of files; after, the same place has members, followers, its chat and spaces', image: teamOrFolder },
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'Let’s call it a team everywhere people read it.' },
  },
  {
    id: 'j6', type: 'journal', word: 'Decision', status: 'superseded', at: '8 Sep', day: '2026-09-08', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'One search with an “All topics” switch',
    summary: 'One search box, with a switch to look in every topic. Replaced by Main and All.',
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'that’s good call' },
  },
  // Risks
  {
    id: 'r1', type: 'risk', word: 'Question', severity: 'Medium', status: 'proposed', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onProject, isNew: true,
    step: 'raised',
    title: 'Initiatives and Topics: are those the names?',
    summary: 'Waiting on Katerina’s look at the prototype.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'Initiatives for cross-app work, Topics for team rooms — Katerina to judge on the prototype.' },
  },
  {
    id: 'r2', type: 'risk', word: 'Concern', severity: 'High', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Ship and Leaf “what is new” needs more thinking',
    summary: 'Before it is built, decide what counts as new in Ship and in Leaf.',
    markedBy: MIKY,
    source: { app: 'Ship', what: 'comment', place: PROJECT, author: MIKY, quote: 'What is new in Ship and Leaf needs more thinking before we build it.' },
  },
  {
    id: 'r3', type: 'risk', word: 'Question', severity: 'High', status: 'open', at: '28 Oct', day: '2026-10-28', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Teams and Topics at the top, no Folders: who leads, who reads?',
    summary: 'Once Folders leave the sidebar, who leads a topic and who can read it?',
    markedBy: MIKY,
    // Real: the options of the brief decision-briefs/who-leads-who-reads.html.
    // Imagined: who favours which, and Katerina adding the third option in review.
    options: [
      { label: 'The team is the wall', gist: 'Each team reads only its own; a shared space is a third team with its own members.' },
      { label: 'The space says who reads it', gist: 'Teams are member lists; each space is led by one team and names its readers.', lean: true, favouredBy: [MIKY, CLAUDE] },
      { label: 'Talk by space, files by team', gist: 'Conversations follow the space, files keep their team’s readers.', favouredBy: [KATERINA], addedBy: KATERINA },
    ],
    optionsBy: CLAUDE,
    step: 'review',
    decider: MIKY,
    discussion: { people: [MIKY, KATERINA, CLAUDE], replies: 12, last: '2 Nov' },
    source: { app: 'Leaf', what: 'block', place: 'Who leads, who reads', author: MIKY, quote: 'Who leads a topic, and who can read it, once Folders are gone from the sidebar?', gone: true },
  },
  {
    id: 'r4', type: 'risk', word: 'Concern', severity: 'Medium', status: 'resolved', at: '4 Nov', day: '2026-11-04', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'A Folder as the access boundary feels wrong',
    summary: 'Parked until the navigation work; Teams and Topics answered it.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: MIKY, quote: 'A Folder as the access boundary feels wrong to me. Let’s park it until navigation.' },
  },
  {
    id: 'r5', type: 'risk', word: 'Concern', severity: 'Low', status: 'rejected', at: '14 Oct', day: '2026-10-14', team: TEAM, about: onProject,
    title: 'Peek’s topic list is too long',
    summary: 'Katerina found the list long, but fine for now.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: KATERINA, quote: 'The list is getting long, but it’s fine for now.' },
  },
  {
    // Real: the agent's key is not a team member, so a team's roster change as Miky needs his passkey in Peek.
    id: 'r6', type: 'risk', word: 'Blocker', severity: 'Critical', status: 'open', at: '11 Nov', day: '2026-11-11', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'The agent can’t change who is in a team',
    summary: 'Its key is not a member, so adding someone to a team needs Miky’s passkey in Peek. Team work stops there until he does it.',
    markedBy: MIKY,
    waitingOn: MIKY,
    blocks: 'Adding people to teams',
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: CLAUDE, quote: 'I can’t add people to the team: my key isn’t a member. It needs your passkey in Peek.' },
  },
  {
    // Real, this prototype: its previews sit behind sign-in, so the agent sends links it has not opened.
    id: 'r7', type: 'risk', word: 'Blocker', status: 'proposed', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, isNew: true,
    title: 'Claude can’t open the prototype’s preview links',
    summary: 'The previews sit behind sign-in, so every link in the Read me reaches Miky unopened.',
    markedBy: CLAUDE,
    waitingOn: MIKY,
    blocks: 'Opening every link before it goes to Miky',
    source: { app: 'Ship', what: 'comment', place: PROJECT, author: CLAUDE, quote: 'The previews are behind Cloudflare Access; I rendered every story headless instead.' },
  },
  {
    // Real: question B of this prototype's Read me, its two options as the agent wrote them.
    id: 'r8', type: 'risk', word: 'Question', severity: 'Low', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY, isNew: true,
    title: 'Does marking a reply bring its thread into the topic’s feed?',
    summary: 'On 29 Oct a thread reaches Main only when someone sends it there. Is marking that send?',
    markedBy: CLAUDE,
    options: [
      { label: 'Marking shows it in the feed', gist: 'The thread’s marks show under its message in the topic; sending up to Main stays its own act.', lean: true },
      { label: 'It stays folded', gist: 'Marks show only inside the thread until someone sends it up.' },
    ],
    optionsBy: CLAUDE,
    step: 'options',
    decider: MIKY,
    source: { app: 'Ship', what: 'comment', place: PROJECT, author: CLAUDE, quote: 'Does marking a reply bring its thread into the topic’s feed?' },
  },
  {
    // Real: question A of this prototype's Read me, reviewed and waiting for Miky; who favours which is imagined.
    id: 'r9', type: 'risk', word: 'Question', severity: 'High', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Is an insight’s category shared by every app, or each company’s own?',
    summary: 'The accepted fields leave it out; severity is named as a company’s own, Blocker changes a shared field.',
    markedBy: CLAUDE,
    options: [
      { label: 'Shared, with Blocker', gist: 'Category and Blocker join the fields every app reads; severity stays the company’s.', lean: true, favouredBy: [CLAUDE], decision: 'An insight’s category and Blocker are fields every app reads' },
      { label: 'Each company’s own', gist: 'Ship ships defaults; another app may not show them.', favouredBy: [KATERINA], decision: 'An insight’s category is each company’s own' },
    ],
    optionsBy: CLAUDE,
    step: 'decide',
    decider: MIKY,
    discussion: { people: [CLAUDE, KATERINA], replies: 4, last: 'today' },
    source: { app: 'Ship', what: 'comment', place: PROJECT, author: CLAUDE, quote: 'Is an insight’s category a shared field or the company’s own?' },
  },
]

export const byType = (type: ItemType) => ITEMS.filter((i) => i.type === type)
/** A hand-typed item with no source (record #450). */
export const HAND_TYPED: Item = {
  id: 'h1', type: 'risk', word: 'Concern', severity: 'Medium', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
  title: 'A new feature often makes the next speed round necessary',
  summary: 'Recognise it at once: each build issue carries a Load cost line.',
  markedBy: MIKY,
}
