/**
 * Finding things from the launcher (PEE-4).
 *
 * > **Miky, 2026-08-19** — *"We could also add basic Topic search and People /
 * > Team search to make it little bit more useful."*
 *
 * Three corpora, and they are **not searched the same way**, because measuring
 * the relay first said they could not be. `scripts/probe-nip50-search.ts`
 * against production, 2026-09-02:
 *
 * | | where | matches |
 * | --- | --- | --- |
 * | topics | already in the app (`useTopics`) | any substring, live per keystroke |
 * | people | already in the app (`usePeople`) | any substring, live per keystroke |
 * | messages | the relay, over NIP-50 | **whole tokens only** |
 *
 * `"Cla"` returns nothing from the relay while `"Claude"` returns two. That is
 * not a bug to work around, it is what a tokenised index does — so the split
 * above is the honest one: the two corpora Peek already holds are small (69
 * topics, 7 profiles readable on production) and can be matched locally on any
 * fragment, and the one that is unbounded stays on the relay and answers to
 * whole words.
 *
 * The consequence has to reach the person, or the feature reads as broken:
 * typing `exam` finds a topic and no messages, and the message section has to
 * say *why* rather than showing the same "nothing matched" it would show for a
 * word that genuinely appears nowhere. See `messageEmptyState`.
 *
 * Substring rather than prefix, because that is what the rest of this app
 * already means by matching — the launcher's own action filter, the slash-menu
 * and the mention autocomplete all use `label.toLowerCase().includes(q)`, and
 * a launcher that alone required a prefix would be the odd one out.
 */
import type { Person } from '@/data/peopleData'
import type { Topic } from '@/data/topicData'

/**
 * A window of text around the match, rather than the first N characters.
 *
 * Taken from `lib/peekSearch.ts`, which was a verbatim copy from the prototype,
 * claimed in its own header to *"power the launcher's 'In Peek' results"*, and
 * was imported by nothing. It searched the `TOPICS` / `TOPIC_CONVERSATIONS`
 * fixtures directly — so it could never see a message from production, which is
 * presumably why it fell out of use when the mock apps went (2026-08-31). This
 * function was the one part worth keeping; the file is deleted rather than left
 * beside a real implementation for somebody to find and trust.
 */
export function snippetAround(text: string, query: string, span = 76): string {
  const flat = text.replace(/\s+/g, ' ')
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return flat.slice(0, span)
  const start = Math.max(0, idx - Math.floor((span - query.length) / 2))
  const end = Math.min(flat.length, start + span)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/** Trimmed and lowercased once, so every matcher agrees on the term. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * Whether the query has a whole word in it that the relay could match.
 *
 * A single unfinished token is the common case while typing, and it is the one
 * the relay cannot answer. Anything with a space in it has at least one
 * complete word, so it is worth sending.
 */
export function hasCompleteWord(query: string): boolean {
  return /\s/.test(query.trim())
}

export function matchTopics(topics: readonly Topic[], query: string, limit = 5): Topic[] {
  const q = normalizeQuery(query)
  if (!q) return []
  return topics.filter((t) => t.title.toLowerCase().includes(q)).slice(0, limit)
}

/**
 * People by name **or role**, because "designer" is a thing somebody looks for
 * and a role is the only place it is written down.
 */
export function matchPeople(people: readonly Person[], query: string, limit = 5): Person[] {
  const q = normalizeQuery(query)
  if (!q) return []
  return people
    .filter((p) => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
    .slice(0, limit)
}

/** How the message search ended, which decides what the section says. */
export type MessageSearchState =
  /** Nothing typed yet. */
  | { kind: 'idle' }
  /** In flight. */
  | { kind: 'searching' }
  /** The relay answered. `count` may be zero. */
  | { kind: 'done'; count: number }
  /** The relay did not answer, or answered no. */
  | { kind: 'failed'; failure: 'unreachable' | 'refused' | 'not_a_member' }
  /** No token, so there was nothing to ask with. */
  | { kind: 'signed-out' }

/**
 * The sentence the message section shows, or `null` when it has results to
 * show instead.
 *
 * PEE-4's done-when is explicit that **the empty state distinguishes "nothing
 * matched" from "nothing you can read"**, and those are the two lines that used
 * to be one. `RelayReadError` already classifies the difference (PEE-10), so
 * this only has to not throw it away.
 */
export function messageEmptyState(state: MessageSearchState, query: string): string | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'searching':
      return 'Searching messages…'
    case 'signed-out':
      return 'Sign in to search messages.'
    case 'failed':
      /*
        `not_a_member` is an answer, not an outage — the viewer is not in that
        channel, arrived at successfully. Saying "could not reach" there would
        report a healthy relay as broken.
      */
      return state.failure === 'not_a_member'
        ? 'No messages you can read match — some conversations are not yours to see.'
        : state.failure === 'refused'
          ? 'The relay refused the search, so this list is incomplete.'
          : 'Could not reach the relay, so messages are not included.'
    case 'done':
      if (state.count > 0) return null
      /*
        The distinction the probe bought. A partial word finding nothing is not
        the same statement as a whole word finding nothing, and showing the
        latter's wording for the former is the thing that would make this read
        as broken while working exactly as measured.
      */
      return hasCompleteWord(query)
        ? 'No messages matched.'
        : 'No messages matched — message search needs a whole word.'
  }
}
