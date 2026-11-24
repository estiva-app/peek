/*
  The relay's list and open reads (SPEC §6.13), over a test's own events.

  Every app reads files this way since ALL-8: a filter saying `"fields": "newest"` picks first records, and the relay
  answers each with its fields' current changes (the text only with `"text": true`), leaving out a file whose `deleted`
  field is set. A test's fake relay answers through `relayAnswer`, so its scenarios keep their events and the reads go
  the one way.
*/
import { filesOf } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'

type Filter = Record<string, unknown>
type Matches<E> = (event: E, filter: Filter) => boolean

/** A plain filter: ids, kinds, authors, `#x` tags, since and until. */
export function plainMatches(event: Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>, filter: Filter): boolean {
  if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) return false
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false
  if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) return false
  if (typeof filter.since === 'number' && event.created_at < filter.since) return false
  if (typeof filter.until === 'number' && event.created_at > filter.until) return false
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue
    if (!event.tags.some((t) => t[0] === key.slice(1) && (values as string[]).includes(t[1]))) return false
  }
  return true
}

/** The list read's answer to one filter: each first record it picks, with its fields' current changes; a deleted file left out. */
export function listAnswer<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filter: Filter,
  matches: Matches<E> = plainMatches,
): E[] {
  const { fields: _fields, text, limit, ...rest } = filter
  const roots = events.filter((event) => event.kind >= 30000 && matches(event, rest)).sort((a, b) => b.created_at - a.created_at)
  const picked = new Set<unknown>(typeof limit === 'number' ? roots.slice(0, limit) : roots)
  return filesOf(events as unknown as SignedEvent[], { withText: text === true }).flatMap((file) =>
    picked.has(file.root) && file.fields.deleted?.value !== 'true' ? (file.events as unknown as E[]) : [],
  )
}

/** The relay's answer to `filters` over `events`: the list read for a filter that asks it, the plain match for the rest. */
export function relayAnswer<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filters: readonly Filter[],
  matches: Matches<E> = plainMatches,
): E[] {
  const out = new Map<string, E>()
  for (const filter of filters) {
    const hits = filter.fields === 'newest' ? listAnswer(events, filter, matches) : events.filter((event) => matches(event, filter))
    for (const event of hits) out.set(event.id, event)
  }
  return [...out.values()]
}
