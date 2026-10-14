/**
 * Reading and acting on another app's objects, from the browser (PEEK-106).
 *
 * This replaces `convex/nostr/foreign.ts` and `convex/nostr/act.ts` outright.
 * Neither had any business being on the backend: `foreign.ts` said so in its own
 * header — *"All the logic lives in `projection.ts`, which takes a query
 * function and knows nothing about Convex. This file supplies the authenticated
 * bridge and nothing else."* Once the browser can supply that bridge, the file
 * has nothing left to do, and `act.ts` is the same story with a publish on the
 * end.
 *
 * Nothing is persisted by any of this. A resolved widget is drawn and forgotten,
 * so there was never a Convex row involved — only a relay read that happened to
 * be made from the wrong place.
 *
 * **Everything here reads and signs as the signed-in viewer**, which is not a
 * preference. The relay is NIP-98 gated on every route and answers a non-member
 * with `403 relay_membership_required`, so the person looking at the object is
 * the only identity guaranteed to see it. There is no fallback: Peek holds no
 * keys, and a service credential would be a member of nothing.
 */
import type { StoredToken } from '@/auth/estivaId'
import { declaredKinds, rememberRouteWords, routeWordsOf, type RouteWords } from '@/lib/objectUrl'
import type { CreatableKindRead } from '@/lib/liveAction'
import { KIND, parseProfile, type SignedEvent } from '@estiva-app/protocol'

/** NIP-29 channel metadata — Peek's Topic. Its `d` is the channel uuid. */
export const KIND_TOPIC = 39000
/** NIP-29 channel message — what a Peek message is on the wire. */
const KIND_MESSAGE = 9
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { readFrom, type ReadSource } from './readFrom'
import { RelayReadError } from './relayRead'
import { rootOf } from './channelStreams'
import { dmChannelsOf, KIND_CHANNEL_MEMBERS } from './dms'
import { folderDeletableOf, type FolderDeletable } from './folderDeletable'
import {
  buildBareFile,
  decodeNevent,
  encodeNaddr,
  pointerToAddress,
  referenceToPointer,
  type AddressPointer,
  type UnsignedEvent,
  absenceOf,
  partTag,
} from '@estiva-app/protocol'
import {
  KIND_BARE_FILE,
  KIND_CHANNEL_METADATA,
  matchObjectUrl,
  urlPatternsOf,
  blockUrlOf,
  buildActionEvents,
  KIND_FOLDER_STATE,
  folderOf,
  createPeopleCache,
  createProjectionCache,
  resolveFolderProject,
  resolveFolderContents,
  listFolders,
  resolveForeignEvent,
  resolveForeignObject,
  resolveForeignObjects,
  resolveManifest,
  resolveActingManifest,
  resolveParents,
  topLevelFolders,
  type FolderContents,
  type FolderSummary,
  type FolderProject,
  type ForeignObject,
  type People,
  type PeopleFn,
  type ResolvedAction,
  type QueryFn,
  type ConversationMessage,
  type UnsignedActionEvent,
  conversationsOf,
  threadsOf,
  type Threads,
  planCreateFolder,
  planDeleteFolder,
  type MovableFile,
  planMoveFromFolders,
  listedBeneath,
  planPlaceFile,
  planRenameFolder,
  planUnlistFile,
  planArchiveFolder,
  archiveImpact,
  type ArchiveImpact,
  type ArchiveReadOptions,
  type FolderRef,
  fileCandidates,
  resolveForeignRoots,
  searchFileReferences,
} from '@estiva-app/interop'
import type { ReferenceCandidate } from '@estiva-app/conversation'

export interface ActResult {
  ok: boolean
  reason?: string
}

const fail = (reason: string): ActResult => ({ ok: false, reason })

/** Relay reads as the viewer. Their pubkey comes off the stored token, so no
 *  JWT parsing is needed here — the backend had to do that only because it was
 *  handed a bare string.
 *
 *  **Throws on a failed read rather than returning `[]`** (PEE-10). This line
 *  used to be `(await queryRelay(…)).events`, discarding `ok` and `reason` — so
 *  a refused read arrived at the caller as an empty array, indistinguishable
 *  from a successful read that found nothing. Every "empty panel that actually
 *  means refused" in this app started here, one layer below where it was
 *  visible. Callers that must degrade quietly catch it explicitly, which is
 *  better than the information never existing. */
export function viewerQuery(relayUrl: string, token: StoredToken): QueryFn {
  return async (filters) => {
    const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    return result.events
  }
}

/**
 * {@link viewerQuery} against the copy on the device (PEE-2). A read the copy
 * cannot answer throws, as a refused one does: the copy is a head start, and
 * what it does not hold the relay answers.
 */
function copyQuery(relayUrl: string, token: StoredToken): QueryFn {
  return async (filters) => {
    const result = await readFrom('copy', relayUrl, filters, token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    return result.events
  }
}

/**
 * Profiles already looked up this session (FEE-1), now from the runtime.
 *
 * A topic with ten reference widgets resolves ten times, each asking who the
 * same handful of people are. Module scope rather than per-call, so the sidebar
 * and every widget in the conversation share one answer — and so the store
 * outlives `viewerQuery`, which is rebuilt per call because it carries the
 * viewer's token.
 *
 * The implementation was here and is now `@estiva-app/interop`'s (SHA-16),
 * unchanged: one batched lookup for the whole unknown set, and a miss expiring
 * much sooner than a hit — a hit is a name and names change rarely, a miss is
 * somebody who has not finished setting up their Estiva ID, which is precisely
 * the person whose name is about to arrive (PEE-3). Ship needed the same
 * behaviour, and a second consumer is what moves something out of one app
 * rather than duplicating it. Its tests moved with it.
 */
const profiles = createPeopleCache()

const cachedPeople = (query: QueryFn): PeopleFn => profiles.viaRelay(query)

/**
 * Manifests already resolved this session — interop's `ProjectionCache`, owned
 * here because interop refuses to own it ("invisible global state"), and at
 * module scope for the reason `profiles` is: the tree, the listing and every
 * widget in a conversation ask about the same three apps.
 *
 * Nothing in Peek passed one until FOL-21 measured the Folder tree against
 * production: opening a fold cost 13 `POST /query` and expanding a project row
 * 8, cold and warm identical, because every resolve re-fetched each app's
 * manifest — two POSTs per app, per call — against a meter of 300 a minute
 * (`scripts/probe-fol21-tree-cost.ts`). With this, the same fold is 3 and the
 * same row 2. Only the manifest is remembered: the object, its changes, its
 * comments and its children are what a refresh exists to notice.
 *
 * For an hour, not interop's five minutes (PER-11). Nothing in Peek clears
 * this when a manifest is republished — `forgetUrlShapes` is called only by
 * tests, and the live socket holds only events carrying a Folder's `h`, which
 * a global `kind:31990` never does — so the TTL is the only thing that
 * refreshes it. At five minutes it cost an idle Desk 12 of its 28 requests
 * every five minutes, measured on production after PER-10: the recommendation
 * and the manifest, for each of six apps, every window. At an hour that is the
 * same 12 once an hour. The price is that another app's republished manifest
 * can take an hour to reach an open tab; a reload picks it up at once.
 */
const manifests = createProjectionCache(60 * 60_000)

/**
 * Resolve a `nostr:naddr…` into a renderable widget.
 *
 * `null` when it cannot be resolved — a broken reference in a message degrades
 * to plain text rather than breaking the message.
 *
 * That includes a relay read that failed, which is why the catch is here and
 * explicit: `viewerQuery` now throws so the *sidebar* can tell a refusal from
 * an empty Folder, and this path deliberately does not want to know. A
 * reference widget is inline in somebody's sentence; the worst thing it can do
 * is turn a message into an error.
 */
/**
 * Every URL shape any app has published, cached for the session.
 *
 * One query answers it for the whole ecosystem — `kind:31990` is global, so
 * this is the registry, and there is no service to keep alive (RFC 0.5 §7.5).
 * Cached because a conversation full of links would otherwise ask once per
 * link, and the answer changes only when somebody republishes a manifest.
 */
let shapesPromise: Promise<ReturnType<typeof urlPatternsOf>> | null = null

/** Forget the cached shapes and manifests. Only tests call it today. */
export function forgetUrlShapes(): void {
  shapesPromise = null
  manifests.clear()
}

async function urlShapes(query: QueryFn) {
  shapesPromise ??= query([{ kinds: [31990], limit: 100 }]).then((manifests) => {
    const shapes = manifests.flatMap((manifest) => urlPatternsOf(manifest))
    // The same read answers which words Peek routes (FOL-39); `filePath` reads
    // the registry in render, where it cannot await this.
    rememberRouteWords(routeWordsOf(shapes))
    return shapes
  })
  try {
    return await shapesPromise
  } catch (error) {
    // A failed read must not poison the session — the next message tries again.
    shapesPromise = null
    throw error
  }
}

/**
 * The route words the manifests declare — FOL-39. One read, cached with the
 * shapes; `App` asks once so links are the short form from the first render
 * after it. Throws for an outage the way every viewer read does.
 */
export async function routeWordsAsViewer(relayUrl: string, token: StoredToken): Promise<RouteWords> {
  return routeWordsOf(await urlShapes(viewerQuery(relayUrl, token)))
}

/**
 * The address of the file a `/<word>/<slug>-<d>` route names, or null —
 * FOL-37 for a bare file, FOL-39 for every declared shape.
 *
 * The short route carries only the `d`, and a NIP-33 address also needs the
 * author. This is the one `#d` query that recovers it, on the same footing as
 * `referenceFromUrlAsViewer` below: RFC 0.5 §7.4 measured that no `(kind, d)`
 * is shared by two authors, so `limit: 1` over the word's kinds is the whole
 * answer. A word no manifest declares is resolved over every kind any of them
 * does (§7.7 rule 4) — and never as a bare `#d`, because a Folder's 39000 and
 * its 30890 share one uuid (§7.4's correction) and a bare `#d` could answer
 * with either. The `d` is returned as given rather than read back off the
 * event, so the address the page then resolves is the one the link named.
 *
 * Throws a `RelayReadError` rather than answering null for an outage: the
 * page tells "nothing has this `d`" apart from "the relay could not be asked",
 * the way `useForeignConversation` does for the resolve that follows.
 */
export async function fileAddressAsViewer(
  word: string,
  identifier: string,
  relayUrl: string,
  token: StoredToken,
): Promise<string | null> {
  const query = viewerQuery(relayUrl, token)
  const words = routeWordsOf(await urlShapes(query))
  const kinds = words.byWord[word.toLowerCase()] ?? declaredKinds(words)
  const [found] = await query([{ kinds: [...kinds], '#d': [identifier], limit: 1 }])
  return found ? `${found.kind}:${found.pubkey}:${identifier}` : null
}

/**
 * The Folder a file's conversation is written in, for a record that carries
 * no `h` — PEE-33.
 *
 * `ForeignObject.folder` is the root's `h` and nothing else, and a Ship
 * project has none: it is placed under its team by a `kind:1852`, and its
 * conversation lives in the channel its `buzz-channel` tag names. That tag is
 * what interop's own `folderOf` reads for a write (`applyActionAsViewer` puts
 * a root comment there), what Ship reads a project's conversation from
 * (`project.contentFolder`), and the `h` the project's existing comments
 * carry — measured on production 2026-09-21 for the Conversation standard
 * project. So the answer is read off the record with the same rule, one read.
 *
 * Not the `kind:30890` state that lists the file, which the ticket also
 * named: that is the *team* Folder, and a comment written with its `h` is
 * one Ship's project page never shows, since that page filters by the
 * project's own channel. Two of UI Guardrails' three comments are already
 * there, invisible to Ship. And no state lists a file placed by `h` alone,
 * so it would not have covered every record either.
 *
 * `null` when the record says nothing, which is a real answer: a file with no
 * Folder has nowhere for a comment to go, and the page falls back to the
 * read-only view rather than guessing.
 */
export async function fileFolderAsViewer(address: string, relayUrl: string, token: StoredToken): Promise<string | null> {
  const query = viewerQuery(relayUrl, token)
  const pointer = referenceToPointer(address)
  const [root] = await query([
    { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 },
  ])
  return root ? folderOf(root) : null
}

/**
 * What a pasted app URL names: an addressable object, by its NIP-33 address,
 * or an event, by its id. The two are resolved differently and tagged
 * differently, so the caller is told which it has rather than left to sniff.
 */
export type UrlReference =
  | {
      address: string
      eventId?: undefined
      /** One block of it, from a link like Ship's Copy link (`#block-<id>`, SPEC §13.6.1, COM-2). */
      block?: string
    }
  | { eventId: string; address?: undefined; block?: undefined }

/**
 * The reference a pasted app URL names, or null — RFC 0.5 §7.5, PRO-15.
 *
 * **Two steps, and the second is why this cannot be a pure function.**
 * `matchObjectUrl` recovers the kind and the `d`; a NIP-33 address also needs
 * the author, and only the relay knows who that is. So a matched URL costs one
 * `#d` query, which §7.4's measurement makes unambiguous: no `(kind, d)` is
 * shared by two authors.
 *
 * A URL that names an event — Peek's `/message/<id>`, or a thread's
 * `?thread=<id>` (FOL-38) — costs nothing: the id is the whole identity, and
 * whether the event exists is the resolver's question, not this one's.
 *
 * A URL no manifest claims returns null and stays a plain link, which §7.5 says
 * is the honest outcome — it is a link, and nothing should pretend otherwise.
 */
export async function referenceFromUrlAsViewer(
  url: string,
  relayUrl: string,
  token: StoredToken,
): Promise<UrlReference | null> {
  const query = viewerQuery(relayUrl, token)
  try {
    const hit = matchObjectUrl(url, await urlShapes(query))
    if (!hit) return null
    if (hit.by === 'id') return { eventId: hit.identifier }
    const filter: Record<string, unknown> = { '#d': [hit.identifier], limit: 1 }
    // Narrow by kind when the app named one. Without it the `d` alone is still
    // unambiguous, but the query is cheaper and the intent is clearer.
    if (hit.kind !== undefined) filter.kinds = [hit.kind]
    const [found] = await query([filter])
    if (!found) return null
    const address = `${found.kind}:${found.pubkey}:${hit.identifier}`
    return hit.block === undefined ? { address } : { address, block: hit.block }
  } catch (error) {
    if (error instanceof RelayReadError) return null
    throw error
  }
}

/**
 * What an app link's card is for, as SPEC §13.6.2 lets a link name one: the
 * `embed` value — an address, or a message's event id — or null (OPT-17).
 *
 * §7.7 as `referenceFromUrlAsViewer` reads it, and **stricter in one place**:
 * the `#d` query asks for two, and a `d` that two authors hold names nothing.
 * `limit: 1` would hand the card to whichever answered first, so anybody who
 * publishes the same `(kind, d)` could put their object's card under a link to
 * somebody else's — §13.6.2's "one author for the identity". A link to one
 * block names its part (§13.6.1), not a card, so it is null too.
 *
 * Throws a `RelayReadError` for an outage, so a caller that remembers answers
 * does not remember "the relay could not be asked" as "nothing".
 */
export async function cardValueOfUrlAsViewer(url: string, relayUrl: string, token: StoredToken): Promise<string | null> {
  const query = viewerQuery(relayUrl, token)
  const hit = matchObjectUrl(url, await urlShapes(query))
  if (!hit || hit.block !== undefined) return null
  if (hit.by === 'id') return /^[0-9a-f]{64}$/i.test(hit.identifier) ? hit.identifier.toLowerCase() : null
  const filter: Record<string, unknown> = { '#d': [hit.identifier], limit: 2 }
  if (hit.kind !== undefined) filter.kinds = [hit.kind]
  const found = await query([filter])
  const authors = new Set(found.map((event) => `${event.kind}:${event.pubkey}`))
  if (authors.size !== 1) return null
  return `${[...authors][0]}:${hit.identifier}`
}

/**
 * The tags a comment carries for the app URLs its body names — the index half
 * of a pasted link, as `referenceTagsFor` is for a `nostr:naddr…` (FOL-38).
 *
 * An addressable object is an `a` tag, the same index CON-11's Activity reads;
 * the file the comment is on is left out for the reason `referenceTagsFor`
 * gives. An event is a `q` tag — NIP-18's quote — and **not** an `e`: on a
 * `kind:1111` a lowercase `e` is NIP-22's parent, and a root that carried one
 * would read as a reply to whatever it mentioned (`fileMentions.ts` files a
 * thread by its first `e`). The ticket said "an `a` or `e` tag"; `q` is the
 * tag that says *mentioned* without saying *replied to*.
 *
 * Resolved here rather than in the composer because a URL is prose until it
 * is sent — nothing chips it — and the address needs the relay anyway.
 * A link that resolves to nothing carries no tag; the body still has it.
 * Takes the URLs rather than the body: `findUrls` lives with the composer's
 * parser (`lib/textParsing`), which this module does not import.
 */
export async function urlReferenceTagsAsViewer(
  urls: readonly string[],
  own: string,
  relayUrl: string,
  token: StoredToken,
): Promise<string[][]> {
  if (urls.length === 0) return []
  const found = await Promise.all([...new Set(urls)].map((url) => referenceFromUrlAsViewer(url, relayUrl, token)))
  const addresses = new Set<string>()
  const events = new Set<string>()
  // One block per address, the first link's (SPEC §13.6.1): `partsOf` reads
  // only the first tag for an address, so writing a second would be noise.
  const parts = new Map<string, string>()
  for (const ref of found) {
    if (!ref) continue
    if (ref.address !== undefined) {
      if (ref.address !== own) addresses.add(ref.address)
      // A block of the file this is said on is still shown: its `a` is the
      // comment's own (NIP-22), but the part says which block to draw.
      if (ref.block !== undefined && !parts.has(ref.address)) parts.set(ref.address, ref.block)
    }
    if (ref.eventId !== undefined) events.add(ref.eventId)
  }
  return [
    ...[...addresses].map((a) => ['a', a]),
    ...[...events].map((id) => ['q', id]),
    ...[...parts].map(([address, block]) => partTag(address, block)),
  ]
}

/**
 * Why an object a part points at did not come back (SPEC §13.6.1, COM-2):
 * `deleted` when the relay holds a deletion of it that somebody was entitled
 * to make, otherwise `unreadable` — which also covers an address that never
 * existed, and says nothing about whether it does.
 *
 * Only called after a read by address came back empty: a Folder the viewer is
 * not in is skipped silently, so the empty answer cannot say why and a
 * deletion is the one thing that can.
 */
export async function absenceAsViewer(
  address: string,
  relayUrl: string,
  token: StoredToken,
): Promise<'deleted' | 'unreadable'> {
  const deletions = await viewerQuery(relayUrl, token)([{ kinds: [5], '#a': [address], limit: 20 }])
  return absenceOf(address, deletions)
}

/**
 * The link that opens one block of an object in the app that owns it, from
 * that app's own `urls` shape — undefined until the app declares a `<block>`
 * fragment, when the caller links to the whole object instead.
 */
export async function blockLinkAsViewer(
  target: { address: string; title?: string; block: string },
  relayUrl: string,
  token: StoredToken,
): Promise<string | undefined> {
  const [kind, , d] = target.address.split(':')
  if (!d) return undefined
  try {
    const shapes = await urlShapes(viewerQuery(relayUrl, token))
    return blockUrlOf(shapes, { kind: Number(kind), d, title: target.title, block: target.block })
  } catch (error) {
    if (error instanceof RelayReadError) return undefined
    throw error
  }
}

export async function resolveObjectAsViewer(
  reference: string,
  relayUrl: string,
  token: StoredToken,
  /**
   * `archivedWith` for the page a link opens (FOL-46): it draws "Archived with
   * its project", which costs a read of the parent. Every widget and card
   * resolve leaves it off, so a refresh tick pays nothing new.
   */
  options?: ArchiveReadOptions,
): Promise<ForeignObject | null> {
  const query = viewerQuery(relayUrl, token)
  try {
    /*
      A pasted app URL is a reference too (PRO-15).

      Taken here rather than at each call site so every surface that already
      renders an `naddr` — a message, a thread reply, a comment — renders a
      pasted link with no further wiring. `referenceFromUrlAsViewer` returns
      null for a URL no manifest claims, and null is what the widget draws
      nothing for, so an ordinary link is unaffected. A URL that names an
      event — a message, a thread's root comment — takes the event path below
      (FOL-38); before that, its id was put to a `#d` query and found nothing.
    */
    if (/^https?:\/\//i.test(reference)) {
      const ref = await referenceFromUrlAsViewer(reference, relayUrl, token)
      if (!ref) return null
      if (ref.eventId !== undefined) {
        return await resolveForeignEvent(ref.eventId, query, cachedPeople(query), manifests)
      }
      return await resolveForeignObject(ref.address, query, cachedPeople(query), 0, manifests, options)
    }
    /*
      A message is an event, not an address (RIC-11).

      `resolveForeignObject` takes an `naddr` or a `<kind>:<pubkey>:<d>` and
      nothing else — a `kind:9` has no `d`, so it cannot be spelled that way and
      `referenceToPointer` throws on its `nevent`. PRO-11 built the counterpart
      for exactly this case and nothing called it: a mention of a message in a
      body reached this function, threw, was caught below and drew as its own
      shortened URI, which is the "never blank" rule doing its job over a gap
      rather than a resolution. Dispatched by form, so every surface that
      already resolves a reference resolves a message with no further wiring.
    */
    if (isEventReference(reference)) {
      return await resolveForeignEvent(reference, query, cachedPeople(query), manifests)
    }
    return await resolveForeignObject(reference, query, cachedPeople(query), 0, manifests, options)
  } catch (error) {
    if (error instanceof RelayReadError) return null
    throw error
  }
}

/**
 * The query a read from the copy on the device runs on, with people and
 * manifest caches of its own: what the copy lacks must not be held as a miss or
 * a failure the relay's answer would then wait out (PEE-2).
 */
/**
 * Nothing publishes over the copy (PEE-2): an edit started from it would write
 * its older value over a newer one. Until the relay's answer replaces it, an
 * object from the copy offers only a comment, which overwrites nothing.
 */
function drawOnly(object: ForeignObject | null): ForeignObject | null {
  return object ? { ...object, actions: (object.actions ?? []).filter((action) => action.id === 'comment') } : null
}

function fromCopy(relayUrl: string, token: StoredToken) {
  const query = copyQuery(relayUrl, token)
  return { query, people: createPeopleCache().viaRelay(query), cache: createProjectionCache(0) }
}

/**
 * {@link resolveObjectAsViewer} for a file or a message, answered by the copy
 * on the device (PEE-4) — the same reads, so what the relay resolved before
 * resolves the same way. Undefined when the copy cannot answer it: a link, or
 * what it does not hold whole, which only the relay can call missing.
 */
export async function resolveObjectFromCopy(
  reference: string,
  relayUrl: string,
  token: StoredToken,
  options?: ArchiveReadOptions,
): Promise<ForeignObject | undefined> {
  if (/^https?:\/\//i.test(reference)) return undefined
  const { query, people, cache } = fromCopy(relayUrl, token)
  try {
    if (isEventReference(reference)) return drawOnly(await resolveForeignEvent(reference, query, people, cache)) ?? undefined
    return drawOnly(await resolveForeignObject(reference, query, people, 0, cache, options)) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * `[`'s search tier (PEE-21): the files whose current title holds `text`, as
 * this viewer can read them. Rejects on a refused read, which the search
 * answers as no hits for a while.
 */
export function searchFileReferencesAsViewer(text: string, relayUrl: string, token: StoredToken): Promise<ReferenceCandidate[]> {
  return searchFileReferences(text, viewerQuery(relayUrl, token), { cache: manifests })
}

/**
 * `[`'s rows for files already in hand — a Folder's listing — or known only by
 * address — the files read recently, `at` each one's read marker (PEE-21).
 * Addresses are read as roots and changes alone: what a file is called now,
 * never its conversation.
 */
export async function fileCandidatesAsViewer(
  files: readonly ForeignObject[] | { addresses: readonly string[]; at: ReadonlyMap<string, number> },
  tier: number,
  relayUrl: string,
  token: StoredToken,
): Promise<ReferenceCandidate[]> {
  const query = viewerQuery(relayUrl, token)
  if (!('addresses' in files)) return fileCandidates(files, tier, query, { cache: manifests })
  const objects = await resolveForeignRoots(files.addresses, query, manifests)
  return fileCandidates(objects, tier, query, { cache: manifests, at: files.at })
}

/**
 * A set of references in one read — PER-10.
 *
 * `resolveObjectAsViewer` is a request per reference, and the sets Peek keeps
 * live re-read on every refresh: the Screener asked once per followed file,
 * every minute, and that was 144 of an idle Desk's 194 requests in five
 * minutes against a meter of 300 a minute that every tab shares. The addresses
 * here go to interop's `resolveForeignObjects` together — one POST for the set
 * and one people lookup. A pasted URL or an event reference has no address to
 * pool, so each keeps the single path, where a failure loses only its own
 * answer.
 *
 * **Throws `RelayReadError` when the pooled read is refused**, where the single
 * form answers null. A set re-read on a timer must be able to keep what it held
 * rather than blank every row at once; a caller that wants null catches it.
 *
 * From the copy (`source: 'copy'`), a set answers the files and messages the
 * copy holds whole and leaves the rest out — no key, not null, since the copy
 * not holding one says nothing about whether it exists. Only a lone file it
 * lacks, asked alone, throws.
 */
export async function resolveObjectsAsViewer(
  references: readonly string[],
  relayUrl: string,
  token: StoredToken,
  source: ReadSource = 'relay',
): Promise<Record<string, ForeignObject | null>> {
  const single = (reference: string) => /^https?:\/\//i.test(reference) || isEventReference(reference)
  const addresses = references.filter((reference) => !single(reference))
  if (source === 'copy') {
    // From the copy, files and messages: a link is drawn from the relay as before.
    const messages = references.filter(isEventReference)
    if (!addresses.length && !messages.length) return {}
    const fromCopy = copyQuery(relayUrl, token)
    // Its own people and manifest caches: what the copy lacks must not be held
    // as a miss or a failure the relay's answer would then wait out.
    const people = createPeopleCache().viaRelay(fromCopy)
    const cache = createProjectionCache(0)
    // A message the copy holds whole draws, as one in a topic does (PEE-4); the rest wait for the relay.
    const drawn = await Promise.all(
      messages.map((reference) =>
        resolveForeignEvent(reference, fromCopy, people, cache).then(
          (object) => (object ? { [reference]: object } : {}),
          () => ({}),
        ),
      ),
    )
    const found: Record<string, ForeignObject | null> = Object.assign({}, ...drawn)
    const all = addresses.length ? { ...found, ...(await filesFromCopy(fromCopy, people, cache, messages.length > 0)) } : found
    return Object.fromEntries(Object.entries(all).map(([reference, object]) => [reference, drawOnly(object)]))
  }
  const query = viewerQuery(relayUrl, token)
  const [pooled, singles] = await Promise.all([
    addresses.length ? resolveForeignObjects(addresses, query, cachedPeople(query), manifests) : {},
    Promise.all(
      references
        .filter(single)
        .map(async (reference) => [reference, await resolveObjectAsViewer(reference, relayUrl, token).catch(() => null)] as const),
    ),
  ])
  return { ...pooled, ...Object.fromEntries(singles) }

  /** The files, from the copy; `quiet` when messages were asked too, so a lone file's miss is no answer rather than a throw. */
  async function filesFromCopy(
    fromCopy: QueryFn,
    people: ReturnType<ReturnType<typeof createPeopleCache>['viaRelay']>,
    cache: ReturnType<typeof createProjectionCache>,
    quiet: boolean,
  ): Promise<Record<string, ForeignObject | null>> {
    try {
      return await resolveForeignObjects(addresses, fromCopy, people, cache)
    } catch (error) {
      if (!(error instanceof RelayReadError)) throw error
      if (addresses.length === 1) {
        if (quiet) return {}
        throw error
      }
      /*
        One read the copy never saw sinks the whole set: a project's children's
        changes are asked only once the set's own read has answered — 5.6 s into
        Miky's Desk — so a reload in those first seconds left the copy without
        them, and every Screener file waited for the relay (PEE-2, 13 Oct). Each
        file on its own draws when the copy holds all of it; the rest wait.
      */
      const each = await Promise.all(
        addresses.map((address) =>
          resolveForeignObjects([address], fromCopy, people, cache).catch((missed: unknown) => {
            if (missed instanceof RelayReadError) return {}
            throw missed
          }),
        ),
      )
      return Object.assign({}, ...each) as Record<string, ForeignObject | null>
    }
  }
}

/**
 * The parent each file sits under, for a set — FOL-50.
 *
 * Interop's `resolveParents`: the roots, and the moves where a kind can be
 * moved, in one POST for the set once the manifests are cached — where
 * `resolveObjectsAsViewer` would read every file's comments and children too.
 * A parent's address, `null` at the top, and no key where nothing can be told.
 *
 * **Throws `RelayReadError` when the read is refused**, like the pooled object
 * read: an unanswered set is not a set of files at the top.
 */
export async function resolveParentsAsViewer(
  references: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<Record<string, string | null>> {
  return resolveParents(references, viewerQuery(relayUrl, token), manifests)
}

/** `nostr:nevent1…`, `nostr:note1…`, or a bare 64-hex event id. */
export function isEventReference(reference: string): boolean {
  const bare = reference.replace(/^nostr:/i, '')
  return /^(?:nevent|note)1/i.test(bare) || /^[0-9a-f]{64}$/i.test(bare)
}

/**
 * The key the relay signs its channel records with — the `<pubkey>` in every
 * topic's address (RIC-11).
 *
 * A topic is `39000:<relay-pubkey>:<channel-uuid>` (RFC 0.4 §5.2), and Peek
 * holds the uuid on every topic row but has never held the key: no surface
 * needed to *write* a topic's address before a mention did. §5.3 measured the
 * key as one per deployment and non-rotating — every relay-signed event on
 * production has a single author, equal to NIP-11 `self` — so it is read off
 * any one channel record rather than fetched per topic, and read once.
 *
 * `null` when the relay serves no channel record this viewer can read, which
 * is a real answer: a mention then falls back to the bracket form, exactly as
 * a person with no key is still mentioned by name.
 */
export async function relaySigningKeyAsViewer(relayUrl: string, token: StoredToken): Promise<string | null> {
  const query = viewerQuery(relayUrl, token)
  try {
    const [record] = await query([{ kinds: [KIND_TOPIC], limit: 1 }])
    return record?.pubkey ?? null
  } catch (error) {
    if (error instanceof RelayReadError) return null
    throw error
  }
}

/**
 * The project in a Folder, for the topic sidebar.
 *
 * `null` means "no project here" — a normal state the sidebar draws as an empty
 * panel, not an error.
 *
 * **Throws {@link RelayReadError} when the read itself failed**, which is a
 * different thing and now says so. The sidebar draws the two differently:
 * before this, a refused read and an empty Folder both produced "No project
 * linked to this topic", which is the exact ambiguity PEE-10 exists to remove.
 */
export async function resolveFolderProjectAsViewer(
  folder: string,
  relayUrl: string,
  token: StoredToken,
): Promise<FolderProject | null> {
  const query = viewerQuery(relayUrl, token)
  return resolveFolderProject(folder, query, cachedPeople(query), 0, manifests)
}

/**
 * Create a Folder — a `kind:9007`, the same event that creates a channel.
 *
 * **A Folder *is* a Buzz channel** (RFC 0.4 §4.1), so there is no new kind to
 * publish and nothing to migrate: the container that has always carried access
 * and conversation is the container files now live in. The relay emits the
 * `kind:39000` whose `name` this list reads.
 *
 * **Then a `kind:1852`, so the Folder has state from birth** (PEE-31). Until
 * 2026-09-15 none was sent — an empty Folder had nothing to list and the name
 * was on the channel — and that left a person-made Folder indistinguishable
 * from a Ship record channel or a test topic, which are also bare channels.
 * The navigation lists only Folders with state (`topLevelFolders`), so a
 * Folder without one would be created and never seen. The command names the
 * Folder and lists nothing, which is what it holds; a `kind:1852` on a Folder
 * that already holds files by `h` is the case `renameFolderAsViewer` forbids,
 * and a channel this function just created holds none.
 *
 * Note what this is *not*: creating a Peek **topic**, which additionally
 * records a Convex row and publishes memberships (`publishTopicChannel`). Today
 * those two acts produce the same wire object, which is the conflation RFC 0.4
 * §11.1 exists to end.
 */
export async function createFolderAsViewer(
  name: string,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const id = crypto.randomUUID()
  const result = await publishInOrder(planCreateFolder(token.pubkey, Date.now(), { folder: id, name }), relayUrl, token)
  if (result.ok) return { ok: true, id }
  if (result.index === 0) return { ok: false, reason: result.reason ?? 'The relay refused to create the folder.' }
  // The channel exists and is reachable by its id; only the list will not show it.
  return { ok: false, reason: 'The folder was created but the relay refused to list it. Reload and rename it to try again.' }
}

/**
 * Sign and publish a Folder plan in order, stopping at the first refusal.
 *
 * The plans are `@estiva-app/interop`'s (FOL-4): the events and their order are
 * shared with Ship, and each app keeps its own signing and its own words for a
 * refusal part-way through — which `index` is what lets the caller choose.
 */
const dOf = (event: SignedEvent) => event.tags.find((t) => t[0] === 'd')?.[1]

/**
 * The `kind:30890` states `filter` finds, keeping only those signed by the key
 * that signed their Folder's channel record (`kind:39000`, same `d`) — the
 * relay, which writes both. Two reads, each one filter; nothing when no state
 * matched.
 */
async function relayStates(query: QueryFn, filter: Record<string, unknown>): Promise<SignedEvent[]> {
  const states = await query([filter])
  const ids = [...new Set(states.map(dOf).filter((id): id is string => !!id))]
  if (ids.length === 0) return []
  const channels = await query([{ kinds: [KIND_CHANNEL_METADATA], '#d': ids, limit: ids.length * 2 }])
  const signers = new Set(channels.map((channel) => `${dOf(channel)}:${channel.pubkey}`))
  const kept = states.filter((state) => signers.has(`${dOf(state)}:${state.pubkey}`))
  // One per Folder: a replaceable state has one current version per signer.
  return [...new Map(kept.map((state) => [dOf(state)!, state])).values()]
}

async function publishInOrder(
  events: UnsignedEvent[],
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; index: number; reason?: string }> {
  for (const [index, unsigned] of events.entries()) {
    const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
    const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
    // Never the status code: the relay refuses as 200 with `accepted: false`.
    if (!result.ok) return { ok: false, index, ...(result.reason ? { reason: result.reason } : {}) }
  }
  return { ok: true }
}

/**
 * Rename a Folder: interop's `planRenameFolder`, the `kind:9002` alone (SPEC §3.3).
 *
 * A Folder's title is its channel's name and only that (§3.2), so there is one
 * home to write. The relay refuses it to anybody but the channel's owners and
 * admins, and that refusal is what a person reads.
 */
export async function renameFolderAsViewer(
  folder: string,
  name: string,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await publishInOrder(planRenameFolder(token.pubkey, Date.now(), { folder, name }), relayUrl, token)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'The relay refused the rename.' }
}

/** {@link folderDeletableOf} as the viewer — whether Delete may be offered (FOL-9). */
export async function folderDeletableAsViewer(folder: string, relayUrl: string, token: StoredToken): Promise<FolderDeletable> {
  return folderDeletableOf(viewerQuery(relayUrl, token), folder, token.pubkey)
}

/**
 * Delete a Folder.
 *
 * NIP-29 `kind:9008`. The relay soft-deletes the channel, sweeps its discovery
 * events and — since the fix in buzz#15 — its folder state too, which is what
 * makes the Folder actually leave `listFolders` rather than linger there named
 * and populated.
 *
 * **Everything carrying the Folder's `h` stops answering**, for everyone: its
 * messages, and any file or Ship issue filed in it. The rows stay in the
 * relay's database, but no read returns them and no app can bring them back.
 * So the same read that decides whether Peek offers Delete
 * ({@link folderDeletableAsViewer}) runs again here, immediately before
 * signing, and a Folder that fails it is refused with nothing sent.
 */
export async function deleteFolderAsViewer(
  folder: string,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deletable = await folderDeletableAsViewer(folder, relayUrl, token).catch(
    (): { ok: false; reason: string } => ({ ok: false, reason: 'This folder could not be read, so it was not deleted.' }),
  )
  if (!deletable.ok) return deletable
  const result = await publishInOrder(planDeleteFolder(token.pubkey, Date.now(), { folder }), relayUrl, token)
  if (!result.ok) return { ok: false, reason: deleteRefusalWords(result.reason) }
  return { ok: true }
}

/**
 * The relay's refusal of a Folder delete, in a person's words. The relay names
 * the count — "folder holds 2 file(s) (0 filed in it, 2 placed by its state) …"
 * — and the rest of its sentence is the relay's own vocabulary.
 */
export function deleteRefusalWords(reason: string | undefined): string {
  const held = reason?.match(/holds (\d+) file/)
  if (!held) return reason ?? 'The relay refused to delete the folder.'
  const count = Number(held[1])
  return `This folder still has ${count} ${count === 1 ? 'file' : 'files'}. Move or delete ${count === 1 ? 'it' : 'them'} first.`
}

/**
 * Move a file from one Folder to another.
 *
 * **Two commands, and the order is the whole design.** There is no atomic move:
 * the Folder state is per-Folder, so this is an `add` to the target and a
 * `remove` from the source, and something can fail between them.
 *
 * So it **adds first**. A failure after the add leaves the file in *both*
 * Folders — visible, obviously wrong to a person, and fixable by moving it
 * again. Removing first and failing would leave it in *neither*, which looks
 * exactly like a file that was never there and is the harder thing to notice
 * and the harder thing to undo.
 *
 * The remove failing is therefore reported as a partial move rather than a
 * failure, because the file did arrive and saying "it failed" would send
 * somebody looking for it in the wrong place.
 *
 * **Refused, before anything is sent, when either Folder has no state**
 * (FOL-10). An `add` to one emits state listing only the moved file and hides
 * everything else filed there; a `remove` from one emits state listing nothing.
 * So each side's `hasState` comes from a read, as a rename's does.
 *
 * **What is under the file moves with it** (FOL-45, SPEC §3.3). A sub-topic is
 * listed by its Folder's state beside its parent, so moving only the parent
 * would leave the sub-topic in the old Folder, drawn at its top. `listings` are
 * the source Folders' files, archived ones included; interop's
 * `planMoveFromFolders` moves the file and every file listed beneath it in any
 * of them as one `add` naming the set, then one `remove` per source, so a
 * failure leaves the whole set in both Folders and never splits it (SHI-37).
 *
 * **Refused into a private Folder** when a moved file lives in another channel:
 * a listing never changes who can read a file (§3.1).
 */
export async function moveFileAsViewer(
  file: MovableFile,
  /** Each source's files (`FolderContents.files`, archived included), by Folder id. */
  listings: ReadonlyMap<string, readonly MovableFile[]>,
  /** Every Folder that lists it now, each with `hasState` and `addresses` from a read. */
  from: readonly FolderRef[],
  to: FolderRef,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string; stillIn?: string[] }> {
  // An issue is listed by no Folder — its project is — so with nothing listed under it there is nothing to relist.
  const lists = (folder: FolderRef) => {
    const listing = listings.get(folder.id) ?? []
    return (
      (!!file.address && !!folder.addresses?.includes(file.address)) ||
      listing.some((listed) => listed.ref === file.ref || (!!file.address && listed.address === file.address)) ||
      listedBeneath(listing, file).length > 0
    )
  }
  if (!from.some(lists)) return { ok: true }
  // Interop's planner, the one Ship and the agent move by: one add naming everything, then a remove per source (SHI-37).
  const plan = planMoveFromFolders(token.pubkey, Date.now(), { file, from, to, listings })
  if (!plan.ok) {
    return {
      ok: false,
      reason:
        plan.reason === 'source-has-no-state'
          ? 'Files can’t be moved out of this Folder yet: it has no list of its own, so moving one would hide the rest.'
          : plan.reason === 'target-is-private'
            ? 'Can’t move this into a private Folder: it would stay readable by everyone who can read it now.'
            : 'That Folder has no list of its own yet, so moving a file into it would hide what is already there.',
    }
  }
  if (!plan.add) return { ok: true }
  const added = await publishInOrder([plan.add], relayUrl, token)
  if (!added.ok) return { ok: false, reason: added.reason ?? 'Nothing was moved. Try again.' }
  // It did arrive: each Folder that refused to let it go still lists it too, and the caller names them.
  const stillIn: string[] = []
  for (const { folder, event } of plan.removes) if (!(await publishInOrder([event], relayUrl, token)).ok) stillIn.push(folder)
  return stillIn.length ? { ok: false, reason: 'Added to the new Folder, but the Folder it came from still lists it too. Try moving it again.', stillIn } : { ok: true }
}

/**
 * Start a topic — a bare file inside a team, SPEC §6.7 (RFC 0.5 §10.7).
 *
 * A new topic is no longer a channel. It is a `kind:30840` carrying the team's
 * channel as `h`, optionally naming the file it sits under with one `a` of any
 * kind, and its conversation is `kind:1111` comments on it — which is what
 * `applyActionAsViewer` already publishes through the bare file's built-in
 * `comment` action. Existing topics stay channels; nothing here touches them.
 *
 * **Two writes when the Folder has state, one when it does not, and the
 * caller says which.** A Folder read by containment lists the new file the
 * moment its `h` is stored. A Folder with a `kind:30890` lists only what its
 * state names, so it also needs a `kind:1852` `add` — and a `1852` against a
 * Folder with *no* state emits state listing nothing, which empties the Folder
 * on every surface (peek#192). `hasState` is required rather than guessed for
 * exactly the reason `renameFolderAsViewer` requires it: the page has just
 * read it, and getting it wrong is silent loss.
 *
 * The file is published before the `add`, so a refused `add` leaves a topic
 * that exists and is reachable by its address, reported as partial — the same
 * order and the same reasoning as a move.
 */
export async function createTopicAsViewer(
  args: { folder: string; title: string; parent?: string; hasState: boolean },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true; address: string; naddr: string } | { ok: false; reason: string }> {
  const fileId = crypto.randomUUID()
  const unsigned = buildBareFile(token.pubkey, Date.now(), {
    fileId,
    title: args.title,
    channelUuid: args.folder,
    ...(args.parent ? { parent: args.parent } : {}),
  })
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // Never the status code: the relay refuses as 200 with `accepted: false`.
  if (!result.ok) return { ok: false, reason: result.reason ?? 'The relay refused to create the topic.' }
  const address = `${KIND_BARE_FILE}:${token.pubkey}:${fileId}`
  const naddr = encodeNaddr({ kind: KIND_BARE_FILE, pubkey: token.pubkey, identifier: fileId, relays: [] })
  const placed = await publishInOrder(
    planPlaceFile(token.pubkey, Date.now(), { folder: args.folder, address, hasState: args.hasState }),
    relayUrl,
    token,
  )
  if (!placed.ok) {
    return {
      ok: false,
      reason: 'The topic was created but could not be added to this folder’s list. Reload and try adding it again.',
    }
  }
  return { ok: true, address, naddr }
}

/**
 * Everything in a Folder, whichever app owns it — RFC 0.4 §4 and §5.
 *
 * The sibling of {@link resolveFolderProjectAsViewer} and deliberately not a
 * replacement for it. That one answers *"which project is this topic paired
 * with, and what work is in motion"*, which is a Ship-shaped question the topic
 * sidebar asks. This one answers *"what files does this Folder hold"* and has
 * no opinion about which of them matters — a project, another topic and a
 * record from an app nobody wrote come back as peers in the order the Folder
 * lists them.
 *
 * **Throws {@link RelayReadError} when the read failed**, like its sibling, so
 * an empty Folder and an unreachable one stay different sentences.
 */
export async function resolveFolderContentsAsViewer(
  folder: string,
  relayUrl: string,
  token: StoredToken,
  /** `includeArchived` for the listings a move plans from: what is archived beneath a file moves with it. */
  options?: { includeArchived?: boolean },
  source: ReadSource = 'relay',
): Promise<FolderContents> {
  if (source === 'copy') {
    // Throws when the copy has not seen every read the listing makes (PEE-4).
    const copy = fromCopy(relayUrl, token)
    const contents = await resolveFolderContents(folder, copy.query, copy.people, copy.cache, options)
    return { ...contents, files: contents.files.map((file) => drawOnly(file)!) }
  }
  const query = viewerQuery(relayUrl, token)
  return resolveFolderContents(folder, query, cachedPeople(query), manifests, options)
}

/**
 * What each of these files' conversations holds — when, who, which thread.
 *
 * Separate from the folder read on purpose. `resolveFolderContents` is flat in
 * the number of files and stays that way; this is one more request, made only
 * where a badge is actually going to be drawn, and it is the caller's choice to
 * spend it. Bundling it in would have charged every surface that lists files —
 * the sidebar included — for a badge only the folder view shows.
 *
 * The messages rather than a count (FOL-16): a count says whether a file is
 * worth opening, and whether it is *new* needs each message's time, author and
 * thread against the person's read frontier. One request either way.
 *
 * With the replies under them (CON-34): a reply is judged by its thread
 * (SPEC §11.3), and a file whose only new message is a thread reply keeps its
 * dot until the thread is opened. A NIP-22 reply names the file only in its
 * `A`, so without them no row ever saw one. The messages are then comments and
 * replies, told apart by `root === id`.
 */
export async function conversationsAsViewer(
  files: ForeignObject[],
  relayUrl: string,
  token: StoredToken,
  source: ReadSource = 'relay',
): Promise<Record<string, ConversationMessage[]>> {
  // From the copy on the device with its own manifest cache, as `resolveObjectsAsViewer` does (PEE-2).
  if (source === 'copy') return conversationsOf(files, copyQuery(relayUrl, token), createProjectionCache(0), { replies: true })
  return conversationsOf(files, viewerQuery(relayUrl, token), manifests, { replies: true })
}

/** One message of a file's conversation, with enough of it to draw and to reply to. */
export interface FileComment {
  id: string
  author: string
  body: string
  createdAt: number
  /** Needed to reply: NIP-22's lowercase `k` names the *parent's* kind, and a
   *  root may be a `kind:1111` comment or one of Ship's `kind:9` messages. */
  kind: number
}

/** Every thread of one file's conversation, keyed by the comment it hangs from. */
export interface FileThreads {
  /** The root comments themselves — the only place their `kind` is reported. */
  roots: Record<string, FileComment>
  /** Direct replies, oldest first. A root with none is absent, not `[]`. */
  replies: Record<string, FileComment[]>
  /**
   * Comments deleted under their replies, oldest first (PER-24, PEE-40): each
   * is the id its replies still name and the time of its first reply, and the
   * replies are in `replies` under that id. Only the file pane's read asks.
   */
  deleted?: { id: string; createdAt: number }[]
}

/**
 * The replies under a file's comments — the thread pane's read (FOL-19).
 *
 * interop's `threadsOf` as the viewer (PRO-20): the roots by id and their
 * direct replies by `#e`, every thread in one request, kinds off the owner's
 * manifest. A reply's lowercase tags name its parent comment, not the file, so
 * the `#a` read that brings the roots never brings a reply. The panel is flat
 * and writes flat, so the one level it reads is the one level it can produce.
 *
 * Throws `RelayReadError` on a refused read, like every read in this file: an
 * unreadable thread and an unanswered one must not be the same empty array.
 */
export async function threadsAsViewer(
  reference: string,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileThreads> {
  const threads = await threadEventsAsViewer(reference, rootIds, relayUrl, token)
  return {
    roots: Object.fromEntries(Object.entries(threads.roots).map(([id, event]) => [id, fileCommentOf(event)])),
    replies: Object.fromEntries(Object.entries(threads.replies).map(([id, list]) => [id, list.map(fileCommentOf)])),
  }
}

/** {@link threadsAsViewer} with the events themselves, for a caller that needs their tags. */
export function threadEventsAsViewer(
  reference: string,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<Threads> {
  return threadEventsWith(reference, rootIds, viewerQuery(relayUrl, token))
}

/** {@link threadEventsAsViewer} over any query — the conversation store's, to fold again from what it holds (OPT-3). */
export function threadEventsWith(reference: string, rootIds: readonly string[], query: QueryFn): Promise<Threads> {
  return threadsOf(reference, rootIds, query, manifests)
}

/** One event of a thread, as much of it as the pane draws and a reply needs. */
export const fileCommentOf = (event: SignedEvent): FileComment => ({
  id: event.id,
  author: event.pubkey,
  body: event.content,
  createdAt: event.created_at,
  kind: event.kind,
})

/**
 * Reply to a comment on a file — the thread pane's write (FOL-19).
 *
 * The owner's comment action with `replyTo`, which interop turns into SPEC
 * §6.4's reply (PRO-20): uppercase `A`/`K`/`P` still the file, the lowercase
 * trio the comment answered. The consequence worth knowing: a reply carries no
 * lowercase `a`, so it is absent from the file's `#a` conversation read — it
 * does not raise the file's message count and does not light its unread dot.
 * That is NIP-22 as written, and the same gap Ship's `kind:9` replies have.
 */
export async function replyToCommentAsViewer(
  args: { reference: string; parent: FileComment; body: string },
  relayUrl: string,
  token: StoredToken,
): Promise<ActResult> {
  const { id, kind, author } = args.parent
  return applyActionAsViewer(
    { naddr: args.reference, actionId: 'comment', value: args.body, replyTo: { id, kind, author } },
    relayUrl,
    token,
  )
}

/**
 * Every Folder this viewer can see, for the navigation.
 *
 * Names only — no contents. A Folder's contents cost a resolve per Folder, and
 * a sidebar that paid that on every render would spend the relay's whole read
 * budget describing navigation nobody had clicked.
 */
export async function listFoldersAsViewer(
  relayUrl: string,
  token: StoredToken,
  source: ReadSource = 'relay',
): Promise<FolderSummary[]> {
  // From the copy, it throws when the copy has not seen the listing's reads (PEE-4).
  return listFolders(source === 'copy' ? copyQuery(relayUrl, token) : viewerQuery(relayUrl, token))
}

/**
 * Where in Peek a `nostr:` reference opens — see {@link placeForReferenceAsViewer}.
 *
 * `folder` is always the Folder to land in. `file` is set when the reference
 * names a file *inside* that Folder rather than the Folder itself: the page
 * lands on the Folder and opens that file's conversation beside it.
 */
export type ReferencePlace = {
  folder: string
  file?: string
  /** The DM partner's pubkey when `folder` is the viewer's DM with them, not a Folder (PEE-36). */
  dm?: string
  /** The event id of the message the reference named, so the topic can land on it (RIC-16). */
  message?: string
  /**
   * The root of the thread `message` is in, when the message is a comment on
   * `file` (FOL-36): the file page opens that thread from `?thread=`, and
   * the comment is then on screen to scroll to.
   */
  thread?: string
}

/**
 * The place in Peek a `nostr:` reference points at, or null (PRO-11).
 *
 * This is what makes the manifest's `web` template true. NIP-89 lets an app say
 * *"open one of my objects at this URL"*, and Peek published one before it had
 * any route to serve it — a consumer holding a Topic or a Message resolved it,
 * offered "open in Peek", and landed the person on their desk.
 *
 * Three shapes, and only two of them need the relay:
 *
 * - **A Topic is an `naddr`,** and a Topic's `d` **is** the channel uuid —
 *   measured across all 50 production channels (RFC 0.4 §5.2). So the answer is
 *   in the pointer and no read is required.
 * - **A bare file is an `naddr` too** (SPEC §6.7) — a topic started since #194,
 *   or any ownerless file — and it is the one address Peek opens that is *not*
 *   its own kind: RFC 0.5 §10.7 makes Peek the app that renders every file's
 *   conversation, and interop hands a consumer this URL for exactly that
 *   reason (FOL-17). Its Folder is its `h`, which means fetching it; the place
 *   is that Folder with the file open, since the file is not a container and
 *   has no page of its own.
 * - **A Message is an `nevent`,** because a `kind:9` has no `d` at all, so
 *   nothing but its event id can name it. Its Folder is the `h` tag, which
 *   means fetching it.
 * - **A comment on a file is an `nevent` too** (FOL-36), and its `h` is the
 *   *team's* channel — the Folder the file sits in, not a container that has
 *   a page of its own. Landing by `h` put a link to a file comment on the
 *   team's general chat, where the comment is not. The file it is on is the
 *   NIP-22 scope tag — `A`, or `a` on a root written before the uppercase
 *   trio — and the thread it is in is `rootOf`, so the place is the file with
 *   that thread open and the comment to land on.
 *
 * Returns null for anything else — a Ship project's `naddr` is a perfectly good
 * reference that Peek has nowhere to open, and saying so beats redirecting
 * somewhere arbitrary.
 */
export async function placeForReferenceAsViewer(
  reference: string,
  relayUrl: string,
  token: StoredToken,
): Promise<ReferencePlace | null> {
  const bare = reference.replace(/^nostr:/i, '')

  let pointer: AddressPointer | null = null
  try {
    pointer = referenceToPointer(bare)
  } catch {
    // Not an address — the event forms below.
  }
  if (pointer) {
    // Peek's own container kind answers from the pointer alone.
    if (pointer.kind === KIND_TOPIC) {
      return pointer.identifier ? { folder: pointer.identifier } : null
    }
    if (pointer.kind === KIND_BARE_FILE && pointer.identifier) {
      const [file] = await viewerQuery(relayUrl, token)([
        { kinds: [KIND_BARE_FILE], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 },
      ])
      const folder = file ? folderOf(file) : null
      return folder ? { folder, file: pointerToAddress(pointer) } : null
    }
    // Another app's addressable object is not ours to open, however
    // well-formed its reference is.
    return null
  }

  let id: string
  try {
    id = /^[0-9a-f]{64}$/i.test(bare) ? bare.toLowerCase() : decodeNevent(bare).id
  } catch {
    return null
  }

  const query = viewerQuery(relayUrl, token)
  const [event] = await query([{ ids: [id], limit: 1 }])
  const folder = event?.tags.find((t) => t[0] === 'h')?.[1]
  if (!event || !folder) return null
  const file = event.kind === KIND.COMMENT ? commentedFileOf(event) : null
  if (file) return { folder, file, message: id, thread: rootOf(event) }
  /*
    A message in a DM is in a channel too, and its `h` is not a Folder
    (PEE-36): landing by `h` opened an empty page called "DM" that offered to
    delete the conversation. The channel's `39000` says which it is.
  */
  const dm = await dmChannelOf(query, folder, token.pubkey)
  if (dm === 'not-a-person') return null
  if (dm) return { folder, dm, message: id, thread: rootOf(event) }
  return { folder, message: id }
}

/**
 * Whether channel `uuid` is a DM, and with whom: the partner's pubkey for the
 * viewer's one-to-one DM, `'not-a-person'` for any other DM channel — a group
 * DM, an archived one — which People has no row for and which is not a Folder
 * either, and null for a channel that is not a DM.
 */
export type DmChannel = string | 'not-a-person' | null

/** {@link DmChannel} for one channel, as the viewer — the Folder page's guard (PEE-36). */
export async function dmForChannelAsViewer(uuid: string, relayUrl: string, token: StoredToken): Promise<DmChannel> {
  return dmChannelOf(viewerQuery(relayUrl, token), uuid, token.pubkey)
}

/** The same test the DM list makes (`dmChannelsOf`), asked of one channel. */
async function dmChannelOf(query: QueryFn, uuid: string, me: string): Promise<DmChannel> {
  const metadata = await query([{ kinds: [KIND_CHANNEL_METADATA], '#d': [uuid], limit: 1 }])
  const channel = metadata.find((e) => e.tags.some((t) => t[0] === 't' && t[1] === 'dm'))
  if (!channel) return null
  // A DM written before the relay tagged participants names them in its `39002`.
  const members = channel.tags.some((t) => t[0] === 'p')
    ? []
    : await query([{ kinds: [KIND_CHANNEL_MEMBERS], '#d': [uuid], limit: 1 }])
  const [partner] = dmChannelsOf([channel], me, members).keys()
  return partner ?? 'not-a-person'
}

/**
 * The file a `kind:1111` is a comment on, as an address — `A` (the NIP-22 root
 * scope, which a reply keeps and a root repeats as `a`), else `a`. Null for a
 * comment scoped to an event rather than an addressable object, which is not
 * a file's conversation and has no page here.
 */
export function commentedFileOf(event: SignedEvent): string | null {
  const scope = event.tags.find((t) => t[0] === 'A' && t[1])?.[1] ?? event.tags.find((t) => t[0] === 'a' && t[1])?.[1]
  return scope && /^\d+:[0-9a-f]{64}:/i.test(scope) ? scope : null
}

/**
 * Ship's object-creating actions, from its live manifest, and the objects a new
 * one could hang under (PRO-4).
 *
 * The launcher's Ship section was a hardcoded registry, and its own comment
 * said why: *"Ship's project list stays the registry's mock until the runtime
 * can query kind:30850 records."* It can now.
 *
 * Two reads, and they answer different questions. The **objects** are what a
 * person picks a parent from; the **manifest** is what says a form may be drawn
 * at all and which fields it has. One object is resolved to learn the second,
 * because a projection is per kind rather than per object — so which project is
 * resolved does not matter, only that one is.
 *
 * `null` when nothing can be offered: no readable project of that kind, or an
 * app that declares no creating action for it. The launcher then shows what it
 * always showed, which is the right degradation — an action that cannot succeed
 * should not be listed.
 *
 * **Some of the actions are another app's** (MAN-8): interop 0.40.0 offers, on
 * an object, the creations other apps declare on its kind, each carrying
 * `declaredBy`. Ship's `add-project` arrives here on a Folder, beside Peek's
 * own `start-a-conversation`. `manifest` is the kind's owner's address, so a
 * caller can tell which app an action belongs to; `noun` is what the owner's
 * projection calls one of these, when it says.
 *
 * A borrowed creation on a Folder puts a file in it, so its choices are the
 * Folders a person navigates by (`topLevelFolders`) — `parentsFor`, keyed by
 * action id — and not the newest `kind:39000`s, which include DMs and record
 * channels. Peek's own conversation keeps the list it always had.
 */
export async function creatableUnderAsViewer(
  parentKind: number,
  relayUrl: string,
  token: StoredToken,
  limit = 50,
): Promise<CreatableKindRead | null> {
  const query = viewerQuery(relayUrl, token)
  const roots = await query([{ kinds: [parentKind], limit }])
  if (roots.length === 0) return null

  const people = cachedPeople(query)
  // Newest first, so the picker opens on what somebody is most likely to want.
  const ordered = [...roots].sort((a, b) => b.created_at - a.created_at)

  const parents: { address: string; title: string }[] = []
  let resolved: { actions: ResolvedAction[]; manifest?: string; noun?: string } | null = null
  for (const root of ordered) {
    const identifier = root.tags.find((t) => t[0] === 'd')?.[1]
    if (!identifier) continue
    const pointer = { kind: root.kind, pubkey: root.pubkey, identifier, relays: [] }
    const address = pointerToAddress(pointer)
    if (!resolved) {
      // The one resolve. Its projection is the kind's, not this object's.
      const object = await resolveForeignObject(address, query, people, 0, manifests)
      if (!object) continue
      // Already memoised by the resolve above; asked for its address alone.
      const owner = await resolveManifest(pointer, query, manifests)
      resolved = {
        actions: object.actions.filter((a) => a.control === 'form'),
        ...(owner ? { manifest: owner.address } : {}),
        ...(object.noun ? { noun: object.noun } : {}),
      }
      parents.push({ address, title: object.slots.title?.value ?? identifier })
      continue
    }
    // Every other parent needs only a label, which the projection's title slot
    // gives without a second resolve each — 50 resolves to fill a dropdown
    // would be the expensive way to ask a cheap question.
    parents.push({ address, title: root.tags.find((t) => t[0] === 'title' || t[0] === 'name')?.[1] ?? identifier })
  }

  if (!resolved || resolved.actions.length === 0) return null
  const borrowed = resolved.actions.filter((a) => a.declaredBy)
  if (parentKind !== KIND_CHANNEL_METADATA || borrowed.length === 0) return { ...resolved, parents }

  let listing: FolderSummary[]
  try {
    listing = await listFolders(query)
  } catch (error: unknown) {
    // The borrowed rows go, not the owner's: a refused Folder listing must not
    // cost Peek its own Start a conversation, which needs none of it.
    console.warn('[nostr] listing Folders for another app’s creation failed:', error)
    return { ...resolved, actions: resolved.actions.filter((a) => !a.declaredBy), parents }
  }
  const folders = topLevelFolders(listing).flatMap((folder) =>
    folder.channel ? [{ address: folder.channel, title: folder.name ?? folder.id }] : [],
  )
  return { ...resolved, parents, parentsFor: Object.fromEntries(borrowed.map((a) => [a.id, folders])) }
}

/**
 * A comment or a reply on a file, built by the owner's `comment` action and
 * not sent — so the conversation can draw it the moment it is written, and
 * send it after (OPT-6).
 *
 * What {@link applyActionAsViewer} reads first, this is handed or holds: the
 * manifest comes through the same cache the open file was resolved with, and
 * the Folder is the one the open view already writes into, so a send asks the
 * relay nothing before it is drawn. The read that applyActionAsViewer makes
 * for the Folder doubles there as an access check; here the relay is that
 * check, when it accepts or refuses the event.
 */
export async function buildCommentAsViewer(
  args: {
    naddr: string
    /** The file's Folder — the `h` its conversation is read and written under. */
    folder: string
    value: string
    replyTo?: { id: string; kind: number; author: string }
  },
  relayUrl: string,
  token: StoredToken,
  /** The composer's own tags — attachments, mentions, references — as `applyActionAsViewer`'s seam. */
  transform: (event: UnsignedActionEvent) => UnsignedActionEvent = (event) => event,
): Promise<{ ok: true; event: UnsignedActionEvent } | { ok: false; reason: string }> {
  let pointer
  try {
    pointer = referenceToPointer(args.naddr)
  } catch {
    return { ok: false, reason: 'That reference could not be decoded.' }
  }
  const resolved = await resolveActingManifest(pointer, undefined, viewerQuery(relayUrl, token), manifests)
  if (!resolved) return { ok: false, reason: 'No app claims this kind, so there is nothing to act on.' }
  const built = buildActionEvents({
    manifest: resolved.manifest,
    kind: pointer.kind,
    address: pointerToAddress(pointer),
    objectAuthor: pointer.pubkey,
    folder: args.folder,
    actionId: 'comment',
    value: args.value,
    replyTo: args.replyTo,
    pubkey: token.pubkey,
    createdAtMs: Date.now(),
  })
  if (typeof built === 'string') return { ok: false, reason: built }
  return { ok: true, event: transform(built[0]) }
}

/**
 * Perform a manifest-declared action on a foreign object.
 *
 * Returns `{ ok: false, reason }` rather than throwing: every failure here is
 * something a person should read — not signed in, value not allowed, relay said
 * no — rather than an exception for a log nobody opens.
 *
 * **Nothing here knows what Ship is.** The kind, the tag names, which field an
 * action sets and which values are legal all come off the manifest at runtime.
 * Hardcoding any of it would turn a protocol demonstration into an integration.
 *
 * It is signed by the person who clicked, and it is a new event rather than an
 * edit — NIP-33 addresses are `(pubkey, kind, d)`, so Peek *cannot* rewrite
 * another app's object even if it wanted to, and does not need to.
 */
export async function applyActionAsViewer(
  args: {
    naddr: string
    actionId: string
    /**
     * A scalar for a change or a comment; `{ property: value }` for an
     * object-creating action, whose form has several fields (PRO-4).
     */
    value: string | Record<string, string>
    /** The comment answered, for a comment that is a reply — interop's `buildActionEvents` builds it (PRO-20). */
    replyTo?: { id: string; kind: number; author: string }
    /**
     * `'estiva-blocks-1'` when the prose value is a block document (MAN-1).
     * The runtime accepts it only where the action declares that format, and
     * parses the document before tagging it, so a wrong one is refused here.
     */
    contentFormat?: string
    /**
     * A change's `content` — the resolution summary of an archive (FOL-46).
     * The runtime carries it on the change itself, so the summary lands and
     * goes with the archive in one event.
     */
    note?: string
    /**
     * The manifest that declared the action, when it is not the object's own —
     * the action's `declaredBy.address` (MAN-8). Ship's `add-project` on a
     * Folder is built with Ship's manifest; Peek's has no such action.
     */
    declaredBy?: string
  },
  relayUrl: string,
  token: StoredToken,
  /**
   * The one seam where a caller may amend the bytes the runtime built, applied
   * to the action's first event after `buildActionEvents` and before signing
   * — never to the Folder commands a `listed` action is followed by.
   *
   * It exists for a single case and is documented as such rather than offered:
   * the composer's own tags on a comment — attachments, mentions, references
   * (`commentAsViewer`). Everything the manifest owns — the kind, whether the
   * action exists, the Folder — is already decided by the time this runs, so a
   * transform cannot invent an action or reach past an app's declaration.
   * A reply's parent is not this seam's: that is `replyTo`.
   */
  transform?: (event: UnsignedActionEvent) => UnsignedActionEvent,
): Promise<
  ActResult & {
    created?: string
    id?: string
    /** The action's Folder commands were built and sent here (`emits.listed`). */
    listed?: true
    /** The root was accepted and a Folder command after it was refused — the relay's words. */
    incomplete?: string
  }
> {
  let pointer
  try {
    // Same tolerance as reading: a widget rendered from an `a` tag address must
    // be actionable, not just visible.
    pointer = referenceToPointer(args.naddr)
  } catch {
    return fail('That reference could not be decoded.')
  }
  const address = pointerToAddress(pointer)
  const query = viewerQuery(relayUrl, token)

  /*
    The declaring manifest, which is the object's own unless the action came
    from another app (MAN-8). interop answers with a borrowed manifest only when
    resolving the object would have offered the action from it, so naming an
    address cannot make Peek act with a manifest nobody offered.
  */
  const resolved = await resolveActingManifest(pointer, args.declaredBy, query, manifests)
  if (!resolved) {
    return fail(
      args.declaredBy
        ? 'That app no longer offers this action here.'
        : 'No app claims this kind, so there is nothing to act on.',
    )
  }

  // The Folder has to come off the object itself: it is required on the event
  // about to be published, and asking the user for it would be absurd.
  const [root] = await query([
    { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 },
  ])
  if (!root) {
    return fail('That object is not readable from here — you may not have access to its Folder.')
  }
  /*
    The runtime's answer, not a local copy of it.

    This was three tag reads in a row here, with a comment saying they belonged
    "one layer down in the runtime, where every consumer would get it rather
    than each discovering it; filed rather than done here, because a person is
    blocked on this now." PRO-18 did that — `folderOf` has been in interop
    since 0.13.0 — and this call site kept its copy, so the two could drift and
    then did.

    The drift is exactly the case INT-9 is about. interop 0.16.0 resolves a
    channel record to its own `d`, because 0 of 40 `kind:39000` events on
    production carry either tag and a topic therefore had no Folder to write
    into. The local copy would still refuse every action on a topic while the
    runtime accepted it — a difference nothing in Peek's suite could see, since
    the suite exercises this function and not the one it should have called.
  */
  const folder = folderOf(root)
  if (!folder) return fail('That object has no Folder, so there is nowhere to write.')

  // `@me` lets the UI offer "assign to me" without the caller composing a
  // pubkey. It resolves against the signed-in viewer, which is the only
  // identity this could honestly mean. Applied per field for a form, because a
  // person picker inside one means the same thing it does on its own.
  const me = (v: string) => (v === '@me' ? token.pubkey : v)
  const value =
    typeof args.value === 'string'
      ? me(args.value)
      : Object.fromEntries(Object.entries(args.value).map(([k, v]) => [k, me(v)]))

  /*
    An object being created needs an identifier, and the runtime will not invent
    one (ADR 0002 §10 constraint 2 — it reaches for nothing). Generated here
    because *this* is the environment: a `d` is a uuid by RFC 0.4 §4.3, and it
    is what gives the new object an address at all.

    Supplied for every creation, including one whose kind cannot hold a `d`.
    The runtime decides: `buildCreationEvent` writes the tag only for an
    addressable kind and ignores this otherwise. Which is why `created` below
    reads the built event rather than this variable.
  */
  const newId = typeof args.value === 'string' ? undefined : crypto.randomUUID()

  /*
    What a `listed` action needs, read now (SPEC §7.3, MAN-4).

    Ship's `add-project` and `delete-project` are followed by a Folder command —
    the new project named in its Folder's state, or the deleted one taken out
    of every state naming it — and the runtime builds those only from a read of
    `kind:30890`, never from a default: a guess is a project its Folder does not
    show, or a row pointing at nothing. The same reads Ship makes before its own
    `createProject` and `deleteProject`. Every other action reads nothing here.

    **One filter each, and only the relay's states.** A deletion reads the
    states naming this address by `#a` — not every state, which a page limit
    would cut short and leave a Folder with a row pointing at nothing. A state
    counts only when the key that signed its Folder's channel record signed it
    too (7 of 7 on production, 2026-09-30): a `kind:30890` from anyone else
    would make a stateless Folder look stateful, and the `add` that follows it
    would emit state listing one object and hide everything else filed there.
  */
  const declared = resolved.manifest.actions?.find((action) => action.id === args.actionId)
  /*
    Only a creation or a deletion is followed by a command (SPEC §7.3), and a
    creation is a form with `properties` — interop's `isCreationAction`, the
    rule `buildActionEvents` and `ResolvedAction.listed` both apply. Anything
    else declaring `listed` builds one event, and must not report that it
    listed anything.
  */
  const isListed =
    declared?.emits.listed === true &&
    (declared.emits.kind === KIND.DELETION || (declared.input?.type === 'object' && !!declared.input.properties))
  let listing: { folderHasState?: boolean; listedIn?: FolderRef[] } = {}
  if (declared && isListed) {
    try {
      const states = await relayStates(
        query,
        declared.emits.kind === KIND.DELETION
          ? { kinds: [KIND_FOLDER_STATE], '#a': [address], limit: 500 }
          : { kinds: [KIND_FOLDER_STATE], '#d': [folder], limit: 1 },
      )
      listing =
        declared.emits.kind === KIND.DELETION
          ? { listedIn: states.map((state) => ({ id: dOf(state)!, hasState: true })) }
          : { folderHasState: states.length > 0 }
    } catch {
      return fail('The Folder could not be read, so nothing was written. Try again.')
    }
  }

  const built = buildActionEvents({
    manifest: resolved.manifest,
    kind: pointer.kind,
    address,
    objectAuthor: pointer.pubkey,
    folder,
    actionId: args.actionId,
    value,
    newId,
    replyTo: args.replyTo,
    contentFormat: args.contentFormat,
    ...(args.note ? { note: args.note } : {}),
    pubkey: token.pubkey,
    createdAtMs: Date.now(),
    ...listing,
  })
  if (typeof built === 'string') return fail(built)
  const [action, ...commands] = built

  const signed = await signViaEstivaId(
    transform ? transform(action) : action,
    token.accessToken,
    token.pubkey,
  )
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return fail(result.reason ?? 'The relay rejected the change.')

  /*
    The Folder commands, in order, stopping at the first refusal (SPEC §7.3).
    The root is already accepted by then, so a refusal here is not a failed
    action: the project exists, or is gone, and only its listing is behind.
    Reported as `incomplete` beside `ok`, as Ship reports `placed` and
    `unlisted` beside its result, so a caller can say which half landed.
  */
  let incomplete: string | undefined
  if (commands.length > 0) {
    const followed = await publishInOrder(commands, relayUrl, token)
    if (!followed.ok) incomplete = followed.reason ?? 'The relay refused the Folder command.'
  }
  const listed = isListed ? { listed: true as const, ...(incomplete ? { incomplete } : {}) } : {}
  /*
    The address of what was just created, so the caller can reference it — the
    launcher drops it into the active composer and the reply renders it as a
    widget, which is the end of the round trip rather than a flourish.

    Only for a creation: a change is a statement about an object that already
    had an address, and returning that one would read as "here is the new
    thing" when nothing new exists.

    **And only where an address exists** (INT-9). This was keyed on `newId`,
    which was set for every creation — so the first non-addressable one to be
    declared would have returned `9:<pubkey>:<uuid>` for an event carrying no
    `d` at all. That is not a reference that fails: `addrToNaddr` encodes it
    happily, the launcher puts it in the composer, and the thread renders a
    widget that resolves to nothing, for ever. A silent wrong answer, which is
    the failure INT-9 is named for arriving one layer along.

    So a message gets no `created` address. It still has an identity — its
    event id, which is why the manifest declares an `nevent` web template — and
    a `nostr:nevent1…` in a body renders as a widget since RIC-11
    (`MessageBody`: a chip inline, attached when alone on its line). What is
    left out is only the launcher dropping one into the composer for a message
    it just created (PRO-19 closed on that).

    So the honest outcome: the conversation is created and the launcher
    says so, with nothing dropped into the composer. For the ordinary case —
    starting a conversation in the topic you are reading — it appears in the
    thread on its own, which a self-referencing widget would only duplicate.
  */
  /*
    Read off the event that was actually built, not off `newId`.

    The `d` tag is what makes a kind addressable, and the runtime is the one
    that decides whether to write it — so asking the bytes is both correct and
    free of a second copy of the kind-range rule. A copy here is the same
    mistake as the local `folderOf` above, which drifted from the runtime's the
    moment the runtime learned something.
  */
  const identifier = action.tags.find((t) => t[0] === 'd')?.[1]
  const created = identifier ? `${action.kind}:${token.pubkey}:${identifier}` : undefined
  // The event's own id as well: a comment that carries a resolution is named
  // by the `kind:9101` that follows it (FOL-31), and nothing else reports it.
  return { ok: true, id: signed.id, ...(created ? { created } : {}), ...listed }
}

/**
 * Rename a file — the owner's `rename` action, exactly as declared (FOL-33).
 *
 * Nothing here knows the file is a `30840`: `applyActionAsViewer` reads the
 * manifest and builds whatever that manifest says a rename is. For the bare
 * file that is a `kind:1851` change to `title`, which every reader folds — so
 * the tree, the header, Ship's listing and another person's page all show the
 * new name from the same event, and a non-author may rename because the
 * manifest says a change is how it is done. A manifest that declares no
 * `rename` refuses here with the runtime's sentence, which is the same gate
 * the page uses to decide whether to draw the control at all.
 */
export async function renameFileAsViewer(
  /** `actionId` is the rename the manifest declared — `fileControlsOf(file).rename.id`. */
  args: { naddr: string; actionId: string; title: string },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await applyActionAsViewer({ naddr: args.naddr, actionId: args.actionId, value: args.title }, relayUrl, token)
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'The relay refused the rename.' }
}

/**
 * Delete a file — the owner's `delete` action, then unlist it (FOL-33).
 *
 * **Two writes when the Folder has state, one when it does not, and the
 * caller says which** — `createTopicAsViewer`'s rule in reverse. The `delete`
 * action is NIP-09's `kind:5` naming the address; the relay adjudicates it,
 * and a non-author's is refused with the relay's own words, which are returned
 * rather than pre-judged (SPEC §6.5 — the client cannot evaluate the
 * agent-owner half of the rule, so it must not guess at the first half
 * either). A Folder with a `kind:30890` lists what its state names, deleted or
 * not (FOL-28), so it also takes a `kind:1852` `remove` — or the row stays,
 * pointing at nothing. A Folder read by containment stops listing the file the
 * moment the relay hides it, and a `1852` against it would emit state listing
 * nothing (peek#192), so `hasState` is required rather than guessed.
 *
 * The deletion goes first. A refused `remove` after an accepted delete leaves
 * a listed row for a file that is gone, reported as partial — visible, and
 * fixable by reloading the Folder, where the person can see what happened.
 * The other order would unlist a file the relay then kept, which looks exactly
 * like a file that was never there.
 */
export async function deleteFileAsViewer(
  /** `actionId` is the deletion the manifest declared — `fileControlsOf(file).delete.id`. */
  args: { naddr: string; actionId: string; address: string; folder: string; hasState: boolean },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deleted = await applyActionAsViewer({ naddr: args.naddr, actionId: args.actionId, value: '' }, relayUrl, token)
  if (!deleted.ok) return { ok: false, reason: deleted.reason ?? 'The relay refused to delete the topic.' }
  /*
    A deletion its owner declared `listed` — Ship's `delete-project` (MAN-4) —
    has been unlisted already, from every Folder whose state names it rather
    than from this one alone, because the declaration says so and the runtime
    built the commands. A second `remove` here would be this file's copy of the
    same rule.
  */
  if (deleted.listed) {
    return deleted.incomplete
      ? { ok: false, reason: 'It was deleted but is still listed in a folder. Reload and remove it from the folder again.' }
      : { ok: true }
  }
  const removed = await publishInOrder(
    planUnlistFile(token.pubkey, Date.now(), { folder: args.folder, address: args.address, hasState: args.hasState }),
    relayUrl,
    token,
  )
  if (!removed.ok) {
    return {
      ok: false,
      reason: 'The topic was deleted but is still listed in this folder. Reload and remove it from the folder again.',
    }
  }
  return { ok: true }
}

/**
 * Archive a file, or restore it — its owner's archive action, as declared
 * (FOL-46).
 *
 * One concept for every kind: the action setting `archived` on the file's
 * address — Ship's `archive-project` and `archive-issue`, the bare file's
 * `archive` — which `fileControlsOf(file).archive` finds by field, not by id.
 * `'true'` archives and an empty value restores. The cascade is read, never
 * written: a project's issues and a topic's sub-topics are hidden with it by
 * every reader, and restoring it brings back exactly what was there.
 *
 * `resolution` is what the person said about it, carried as the change's
 * `content`. Restoring takes none.
 */
export async function archiveFileAsViewer(
  args: { naddr: string; actionId: string; archived: boolean; resolution?: string },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await applyActionAsViewer(
    {
      naddr: args.naddr,
      actionId: args.actionId,
      value: args.archived ? 'true' : '',
      ...(args.archived && args.resolution ? { note: args.resolution } : {}),
    },
    relayUrl,
    token,
  )
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'The relay refused the archive.' }
}

/**
 * Archive a Folder, or restore it — interop's `planArchiveFolder` (FOL-46).
 *
 * A change on the Folder's channel address, always in the Folder's own `h`,
 * and counted only from its owners and admins (SPEC §3.2). Its state, its
 * contents and its channel are untouched, which is what makes it reversible
 * where a `kind:9008` is not.
 */
export async function archiveFolderAsViewer(
  args: { folder: string; channel: string; archived: boolean; resolution?: string },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await publishInOrder(
    planArchiveFolder(token.pubkey, Date.now(), {
      folder: args.folder,
      channel: args.channel,
      archived: args.archived,
      ...(args.archived && args.resolution ? { resolution: args.resolution } : {}),
    }),
    relayUrl,
    token,
  )
  return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'The relay refused the archive.' }
}

/**
 * What archiving `address` would hide, for the warning read before it
 * (FOL-46) — interop's counts, so Peek and Ship say the same numbers. A
 * Folder is named by its channel address. `folders` is the listing the page
 * already holds, which saves reading it again.
 */
export async function archiveImpactAsViewer(
  address: string,
  relayUrl: string,
  token: StoredToken,
  folders?: FolderSummary[],
): Promise<ArchiveImpact> {
  return archiveImpact(address, viewerQuery(relayUrl, token), { ...(folders ? { folders } : {}), cache: manifests })
}

/**
 * Messages matching a term, over NIP-50 (PEE-4).
 *
 * **Whole tokens only**, measured against production rather than assumed —
 * `scripts/probe-nip50-search.ts`, 2026-09-02: `"Cla"` returns nothing where
 * `"Claude"` returns two, and a nonsense token returns nothing at all, which is
 * what proves the relay is honouring `search` instead of dropping an unknown
 * field and answering with everything of that kind.
 *
 * Ordering comes back newest-first with no relevance score, so the order here
 * is the relay's and there is nothing to rank by. A count is "of what I
 * fetched", never a total.
 *
 * Throws `RelayReadError` on a failed read, like every other read in this file
 * — the whole point for PEE-4 is that a refused search and an empty one must
 * not arrive as the same empty array (PEE-10).
 *
 * **Two kinds, one filter** (FOL-36). A topic's messages are `kind:9`; a
 * file's conversation — a bare-file topic's, a Ship issue's — is `kind:1111`,
 * and searching the first alone made 137 comments on production unfindable.
 * The hit's own tags say which it is: a comment carries the file it is on
 * (`commentedFileOf`), and that is what decides where the launcher opens it.
 */
export async function searchMessagesAsViewer(
  term: string,
  relayUrl: string,
  token: StoredToken,
  limit = 20,
): Promise<SignedEvent[]> {
  const query = viewerQuery(relayUrl, token)
  return query([{ kinds: [KIND_MESSAGE, KIND.COMMENT], search: term, limit }])
}

/**
 * Everyone with a published profile, keyed by pubkey — the assignee picker's
 * list (PEE-1).
 *
 * kind:0 is replaceable, so the relay answers with one event per pubkey and
 * "the directory" is exactly this query. Estiva ID is the sole publisher of
 * these profiles, which is what makes the list the workspace's members rather
 * than whoever happened to write a name for themselves.
 *
 * A profile that cannot be parsed is skipped rather than shown broken — same
 * bargain as everywhere else in this file: a person picker with one person
 * missing beats no picker because one profile was malformed.
 */
export async function directoryAsViewer(relayUrl: string, token: StoredToken): Promise<People> {
  const query = viewerQuery(relayUrl, token)
  const events = await query([{ kinds: [0], limit: 500 }])
  const people: People = {}
  for (const event of events) {
    try {
      JSON.parse(event.content)
    } catch {
      // skip: an unreadable profile is not a reason to lose the rest
      continue
    }
    // The protocol's reading, so NIP-24's `bot` arrives too — what offers Edit
    // and Delete on an agent's message (SPEC §6.5, CON-5).
    people[event.pubkey] = parseProfile(event)
  }
  return people
}
