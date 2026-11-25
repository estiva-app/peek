/**
 * A read the copy on the device already holds, brought up to date with NIP-77 (THE-6).
 *
 * On a reopen Peek asks the relay the questions the copy has answered before. Each one the copy holds enough of is
 * caught up instead: the copy tells the relay what it holds, the relay answers with what it lacks and what is gone
 * (a deleted message, a team the person left), and only the lacking events are fetched. The rest are asked as before.
 * The answer is the one asking would have given, and the copy holds it afterwards.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-copy-on-the-device-catches-up-with-nip-77.md
 */
import {
  CATCH_UP_SMALLEST_HELD,
  catchUp,
  matchesSnapshotFilter,
  relaySpeaksNip77,
  type CatchUpResult,
  type EventSnapshot,
  type SnapshotFilter,
} from '@estiva-app/platform'
import type { ReconcileOutcome, SignedEvent } from '@estiva-app/protocol'
import { RELAY_URL } from '@/api/relayUrl'
import { relayInfo } from './relayInfo'

type Answer = { ok: boolean; events: SignedEvent[]; reason?: string }

/** Keys only the relay can answer: the open read (SPEC §6.13), and NIP-50's search. */
const QUERY_ONLY = ['text', 'search']

/**
 * A list read (SPEC §6.13, `fields`): the copy holds it as its last answer, `null` when it never answered it or a
 * `limit` could cut it, and the relay compares it against each file's current changes (THE-9, platform 0.14).
 */
const isList = (filter: Record<string, unknown>) => 'fields' in filter

export interface CatchUpFromCopyOptions {
  relayUrl: string
  reconcile(filter: SnapshotFilter, held: readonly { id: string; created_at: number }[]): Promise<ReconcileOutcome>
  /** The plain read: over the socket or HTTP, as `queryRelay` asks. Not kept in the copy. */
  ask(filters: Record<string, unknown>[]): Promise<Answer>
  /** Keep a plain read's answer in the copy, as `queryRelay` does. */
  keep(filters: Record<string, unknown>[], events: SignedEvent[]): void
  /** Whether the relay speaks NIP-77; the relay's NIP-11 by default. */
  speaksNip77?(): boolean | Promise<boolean>
  smallestHeld?: number
}

/** One read through {@link catchUpFromCopy}, for `window.__catchUps()`: what it caught up, and what it asked plainly. */
export interface CatchUpRecord {
  at: number
  /** Filters caught up, or asked plainly inside the catch-up (too small a window, a relay without NIP-77). */
  reconciled: number
  asked: number
  fetched: number
  dropped: number
  /** Filters asked plainly beside it, each with how many events the copy held for it (`-1`: one the copy cannot judge). */
  plain: { kinds: unknown; keys: string; held: number }[]
}

const records: CatchUpRecord[] = []

/** `window.__catchUps()`: every read caught up from the copy on this page, totalled, and the last 40. */
export function catchUps() {
  const total = { reads: records.length, reconciled: 0, asked: 0, fetched: 0, dropped: 0, plain: 0 }
  for (const r of records) {
    total.reconciled += r.reconciled
    total.asked += r.asked
    total.fetched += r.fetched
    total.dropped += r.dropped
    total.plain += r.plain.length
  }
  return { ...total, recent: records.slice(-40) }
}

/** A plain read inside a catch-up that the relay refused: its answer is the catch-up's. */
class AskFailed extends Error {
  readonly answer: Answer
  constructor(answer: Answer) {
    super(answer.reason ?? 'read failed')
    this.answer = answer
  }
}

const JUDGED = new Set(['ids', 'kinds', 'authors', 'since', 'until'])

function withoutLimit(filter: Record<string, unknown>): SnapshotFilter {
  const { limit: _limit, ...rest } = filter
  return rest as SnapshotFilter
}

/**
 * What the copy holds for `filter`, the same as `copy.held(withoutLimit(filter))`, looked up by its one-letter tag
 * alone when it has one. The copy builds a set of every held event of each list a filter names before it picks the
 * smallest, and a reopen judges about 500 filters, each naming a kind with thousands held: half a second of the
 * main thread, which delayed the Desk's later reads (THE-6 /land).
 */
function heldFor(copy: EventSnapshot, filter: Record<string, unknown>): SignedEvent[] | null {
  const whole = withoutLimit(filter)
  const keys = Object.keys(whole)
  const tag = keys.find((key) => key.startsWith('#') && key.length === 2)
  // Only what the copy can judge: one-letter tags and these (`answerable` in platform's event snapshot).
  const judgeable = keys.every((key) => JUDGED.has(key) || (key.startsWith('#') && key.length === 2))
  if (!tag || !judgeable) return copy.held(whole)
  const byTag = copy.held({ [tag]: (whole as Record<string, unknown>)[tag] } as SnapshotFilter)
  return byTag && byTag.filter((event) => matchesSnapshotFilter(whole, event))
}

/** Peek's relay's NIP-11 says NIP-77; another relay, or one whose document cannot be read, is asked plainly. */
async function relaySpeaks(relayUrl: string): Promise<boolean> {
  if (!RELAY_URL || relayUrl !== RELAY_URL) return false
  return relaySpeaksNip77(await relayInfo())
}

/**
 * `null` when the copy holds none of these questions well enough to catch up, and the caller asks as before.
 * Otherwise the answer to all of `filters`: caught up where the copy holds enough, asked where it does not.
 */
export async function catchUpFromCopy(
  copy: EventSnapshot,
  filters: Record<string, unknown>[],
  options: CatchUpFromCopyOptions,
): Promise<Answer | null> {
  const smallest = options.smallestHeld ?? CATCH_UP_SMALLEST_HELD
  const singles: SnapshotFilter[] = []
  const plain: Record<string, unknown>[] = []
  const plainHeld: number[] = []
  /*
    A read loaded ahead asks one file's comments, or one team's messages, per filter: a few events each, far below
    what a catch-up is worth alone, and hundreds together. Filters alike but for one tag's values, each holding less
    than its window, are caught up as one: their union, with no window, is what each asks for.
  */
  const packs = new Map<string, { base: Record<string, unknown>; tag: string; members: Record<string, unknown>[]; held: number }>()
  const loose: { filter: Record<string, unknown>; held: number }[] = []
  for (const filter of filters) {
    // The open read and a search answer what no set of events says. A list read is held as its last answer.
    const judged = QUERY_ONLY.some((key) => key in filter)
      ? null
      : isList(filter)
        ? copy.held(filter as SnapshotFilter)
        : heldFor(copy, filter)
    if (!judged) {
      plain.push(filter)
      plainHeld.push(-1)
      continue
    }
    const tags = Object.keys(filter).filter((key) => key.startsWith('#'))
    const limit = typeof filter.limit === 'number' ? filter.limit : Infinity
    // Lists are never packed: their union is another list, which the copy never answered.
    if (tags.length === 1 && judged.length < limit && !isList(filter)) {
      const [tag] = tags
      const { [tag]: _values, limit: _limit, ...base } = filter
      const entries = Object.entries(base).map(([name, value]): [string, unknown] => [name, Array.isArray(value) ? [...value].sort() : value])
      const key = `${tag} ${JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : 1)))}`
      const pack = packs.get(key) ?? { base, tag, members: [], held: 0 }
      pack.members.push(filter)
      pack.held += judged.length
      packs.set(key, pack)
    } else loose.push({ filter, held: judged.length })
  }
  const packed: { filter: SnapshotFilter; members: Record<string, unknown>[] }[] = []
  for (const pack of packs.values()) {
    if (pack.members.length === 1) loose.push({ filter: pack.members[0], held: pack.held })
    else if (pack.held < smallest) for (const member of pack.members) loose.push({ filter: member, held: 0 })
    else {
      const values = [...new Set(pack.members.flatMap((member) => member[pack.tag] as unknown[]))]
      // At most what the members ask together: one file that grew by thousands while away is asked by its window,
      // not fetched whole through the union.
      const limits = pack.members.map((member) => member.limit)
      const limit = limits.every((each) => typeof each === 'number') ? (limits as number[]).reduce((a, b) => a + b, 0) : undefined
      const filter = { ...pack.base, [pack.tag]: values, ...(limit !== undefined ? { limit } : {}) } as SnapshotFilter
      packed.push({ filter, members: pack.members })
    }
  }
  for (const { filter, held } of loose) {
    if (held >= smallest) singles.push(filter as SnapshotFilter)
    else {
      plain.push(filter)
      plainHeld.push(held)
    }
  }
  if (singles.length === 0 && packed.length === 0) return null
  // A relay without NIP-77 is asked as before, each question as it was put.
  const speaks = await Promise.resolve()
    .then(() => (options.speaksNip77 ?? (() => relaySpeaks(options.relayUrl)))())
    .catch(() => false)
  if (!speaks) return null
  const record: CatchUpRecord = {
    at: Date.now(),
    reconciled: 0,
    asked: 0,
    fetched: 0,
    dropped: 0,
    plain: plain.map((filter, i) => ({
      kinds: filter.kinds,
      keys: Object.keys(filter).filter((key) => key !== 'kinds').join(','),
      held: plainHeld[i],
    })),
  }
  records.push(record)
  // About one reopen's reads: enough to read what a reopen did, little to keep for a tab left open all day.
  if (records.length > 200) records.splice(0, records.length - 200)

  const asked = plain.length
    ? options.ask(plain).then((answer) => {
        if (answer.ok) options.keep(plain, answer.events)
        return answer
      })
    : Promise.resolve<Answer>({ ok: true, events: [] })
  const relay = {
    speaksNip77: () => true,
    reconcile: options.reconcile,
    query: async (asking: SnapshotFilter[]) => {
      const answer = await options.ask(asking)
      if (!answer.ok) throw new AskFailed(answer)
      return answer.events
    },
  }
  const tally = (result: CatchUpResult) => {
    record.reconciled += result.reconciled
    record.asked += result.asked
    record.fetched += result.fetched
    record.dropped += result.dropped
  }
  const failedAs = (error: unknown): Answer => {
    if (error instanceof AskFailed) return error.answer
    throw error
  }
  const caught: Promise<Answer> = singles.length
    ? catchUp(copy, singles, relay).then((result) => (tally(result), { ok: true, events: result.events }), failedAs)
    : Promise.resolve({ ok: true, events: [] })
  const members = packed.flatMap((pack) => pack.members)
  const caughtPacks: Promise<Answer> = packed.length
    ? catchUp(
        copy,
        packed.map((pack) => pack.filter),
        relay,
      ).then(async (result): Promise<Answer> => {
        tally(result)
        // A pack the relay would not compare was asked whole, and a whole answer may be cut where its members were
        // not: they are asked as they were put instead.
        if (result.asked > 0) {
          const answer = await options.ask(members)
          if (answer.ok) options.keep(members, answer.events)
          return answer
        }
        // Each member's answer is its window of what the copy now holds for the pack.
        const out: SignedEvent[] = []
        for (const member of members) {
          const held = (heldFor(copy, member) ?? []).sort(byRelayOrder)
          out.push(...(typeof member.limit === 'number' ? held.slice(0, member.limit) : held))
        }
        return { ok: true, events: out }
      }, failedAs)
    : Promise.resolve({ ok: true, events: [] })
  const answers = await Promise.all([asked, caught, caughtPacks])
  const failed = answers.find((answer) => !answer.ok)
  if (failed) return failed
  const seen = new Set<string>()
  const events: SignedEvent[] = []
  for (const event of answers.flatMap((answer) => answer.events)) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    events.push(event)
  }
  return { ok: true, events: events.sort(byRelayOrder) }
}

/** Newest first, then by id: the order a relay answers in. */
function byRelayOrder(a: SignedEvent, b: SignedEvent): number {
  return b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
