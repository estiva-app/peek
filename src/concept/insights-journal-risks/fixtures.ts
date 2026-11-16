/**
 * CONCEPT — real examples from the Leaf page "Insights, Journal and Risks: real examples" (Estiva HQ, 16 Nov).
 * Every line happened; dates and words are the real ones. Copied unchanged into each app's concept folder.
 */
import type { ItemType, MarkWord, Status } from './MarkAs'

export interface Person { key: string; name: string; bot?: boolean }
export const MIKY: Person = { key: 'miky', name: 'Miky' }
export const KATERINA: Person = { key: 'katerina', name: 'Katerina' }
export const CLAUDE: Person = { key: 'claude', name: 'Claude', bot: true }
export const PEOPLE = [MIKY, KATERINA, CLAUDE]

export type SourceApp = 'Peek' | 'Ship' | 'Leaf'
export interface Source {
  app: SourceApp
  /** What was marked: a message in a topic, a comment on an issue, a block of a document. */
  what: 'message' | 'comment' | 'block'
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

export interface Item {
  id: string
  type: ItemType
  word: MarkWord
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
}

export const PROJECT = 'Teams and Topics navigation'
export const TEAM = 'Estiva HQ'
const onProject = { kind: 'project' as const, title: PROJECT }
const onIssue = (title: string) => ({ kind: 'issue' as const, title })

export const ITEMS: Item[] = [
  // Insights
  {
    id: 'i1', type: 'insight', word: 'Insight', status: 'proposed', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onIssue('Ship and Leaf sidebar match Peek'), isNew: true,
    title: 'Nothing on the left says where an open file belongs',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: KATERINA, quote: 'I can’t find where the file belongs to. Nothing is selected on the left panel.' },
  },
  {
    id: 'i2', type: 'insight', word: 'Insight', status: 'proposed', at: '10 Nov', day: '2026-11-10', team: TEAM, about: onProject, isNew: true,
    title: 'A first-time reader spots the sidebar inconsistencies at once',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'One thing I’m not happy about is the sidebar navigation in Ship and Leaf. My brother called out immediately the inconsistencies.' },
  },
  {
    id: 'i3', type: 'insight', word: 'Insight', status: 'accepted', at: '9 Oct', day: '2026-10-09', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Being a member of many Ship issues is an annoyance',
    summary: 'There are at least three types of topics.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: MIKY, quote: 'Meeting notes … we discussed the annoyance caused by being member of many Ship issues… we see at least 3 types of topics. Anything I missed?', now: 'Meeting notes … we discussed the annoyance caused by being member of many Ship issues… we see at least 3 types of topics (people, work, places). Anything I missed?' },
  },
  {
    id: 'i4', type: 'insight', word: 'Insight', status: 'accepted', at: '18 Aug', day: '2026-08-18', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'One search for everything',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: KATERINA, quote: 'One search for everything, and an “All topics” switch.' },
  },
  {
    id: 'i5', type: 'insight', word: 'Insight', status: 'outdated', at: '8 Sep', day: '2026-09-08', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'An “All topics” switch helps people find a place',
    markedBy: MIKY,
    source: { app: 'Leaf', what: 'block', place: 'Navigation notes', author: KATERINA, quote: 'An “All topics” switch, so nobody has to know which team a topic is in.' },
  },
  // Journal
  {
    id: 'j1', type: 'journal', word: 'Decision', status: 'proposed', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onIssue('Ship and Leaf sidebar match Peek'), isNew: true,
    title: 'The sidebar shows Teams and Topics, never Folders',
    markedBy: MIKY, decidedBy: KATERINA,
    source: { app: 'Ship', what: 'comment', place: 'Ship and Leaf sidebar match Peek', author: KATERINA, quote: 'Let’s go with Teams and Topics at the top and drop Folders from the sidebar completely.' },
  },
  {
    id: 'j2', type: 'journal', word: 'Decision', status: 'accepted', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onProject, acceptedBy: MIKY, isNew: true,
    title: 'Cross-app work is an Initiative; a team room is a Topic',
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Leaf', what: 'block', place: 'Universal Navigation brainstorm', author: MIKY, quote: 'Cross-app work = Initiatives, team rooms = Topics, People → DMs.' },
  },
  {
    id: 'j3', type: 'journal', word: 'Update', status: 'accepted', at: '10 Nov', day: '2026-11-10', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Main and All shipped in Peek, Ship and Leaf',
    markedBy: MIKY,
  },
  {
    id: 'j4', type: 'journal', word: 'Update', status: 'accepted', at: '4 Nov', day: '2026-11-04', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Ship’s and Leaf’s Topics navigation shipped',
    markedBy: MIKY,
  },
  {
    id: 'j5', type: 'journal', word: 'Decision', status: 'accepted', at: '2 Nov', day: '2026-11-02', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'A Folder is called a team',
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'Let’s call it a team everywhere people read it.' },
  },
  {
    id: 'j6', type: 'journal', word: 'Decision', status: 'superseded', at: '8 Sep', day: '2026-09-08', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'One search with an “All topics” switch',
    markedBy: MIKY, decidedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'that’s good call' },
  },
  // Risks
  {
    id: 'r1', type: 'risk', word: 'Question', status: 'proposed', at: '13 Nov', day: '2026-11-13', team: TEAM, about: onProject, isNew: true,
    title: 'Initiatives and Topics: are those the names?',
    summary: 'Waiting on Katerina’s look at the prototype.',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Universal Navigation', author: MIKY, quote: 'Initiatives for cross-app work, Topics for team rooms — Katerina to judge on the prototype.' },
  },
  {
    id: 'r2', type: 'risk', word: 'Concern', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Ship and Leaf “what is new” needs more thinking',
    markedBy: MIKY,
    source: { app: 'Ship', what: 'comment', place: PROJECT, author: MIKY, quote: 'What is new in Ship and Leaf needs more thinking before we build it.' },
  },
  {
    id: 'r3', type: 'risk', word: 'Question', status: 'open', at: '28 Oct', day: '2026-10-28', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'Teams and Topics at the top, no Folders: who leads, who reads?',
    markedBy: MIKY,
    source: { app: 'Leaf', what: 'block', place: 'Who leads, who reads', author: MIKY, quote: 'Who leads a topic, and who can read it, once Folders are gone from the sidebar?', gone: true },
  },
  {
    id: 'r4', type: 'risk', word: 'Concern', status: 'resolved', at: '4 Nov', day: '2026-11-04', team: TEAM, about: onProject, acceptedBy: MIKY,
    title: 'A Folder as the access boundary feels wrong',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: MIKY, quote: 'A Folder as the access boundary feels wrong to me. Let’s park it until navigation.' },
  },
  {
    id: 'r5', type: 'risk', word: 'Concern', status: 'rejected', at: '14 Oct', day: '2026-10-14', team: TEAM, about: onProject,
    title: 'Peek’s topic list is too long',
    markedBy: MIKY,
    source: { app: 'Peek', what: 'message', place: 'Friday Meetings', author: KATERINA, quote: 'The list is getting long, but it’s fine for now.' },
  },
]

export const byType = (type: ItemType) => ITEMS.filter((i) => i.type === type)
/** A hand-typed item with no source (record #450). */
export const HAND_TYPED: Item = {
  id: 'h1', type: 'risk', word: 'Concern', status: 'open', at: '16 Nov', day: '2026-11-16', team: TEAM, about: onProject, acceptedBy: MIKY,
  title: 'A new feature often makes the next speed round necessary',
  summary: 'Recognise it at once: each build issue carries a Load cost line.',
  markedBy: MIKY,
}
