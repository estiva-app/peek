/*
  UIG-29 launcher prototype — invented data only (no team data).
  The design reference for the package's CommandPalette; deleted with the prototype.
*/

export interface ProtoTopic {
  id: string
  title: string
  resolved: boolean
  active: string
}

export interface ProtoPerson {
  id: string
  name: string
  role: string
}

export interface ProtoMessage {
  id: string
  author: string
  topicId: string
  time: string
  /** Raw, as it is stored: markdown and all. The launcher must show it as words. */
  body: string
}

export interface ThreadMessage {
  id: string
  author: string
  time: string
  body: string
}

export interface ProtoAction {
  id: string
  label: string
  description: string
}

export interface ProtoApp {
  id: 'ship' | 'peek'
  name: string
  description: string
  /** What the app publishes today. Peek publishes nothing. */
  actions: ProtoAction[]
  /** The app's own word for where a new thing goes. */
  parentNoun?: string
  parents?: { value: string; label: string }[]
}

export const TOPICS: ProtoTopic[] = [
  { id: 't-launcher', title: 'Feedback on the launcher', resolved: false, active: '5m ago' },
  { id: 't-empty', title: 'Empty states review', resolved: false, active: '2h ago' },
  { id: 't-billing', title: 'Billing export runs twice', resolved: false, active: 'Yesterday' },
  { id: 't-offline', title: 'Research: offline mode', resolved: true, active: 'Last week' },
  { id: 't-rollout', title: 'Design system rollout', resolved: false, active: 'Mon' },
  { id: 't-q4', title: 'Q4 planning', resolved: true, active: 'Aug 30' },
]

export const PEOPLE: ProtoPerson[] = [
  { id: 'p-amie', name: 'Amie Stone', role: 'Engineer' },
  { id: 'p-bruno', name: 'Bruno Vale', role: 'Designer' },
  { id: 'p-cleo', name: 'Cleo Park', role: 'Product' },
]

export const MESSAGES: ProtoMessage[] = [
  { id: 'm1', author: 'Amie Stone', topicId: 't-billing', time: 'Yesterday', body: '**Amendment** — the export was written assuming two runs, and there are three.' },
  { id: 'm2', author: 'Bruno Vale', topicId: 't-rollout', time: 'Mon', body: '# Weekly update\nThe design system rollout reached both apps: the library, its docs and the tokens.' },
  { id: 'm3', author: 'Cleo Park', topicId: 't-empty', time: '2h ago', body: 'Reader half is up — [pull #31](https://example.com/pull/31) shows every empty state side by side.' },
  { id: 'm4', author: 'Amie Stone', topicId: 't-launcher', time: '11:56 AM', body: "The launcher's list can't scroll past a certain height on small screens." },
  { id: 'm5', author: 'Bruno Vale', topicId: 't-empty', time: '9:40 AM', body: 'Empty states should say what is missing, not just "No messages".' },
]

export const THREAD: ThreadMessage[] = [
  { id: 'r1', author: 'Katerina', time: '5:51 PM', body: 'Collecting launcher findings here. I will turn them into issues later.' },
  { id: 'r2', author: 'Amie Stone', time: '5:52 PM', body: 'Empty states in the launcher say nothing useful: no topics, no people, just "No messages matched".' },
  { id: 'r3', author: 'Bruno Vale', time: '11:56 AM', body: "The list can't scroll past a certain height on small screens." },
]

/** A Ship issue the thread refers to — the target of "Set status". */
export const THREAD_ISSUE = { key: 'SHI-42', title: 'Launcher empty states', status: 'todo' }

export const ISSUE_STATUSES = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

export const APPS: ProtoApp[] = [
  {
    id: 'ship',
    name: 'Ship',
    description: 'Projects & issues',
    actions: [{ id: 'add-issue', label: 'Add issue', description: 'File an issue under a project' }],
    parentNoun: 'Project',
    parents: [
      { value: 'p-polish', label: 'Launcher polish' },
      { value: 'p-rollout', label: 'Design system rollout' },
    ],
  },
  { id: 'peek', name: 'Peek', description: 'Topics & conversations', actions: [] },
]

export const RECENT = { topics: ['t-launcher', 't-empty'], people: ['p-bruno'] }

export const ANSWERS = {
  ask: {
    paragraphs: [
      'This thread collects problems with the launcher, to be filed as issues later [1].',
      'Two are named so far: empty states that say nothing useful [2], and a list that stops scrolling on small screens [3].',
    ],
    sources: ['r1', 'r2', 'r3'],
  },
  draft:
    'Thanks both. I will file the empty states and the scrolling problem as two Ship issues today, and link them here.',
  make: {
    app: 'Ship',
    action: 'Add issue',
    preview: 'An issue for the launcher’s empty states: when nothing matches, it shows no topics, no people and no useful words.',
    prefill: {
      title: 'Launcher empty states say nothing useful',
      description: 'When nothing matches, the launcher shows "No messages matched" and nothing else. Say what is missing, and what to try.',
    },
  },
}
