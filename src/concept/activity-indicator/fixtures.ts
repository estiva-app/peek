import type { ForeignObject } from '@estiva-app/interop'

/**
 * Made-up content for the Activity indicator prototype (it never merges).
 * Miky is the viewer; Katerina, Daniel and Ana write and react.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

export const topicFile = (d: string, title: string): ForeignObject =>
  ({
    ref: `30840:${SHIP}:${d}`,
    address: `30840:${SHIP}:${d}`,
    kind: 30840,
    folder: 'f',
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: { title: { value: title } },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
  }) as unknown as ForeignObject

/** What lit a dot: blue is to read, orange is to know. */
export type Colour = 'blue' | 'orange'

export interface ActivityItem {
  id: string
  who: string
  /** What happened, said from the viewer's side. */
  what: 'conversation' | 'reply' | 'mention' | 'reaction' | 'message'
  emoji?: string
  /** A listed file it happened on; absent when it was in the place itself. */
  file?: string
  /** The words, cut to a line. */
  text: string
  /** How long ago, as the card says it. */
  ago: string
  colour: Colour
}

let n = 0
const item = (who: string, what: ActivityItem['what'], text: string, ago: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id: `a${++n}`,
  who,
  what,
  text,
  ago,
  colour: what === 'reaction' ? 'orange' : 'blue',
  ...extra,
})

/** One place in a column: a topic, a space, a team's chat or a DM. */
export interface Place {
  id: string
  name: string
  kind: 'topic' | 'space' | 'chat' | 'dm'
  /** The team it sits under, in Teams. */
  team?: string
  /** What lit it, newest first. Empty: no dot. */
  items: ActivityItem[]
  /** A DM someone flagged urgent. */
  urgent?: boolean
  /** Already seen: what the hover cleared, still in the place's For you list. */
  seen?: ActivityItem[]
}

// --- Topics ---------------------------------------------------------------

export const navigation: Place = {
  id: 'navigation',
  name: 'Navigation',
  kind: 'topic',
  items: [
    item('Katerina', 'conversation', 'The rail icons feel heavy next to the new Topics list — can we try 1.25 stroke?', '4 min', { file: 'Teams and Topics in the rail' }),
    item('Daniel', 'reply', 'Agreed, and the hover should not move the row.', '20 min', { file: 'Teams and Topics in the rail' }),
  ],
}

export const widgets: Place = {
  id: 'widgets',
  name: 'Widgets',
  kind: 'topic',
  items: [item('Katerina', 'reaction', 'Shipping the card widget on Thursday', '2 min', { emoji: '👍' })],
  seen: [item('Daniel', 'reaction', 'First cut of the poll widget is up', 'yesterday', { emoji: '🎉', file: 'Poll widget' })],
}

export const release: Place = {
  id: 'release',
  name: 'Release notes',
  kind: 'topic',
  items: [
    item('Katerina', 'mention', '@Miky can you check the wording of the Topics paragraph?', '9 min', { file: 'Estiva Suits Update 12' }),
    item('Ana', 'reaction', 'Draft is in the doc', '1 h', { emoji: '❤️' }),
  ],
}

export const speed: Place = { id: 'speed', name: 'Speed', kind: 'topic', items: [] }
export const onboarding: Place = { id: 'onboarding', name: 'Onboarding', kind: 'topic', items: [] }

export const roadmap: Place = {
  id: 'roadmap',
  name: 'Roadmap',
  kind: 'topic',
  items: [
    item('Katerina', 'mention', '@Miky which of these goes first?', 'just now', { file: 'Q1 themes' }),
    item('Daniel', 'reaction', 'Moved Search to Q1', '3 min', { emoji: '👍', file: 'Q1 themes' }),
    item('Ana', 'reply', 'I can take the onboarding part', '12 min'),
    item('Katerina', 'reaction', 'Moved Search to Q1', '15 min', { emoji: '🙌', file: 'Q1 themes' }),
    item('Daniel', 'conversation', 'Do we keep Huddles in the roadmap at all?', '40 min'),
    item('Ana', 'mention', '@Miky the pricing line needs you', '1 h', { file: 'Pricing page' }),
    item('Katerina', 'reply', 'Yes, as a stage after Teams', '2 h'),
    item('Daniel', 'reaction', 'Pricing draft v2', '3 h', { emoji: '👀', file: 'Pricing page' }),
    item('Ana', 'conversation', 'Customer interviews: three more booked', 'yesterday'),
    item('Katerina', 'reply', 'Added the notes', 'yesterday', { file: 'Customer interviews' }),
  ],
}

export const topicsColumn = [roadmap, navigation, widgets, release, speed, onboarding]

// --- Teams ------------------------------------------------------------------

export const designChat: Place = {
  id: 'design-chat',
  name: 'design',
  kind: 'chat',
  team: 'Design',
  items: [item('Katerina', 'conversation', 'Moodboard for the new icons is up', '6 min')],
}
export const designReviews: Place = {
  id: 'design-reviews',
  name: 'Reviews',
  kind: 'space',
  team: 'Design',
  items: [
    item('Katerina', 'conversation', 'Review: the Activity hover, v1', '1 min'),
    item('Ana', 'reaction', 'Screens for the share dialog', '25 min', { emoji: '👍' }),
  ],
}
export const designSystem: Place = { id: 'design-system', name: 'Design system', kind: 'space', team: 'Design', items: [] }
export const engineeringChat: Place = {
  id: 'engineering-chat',
  name: 'engineering',
  kind: 'chat',
  team: 'Engineering',
  items: [item('Daniel', 'reaction', 'Relay deploy is green', '8 min', { emoji: '🚀' })],
}
export const engineeringReleases: Place = { id: 'eng-releases', name: 'Releases', kind: 'space', team: 'Engineering', items: [] }
export const engineeringSpeed: Place = {
  id: 'eng-speed',
  name: 'Speed',
  kind: 'topic',
  team: 'Engineering',
  items: [item('Daniel', 'reply', 'Cold open is 1.9 s on your workspace now', '30 min', { file: 'Peek cold open' })],
}
export const generalChat: Place = { id: 'general', name: 'general', kind: 'chat', team: 'Estiva', items: [] }
export const announcements: Place = { id: 'announcements', name: 'Announcements', kind: 'space', team: 'Estiva', items: [] }

export const teamsColumn: { team: string; places: Place[] }[] = [
  { team: 'Design', places: [designChat, designReviews, designSystem] },
  { team: 'Engineering', places: [engineeringChat, engineeringReleases, engineeringSpeed] },
  { team: 'Estiva', places: [generalChat, announcements] },
]

// --- People -----------------------------------------------------------------

export const katerinaDm: Place = {
  id: 'katerina',
  name: 'Katerina',
  kind: 'dm',
  items: [item('Katerina', 'reaction', 'Sending the deck tonight', '3 min', { emoji: '👍' })],
}
export const danielDm: Place = {
  id: 'daniel',
  name: 'Daniel',
  kind: 'dm',
  urgent: true,
  items: [
    item('Daniel', 'message', 'The relay is refusing writes from Ship — can you look now?', '1 min'),
    item('Daniel', 'reaction', 'Merged the fix for the composer', '10 min', { emoji: '🙏' }),
  ],
}
export const anaDm: Place = {
  id: 'ana',
  name: 'Ana',
  kind: 'dm',
  items: [item('Ana', 'message', 'Are we still on for Thursday?', '15 min')],
}
export const petrDm: Place = { id: 'petr', name: 'Petr', kind: 'dm', items: [] }

export const peopleColumn = [katerinaDm, danielDm, anaDm, petrDm]

export const allPlaces: Place[] = [...topicsColumn, ...teamsColumn.flatMap((t) => t.places), ...peopleColumn]
