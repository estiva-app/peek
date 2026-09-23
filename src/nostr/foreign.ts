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
import { KIND, type SignedEvent } from '@estiva-app/protocol'

/** NIP-29 channel metadata — Peek's Topic. Its `d` is the channel uuid. */
export const KIND_TOPIC = 39000
/** NIP-29 channel message — what a Peek message is on the wire. */
const KIND_MESSAGE = 9
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { RelayReadError } from './relayRead'
import { rootOf } from './channelStreams'
import {
  buildBareFile,
  buildCreateChannel,
  buildDeleteChannel,
  buildEditChannelMetadata,
  decodeNevent,
  encodeNaddr,
  pointerToAddress,
  referenceToPointer,
  toNostrSeconds,
  type AddressPointer,
} from '@estiva-app/protocol'
import {
  KIND_BARE_FILE,
  matchObjectUrl,
  urlPatternsOf,
  buildActionEvent,
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
  commentKindsOf,
  CONVERSATION_LIMIT,
} from '@estiva-app/interop'

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
function viewerQuery(relayUrl: string, token: StoredToken): QueryFn {
  return async (filters) => {
    const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey)
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
 * same row 2. Only the manifest is remembered, for interop's five minutes: the
 * object, its changes, its comments and its children are what a refresh
 * exists to notice. Cleared with the URL shapes after a manifest is
 * republished, which is the one moment a remembered manifest is wrong.
 */
const manifests = createProjectionCache()

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

/** Forget the cached shapes — for tests, and after a manifest is republished. */
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
export type UrlReference = { address: string; eventId?: undefined } | { eventId: string; address?: undefined }

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
    return { address: `${found.kind}:${found.pubkey}:${hit.identifier}` }
  } catch (error) {
    if (error instanceof RelayReadError) return null
    throw error
  }
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
  for (const ref of found) {
    if (!ref) continue
    if (ref.address !== undefined && ref.address !== own) addresses.add(ref.address)
    if (ref.eventId !== undefined) events.add(ref.eventId)
  }
  return [...[...addresses].map((a) => ['a', a]), ...[...events].map((id) => ['q', id])]
}

export async function resolveObjectAsViewer(
  reference: string,
  relayUrl: string,
  token: StoredToken,
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
      return await resolveForeignObject(ref.address, query, cachedPeople(query), 0, manifests)
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
    return await resolveForeignObject(reference, query, cachedPeople(query), 0, manifests)
  } catch (error) {
    if (error instanceof RelayReadError) return null
    throw error
  }
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
 */
export async function resolveObjectsAsViewer(
  references: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<Record<string, ForeignObject | null>> {
  const single = (reference: string) => /^https?:\/\//i.test(reference) || isEventReference(reference)
  const addresses = references.filter((reference) => !single(reference))
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
  const unsigned = buildCreateChannel(token.pubkey, Date.now(), { channelUuid: id, name })
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // Never the status code: the relay refuses in a shape that reads as success.
  if (!result.ok) return { ok: false, reason: result.reason ?? 'The relay refused to create the folder.' }
  const named = await folderCommand({ folder: id, op: 'add', name }, relayUrl, token)
  if (!named.ok) {
    // The channel exists and is reachable by its id; only the list will not show it.
    return { ok: false, reason: 'The folder was created but the relay refused to list it. Reload and rename it to try again.' }
  }
  return { ok: true, id }
}

/** The Folder command — RFC 0.4 §4. `op` is `add`, `remove` or `set`. */
const KIND_FOLDER_COMMAND = 1852

/**
 * Publish a Folder command and say plainly whether the relay took it.
 *
 * There is no builder for this in `@estiva-app/protocol` — the kind is the
 * relay's own and the tag shape is read straight off `handle_folder_command`:
 * `h` names the Folder, `op` is required and an unrecognised one is *refused*
 * rather than defaulted, `a` tags are the addresses in the order given, and
 * `name` is optional.
 */
async function folderCommand(
  args: { folder: string; op: 'add' | 'remove' | 'set'; addresses?: string[]; name?: string },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const unsigned = {
    pubkey: token.pubkey,
    created_at: toNostrSeconds(Date.now()),
    kind: KIND_FOLDER_COMMAND,
    tags: [
      ['h', args.folder],
      ['op', args.op],
      ...(args.addresses ?? []).map((address) => ['a', address]),
      ...(args.name === undefined ? [] : [['name', args.name]]),
    ],
    content: '',
  }
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // Never the status code: the relay refuses as 200 with `accepted: false`.
  if (!result.ok) return { ok: false, reason: result.reason ?? 'The relay refused the folder command.' }
  return { ok: true }
}

/**
 * Rename a Folder — and the two writes are not interchangeable.
 *
 * **A Folder's name has two homes.** `listFolders` reads
 * `nameOf(state) ?? nameOf(channel)`, so the folder-state name *shadows* the
 * channel's. Writing only one of them is how a rename shows up on one surface
 * and not another, which is the stale-name problem the project rename already
 * produced once. So the channel is always updated, and the state's `name` too
 * when the Folder has state.
 *
 * **Never a `kind:1852` on a Folder with no state.** `handle_folder_command`
 * computes `next` from the *existing* state, and there is none — so `op: add`
 * with no addresses emits folder state listing **nothing**. The Folder would
 * stop being read by containment and instantly show empty, which for a Folder
 * whose contents are entirely implied by `h` means losing all of them. That is
 * why `hasState` is a required argument rather than something guessed here: the
 * caller has just read it, and getting it wrong is silent data loss on screen.
 */
export async function renameFolderAsViewer(
  folder: string,
  name: string,
  hasState: boolean,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const unsigned = buildEditChannelMetadata(token.pubkey, Date.now(), { channelUuid: folder, name })
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'The relay refused the rename.' }
  if (!hasState) return { ok: true }
  /*
    `op: add` with no addresses, which the handler turns into `next = current` —
    the contents are preserved and only the name changes. `set` would empty the
    Folder, and there is no `rename` op.
  */
  return folderCommand({ folder, op: 'add', name }, relayUrl, token)
}

/**
 * Delete a Folder.
 *
 * NIP-29 `kind:9008`. The relay soft-deletes the channel, sweeps its discovery
 * events and — since the fix in buzz#15 — its folder state too, which is what
 * makes the Folder actually leave `listFolders` rather than linger there named
 * and populated.
 *
 * **The files are not deleted and are not meant to be.** A Folder is an
 * association (RFC 0.4 §2); deleting it unfiles its contents and destroys
 * nothing. A Ship project whose only Folder is gone is still a Ship project,
 * which is why this takes no cascade argument.
 */
export async function deleteFolderAsViewer(
  folder: string,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const unsigned = buildDeleteChannel(token.pubkey, Date.now(), { channelUuid: folder })
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'The relay refused to delete the folder.' }
  return { ok: true }
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
 */
export async function moveFileAsViewer(
  address: string,
  from: string,
  to: string,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (from === to) return { ok: true }
  const added = await folderCommand({ folder: to, op: 'add', addresses: [address] }, relayUrl, token)
  if (!added.ok) return added
  const removed = await folderCommand({ folder: from, op: 'remove', addresses: [address] }, relayUrl, token)
  if (!removed.ok) {
    return {
      ok: false,
      reason: 'Added to the new folder, but it is still in the old one. Try moving it again.',
    }
  }
  return { ok: true }
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
  if (args.hasState) {
    const added = await folderCommand({ folder: args.folder, op: 'add', addresses: [address] }, relayUrl, token)
    if (!added.ok) {
      return {
        ok: false,
        reason: 'The topic was created but could not be added to this folder’s list. Reload and try adding it again.',
      }
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
): Promise<FolderContents> {
  const query = viewerQuery(relayUrl, token)
  return resolveFolderContents(folder, query, cachedPeople(query), manifests)
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
 */
export async function conversationsAsViewer(
  files: ForeignObject[],
  relayUrl: string,
  token: StoredToken,
): Promise<Record<string, ConversationMessage[]>> {
  return conversationsOf(files, viewerQuery(relayUrl, token), manifests)
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
}

/**
 * The replies under a file's comments — the thread pane's read (FOL-19).
 *
 * **Asked by `#e`, not by `#a`, and that is the whole reason this exists.**
 * A file's conversation read is address-scoped: `conversationsOf` and
 * `resolveForeignObject` both match the object's `a` tag, which by NIP-22 is
 * carried by a *top-level* comment and by nothing below it — a reply's
 * lowercase tags name its parent comment instead (SPEC §6.4's table). So the
 * roots arrive with the file and the replies never do, whichever app wrote
 * them, and a pane drawing `object.comments` as a thread would be drawing only
 * its first message.
 *
 * The kinds come off the owning app's manifest, as everywhere else: no kind
 * number is written here, so a NIP-22 `kind:1111` reply and Ship's `kind:9`
 * ones — which is what Ship's own reply button still publishes — both arrive,
 * because `commentKindsOf` puts a declared kind and everything it says it also
 * reads into the one filter.
 *
 * **Every thread of the conversation in one request, not one per thread.** A
 * `#e` filter takes a list, so the whole pane's replies cost the same round
 * trip as any single thread's would — which is what lets a comment carry an
 * honest reply count rather than the panel discovering, once opened, that
 * there was something under it all along. The roots come back beside them
 * (`ids`), because their `kind` is reported by no projection and NIP-22's
 * lowercase `k` on a reply names the parent's kind.
 *
 * Only *direct* replies to a root arrive: a reply's lowercase `e` names its
 * immediate parent, so a reply to a reply hangs off that reply's id and not the
 * root's. The panel is flat and writes flat — every reply it sends names the
 * thread's root — so the one level it reads is the one level it can produce.
 * A deeper tree written by another app would be undercounted here, which is
 * recorded rather than hidden.
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
  const empty: FileThreads = { roots: {}, replies: {} }
  if (rootIds.length === 0) return empty
  let pointer
  try {
    pointer = referenceToPointer(reference)
  } catch {
    return empty
  }
  const query = viewerQuery(relayUrl, token)
  const resolved = await resolveManifest(pointer, query, manifests)
  if (!resolved) return empty
  const kinds = commentKindsOf(resolved.manifest)
  if (kinds.length === 0) return empty

  const ids = [...new Set(rootIds)]
  const events = await query([
    { ids, limit: ids.length },
    { kinds, '#e': ids, limit: CONVERSATION_LIMIT },
  ])
  const asComment = (event: SignedEvent): FileComment => ({
    id: event.id,
    author: event.pubkey,
    body: event.content,
    createdAt: event.created_at,
    kind: event.kind,
  })
  const wanted = new Set(ids)
  const roots: Record<string, FileComment> = {}
  const replies: Record<string, FileComment[]> = {}
  const seen = new Set<string>()
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (wanted.has(event.id)) {
      roots[event.id] = asComment(event)
      continue
    }
    // The `e` that names a root of *this* conversation. A reply carries others
    // — a quote, a mention — and picking the first would file it under one.
    const parent = event.tags.find((tag) => tag[0] === 'e' && wanted.has(tag[1]))?.[1]
    if (!parent) continue
    ;(replies[parent] ??= []).push(asComment(event))
  }
  // Oldest first, as a conversation reads. Ties broken by id so two replies in
  // the same second do not swap places between renders.
  for (const thread of Object.values(replies)) {
    thread.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
  }
  return { roots, replies }
}

/**
 * Reply to a comment on a file — the thread pane's write (FOL-19).
 *
 * **A reply is the owner's comment action with NIP-22's lowercase half
 * redirected.** `buildActionEvent` writes a *top-level* comment: uppercase
 * `A`/`K`/`P` naming the file, lowercase `a`/`k`/`p` repeating it, because for
 * a top-level comment the thread root and the immediate parent are the same
 * object. §6.4's table says what a reply is instead — uppercase unchanged, the
 * lowercase trio naming the comment being replied to — and the runtime has no
 * argument for it, so the substitution is made here, on the bytes it produced.
 *
 * Everything the manifest owns still comes from the manifest: the kind, whether
 * a comment may be written at all, and the Folder. What is added is the
 * ratified NIP, which is the same licence interop takes for the top-level case
 * — legitimate precisely because no app owns `kind:1111`. Filed to move it one
 * layer down, where every consumer would get it rather than each rediscovering
 * it; done here because a person is blocked on it now.
 *
 * The consequence worth knowing: a reply carries no lowercase `a`, so it is
 * absent from the file's `#a` conversation read — it does not raise the file's
 * message count and does not light its unread dot. That is NIP-22 as written,
 * and it is the same gap Ship's own `kind:9` replies have had all along.
 */
export async function replyToCommentAsViewer(
  args: { reference: string; parent: FileComment; body: string },
  relayUrl: string,
  token: StoredToken,
): Promise<ActResult> {
  const lowercase = new Set(['a', 'e', 'k', 'p'])
  return applyActionAsViewer(
    { naddr: args.reference, actionId: 'comment', value: args.body },
    relayUrl,
    token,
    (event) => ({
      ...event,
      tags: [
        ...event.tags.filter((tag) => !lowercase.has(tag[0])),
        ['e', args.parent.id],
        ['k', String(args.parent.kind)],
        ['p', args.parent.author],
      ],
    }),
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
): Promise<FolderSummary[]> {
  return listFolders(viewerQuery(relayUrl, token))
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

  const [event] = await viewerQuery(relayUrl, token)([{ ids: [id], limit: 1 }])
  const folder = event?.tags.find((t) => t[0] === 'h')?.[1]
  if (!event || !folder) return null
  const file = event.kind === KIND.COMMENT ? commentedFileOf(event) : null
  return file ? { folder, file, message: id, thread: rootOf(event) } : { folder, message: id }
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
 */
export async function creatableUnderAsViewer(
  parentKind: number,
  relayUrl: string,
  token: StoredToken,
  limit = 50,
): Promise<{ actions: ResolvedAction[]; parents: { address: string; title: string }[] } | null> {
  const query = viewerQuery(relayUrl, token)
  const roots = await query([{ kinds: [parentKind], limit }])
  if (roots.length === 0) return null

  const people = cachedPeople(query)
  // Newest first, so the picker opens on what somebody is most likely to want.
  const ordered = [...roots].sort((a, b) => b.created_at - a.created_at)

  const parents: { address: string; title: string }[] = []
  let actions: ResolvedAction[] | null = null
  for (const root of ordered) {
    const identifier = root.tags.find((t) => t[0] === 'd')?.[1]
    if (!identifier) continue
    const address = pointerToAddress({ kind: root.kind, pubkey: root.pubkey, identifier, relays: [] })
    if (!actions) {
      // The one resolve. Its projection is the kind's, not this object's.
      const object = await resolveForeignObject(address, query, people, 0, manifests)
      if (!object) continue
      actions = object.actions.filter((a) => a.control === 'form')
      parents.push({ address, title: object.slots.title?.value ?? identifier })
      continue
    }
    // Every other parent needs only a label, which the projection's title slot
    // gives without a second resolve each — 50 resolves to fill a dropdown
    // would be the expensive way to ask a cheap question.
    parents.push({ address, title: root.tags.find((t) => t[0] === 'title' || t[0] === 'name')?.[1] ?? identifier })
  }

  if (!actions || actions.length === 0) return null
  return { actions, parents }
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
  },
  relayUrl: string,
  token: StoredToken,
  /**
   * The one seam where a caller may amend the bytes the runtime built, applied
   * after `buildActionEvent` and before signing.
   *
   * It exists for a single case and is documented as such rather than offered:
   * a NIP-22 *reply* (FOL-19), whose lowercase tags name the comment being
   * replied to instead of the object. Everything the manifest owns — the kind,
   * whether the action exists, the Folder — is already decided by the time this
   * runs, so a transform cannot invent an action or reach past an app's
   * declaration; it can only restate the parent, which no manifest describes
   * because NIP-22 does.
   */
  transform?: (event: UnsignedActionEvent) => UnsignedActionEvent,
): Promise<ActResult & { created?: string; id?: string }> {
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

  const resolved = await resolveManifest(pointer, query, manifests)
  if (!resolved) return fail('No app claims this kind, so there is nothing to act on.')

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

  const built = buildActionEvent({
    manifest: resolved.manifest,
    kind: pointer.kind,
    address,
    objectAuthor: pointer.pubkey,
    folder,
    actionId: args.actionId,
    value,
    newId,
    pubkey: token.pubkey,
    createdAtMs: Date.now(),
  })
  if (typeof built === 'string') return fail(built)

  const signed = await signViaEstivaId(
    transform ? transform(built) : built,
    token.accessToken,
    token.pubkey,
  )
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return fail(result.reason ?? 'The relay rejected the change.')
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

    So a message gets no reference, and that is a real gap rather than a fix:
    it *has* an identity — its event id, which is why the manifest declares an
    `nevent` web template — but `findNaddrs` scans for `nostr:naddr1…` only,
    so an `nevent` in a body is prose rather than a widget. Widening that is a
    change to the reference grammar RFC 0.5 §7 settles, and §7.3's argument
    against bech32 in URLs is live there; it is not this ticket's to make in
    passing. Filed as its own issue.

    Meanwhile the honest outcome: the conversation is created and the launcher
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
  const identifier = built.tags.find((t) => t[0] === 'd')?.[1]
  const created = identifier ? `${built.kind}:${token.pubkey}:${identifier}` : undefined
  // The event's own id as well: a comment that carries a resolution is named
  // by the `kind:9101` that follows it (FOL-31), and nothing else reports it.
  return { ok: true, id: signed.id, ...(created ? { created } : {}) }
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
  if (!args.hasState) return { ok: true }
  const removed = await folderCommand({ folder: args.folder, op: 'remove', addresses: [args.address] }, relayUrl, token)
  if (!removed.ok) {
    return {
      ok: false,
      reason: 'The topic was deleted but is still listed in this folder. Reload and remove it from the folder again.',
    }
  }
  return { ok: true }
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
      const content = JSON.parse(event.content) as { display_name?: string; name?: string; picture?: string }
      people[event.pubkey] = {
        displayName: content.display_name ?? content.name,
        picture: content.picture,
      }
    } catch {
      // skip: an unreadable profile is not a reason to lose the rest
    }
  }
  return people
}
