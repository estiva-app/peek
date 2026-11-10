import { placeFilters, placeListing } from '@estiva-app/conversation'
import type { SignedEvent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { viewerQuery } from './foreign'

const KIND_ROSTER = 39002
const ROSTER_COMMANDS: readonly number[] = [9000, 9001, 9021, 9022, 9007]
const KIND_FOLDER_STATE = 30890
const KIND_FOLDER_COMMAND = 1852
/** The viewer's private teams list, which `placeFilters` asks for too; a topic's listing never needs it. */
const KIND_APP_DATA = 30078

type Filter = Record<string, unknown>

/**
 * Filters asking the same kinds by the same tags, as one: each tag's values
 * together. It asks for more than each alone (an author with another's `d`),
 * so every topic takes back only what its own filters answer.
 */
function mergedFilters(filters: readonly Filter[]): Filter[] {
  const groups = new Map<string, Filter>()
  for (const filter of filters) {
    const shape = JSON.stringify([filter.kinds, Object.keys(filter).sort()])
    const into = groups.get(shape)
    if (!into) {
      groups.set(shape, { ...filter })
      continue
    }
    for (const [key, value] of Object.entries(filter)) {
      if (key !== 'kinds' && Array.isArray(value)) into[key] = [...new Set([...(into[key] as unknown[]), ...value])]
    }
  }
  return [...groups.values()]
}

/** Whether an event answers a filter by its kinds, authors and `#x` tags, as NIP-01 reads them: the only parts `placeFilters` uses. */
function answersFilter(event: SignedEvent, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) => {
    const wanted = value as unknown[]
    if (key === 'kinds') return wanted.includes(event.kind)
    if (key === 'authors') return wanted.includes(event.pubkey)
    if (key.startsWith('#')) return event.tags.some((tag) => tag[0] === key.slice(1) && wanted.includes(tag[1]))
    return true
  })
}

/**
 * How many people each topic lists, for Explore topics' Members (TOPI-6, as
 * Ship's and Leaf's `readTopicMembers`): conversation's `placeListing`, the
 * rule Peek's people list draws — who chose a level, was added or made it,
 * and its team's members.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 *
 * One read for every topic asked, each topic's `placeFilters` merged by
 * shape. A topic whose team is no team id maps to `undefined`.
 *
 * **Throws when the read failed**: a failed read is not "nobody".
 */
export async function topicMemberCountsAsViewer(
  topics: readonly { address: string; folder: string }[],
  relayUrl: string,
  token: StoredToken,
): Promise<Map<string, number | undefined>> {
  if (topics.length === 0) return new Map()
  const asked = topics.map((topic) => {
    const place = { address: topic.address, team: topic.folder }
    try {
      const filters = (placeFilters(place, token.pubkey) as Filter[]).filter((filter) => !(filter.kinds as number[]).includes(KIND_APP_DATA))
      return { topic, place, filters }
    } catch {
      return { topic, place, filters: undefined }
    }
  })
  const events = await viewerQuery(relayUrl, token)(mergedFilters(asked.flatMap(({ filters }) => filters ?? [])))
  return new Map(
    asked.map(({ topic, place, filters }): [string, number | undefined] => {
      if (!filters) return [topic.address, undefined]
      const mine = events.filter((event) => filters.some((filter) => answersFilter(event, filter)))
      const roster = mine.filter((event) => event.kind === KIND_ROSTER || ROSTER_COMMANDS.includes(event.kind))
      const listing = mine.filter((event) => event.kind === KIND_FOLDER_STATE || event.kind === KIND_FOLDER_COMMAND)
      const own = mine.filter((event) => !roster.includes(event) && !listing.includes(event))
      return [topic.address, placeListing(place, { events: own, roster, listing }).length]
    }),
  )
}
