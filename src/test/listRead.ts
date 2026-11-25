/*
  The relay's list and open reads (SPEC §6.13), over a test's own events.

  Every app reads files this way since ALL-8: a filter saying `"fields": "newest"` picks first records, and the relay
  answers each with its fields' current changes (the text only with `"text": true`), leaving out a file whose `deleted`
  field is set. A test's fake relay answers through `relayAnswer`, so its scenarios keep their events and the reads go
  the one way.
*/
import { filesOf } from '@estiva-app/interop'
import type { FileTimes, SignedEvent } from '@estiva-app/protocol'

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

/**
 * The times read's rows for one filter (SPEC §6.13, `"fields": "times"`): each first record it picks, deleted ones
 * included, with each field's current change by id and the field it set, never its value (§6.5).
 */
export function timesAnswer<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filter: Filter,
  matches: Matches<E> = plainMatches,
): FileTimes[] {
  const { fields: _fields, limit, ...rest } = filter
  const tag = (event: E, name: string) => event.tags.find((t) => t[0] === name)?.[1]
  const roots = events.filter((event) => event.kind >= 30000 && matches(event, rest)).sort((a, b) => b.created_at - a.created_at)
  return (typeof limit === 'number' ? roots.slice(0, limit) : roots).map((root) => {
    const a = `${root.kind}:${root.pubkey}:${tag(root, 'd')}`
    const h = tag(root, 'h') ?? null
    const heads = new Map<string, E>()
    for (const change of events) {
      if (change.kind !== 1851 || tag(change, 'a') !== a || (h && tag(change, 'h') !== h)) continue
      const field = tag(change, 'field')
      if (!field || field.startsWith('member:')) continue
      const held = heads.get(field)
      if (!held || change.created_at > held.created_at) heads.set(field, change)
    }
    const under = tag(root, 'a')
    const changes = [...heads].map(([field, change]) => ({ id: change.id, created_at: change.created_at, fields: [field] }))
    return { a, created_at: root.created_at, h, ...(under ? { under } : {}), changes } as FileTimes
  })
}

/** The times read's answer to `filters` over `events`, each file once. */
export function relayTimes<E extends Pick<SignedEvent, 'id' | 'kind' | 'pubkey' | 'created_at' | 'tags'>>(
  events: readonly E[],
  filters: readonly Filter[],
  matches: Matches<E> = plainMatches,
): FileTimes[] {
  const out = new Map<string, FileTimes>()
  for (const filter of filters) for (const row of timesAnswer(events, filter, matches)) out.set(row.a, row)
  return [...out.values()]
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
