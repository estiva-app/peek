/** CONCEPT — the data Peek's concept stories draw: messages, their marks, the topics. Never merged. */
import type { ForeignObject } from '@estiva-app/interop'
import { TYPE_OF, type Mark, type MarkWord } from './MarkAs'
import type { Person } from './fixtures'

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
/** The moment the stories are drawn at: every time is this, less how long ago. */
export const NOW = Date.now()

export interface StoryMessage {
  id: string
  author: Person
  /** How long ago it was written, in ms. */
  ago: number
  text: string
  /** What it is marked as, and by whom: the line's hover names them. */
  mark?: StoryMark
}
export type StoryMark = Mark & { by: Person }

/** A mark as the prototype stores it: the line's hover reads "Insight · <title> · marked by Miky". */
export const marked = (word: MarkWord, title: string, by: Person, status: Mark['status'] = 'proposed'): StoryMark => ({
  type: TYPE_OF[word],
  word,
  title,
  href: '#',
  status,
  by,
})

const OWNER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const topic = (d: string, title: string): ForeignObject =>
  ({
    ref: `30840:${OWNER}:${d}`,
    address: `30840:${OWNER}:${d}`,
    kind: 30840,
    folder: 'estiva-hq',
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: { title: { value: title } },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
  }) as unknown as ForeignObject

export const TOPICS = [topic('universal-navigation', 'Universal Navigation'), topic('friday-meetings', 'Friday Meetings'), topic('release-notes', 'Release notes')]
export const titleOf = (t: ForeignObject) => t.slots.title?.value ?? ''
