import type { Place } from './fixtures'

/** What still lights a place: its items less what was seen. */
export function lit(place: Place, cleared: ReadonlySet<string>) {
  const open = place.items.filter((i) => !cleared.has(i.id))
  return { blue: open.some((i) => i.colour === 'blue'), orange: open.some((i) => i.colour === 'orange'), open }
}

/** The follow switch's new words: what the place shows at each level, and what lights its dot. */
export const NEW_WORDS = {
  topic: {
    off: 'Shows its own conversation. Nothing lights.',
    important: 'Shows its own conversation. Lights for new conversations, replies in yours, and what names you on its files.',
    all: 'Shows its files’ threads too. Lights for all of it.',
  },
  chat: {
    off: 'Nothing lights.',
    important: 'Lights for new conversations and replies in yours.',
    all: 'Lights for every message.',
  },
} as const

/** Today's words (estiva-ui `src/FollowSwitch.tsx`), for the story beside them. */
export const TODAY_WORDS = {
  off: 'Nothing here lights for you',
  important: 'New conversations, and replies in the ones you are in',
  all: 'Every new conversation and every reply',
} as const
