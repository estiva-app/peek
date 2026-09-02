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
import type { SignedEvent } from '@estiva-app/protocol'

/** NIP-29 channel metadata — Peek's Topic. Its `d` is the channel uuid. */
const KIND_TOPIC = 39000
/** NIP-29 channel message — what a Peek message is on the wire. */
const KIND_MESSAGE = 9
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { RelayReadError } from './relayRead'
import { decodeNevent, pointerToAddress, referenceToPointer } from '@estiva-app/protocol'
import {
  buildActionEvent,
  createPeopleCache,
  resolveFolderProject,
  resolveForeignObject,
  resolveManifest,
  type FolderProject,
  type ForeignObject,
  type People,
  type PeopleFn,
  type ResolvedAction,
  type QueryFn,
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
export async function resolveObjectAsViewer(
  naddr: string,
  relayUrl: string,
  token: StoredToken,
): Promise<ForeignObject | null> {
  const query = viewerQuery(relayUrl, token)
  try {
    return await resolveForeignObject(naddr, query, cachedPeople(query))
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
  return resolveFolderProject(folder, query, cachedPeople(query))
}

/**
 * The Peek Folder a `nostr:` reference points into, or null (PRO-11).
 *
 * This is what makes the manifest's `web` template true. NIP-89 lets an app say
 * *"open one of my objects at this URL"*, and Peek published one before it had
 * any route to serve it — a consumer holding a Topic or a Message resolved it,
 * offered "open in Peek", and landed the person on their desk.
 *
 * Two shapes, and only one of them needs the relay:
 *
 * - **A Topic is an `naddr`,** and a Topic's `d` **is** the channel uuid —
 *   measured across all 50 production channels (RFC 0.4 §5.2). So the answer is
 *   in the pointer and no read is required.
 * - **A Message is an `nevent`,** because a `kind:9` has no `d` at all, so
 *   nothing but its event id can name it. Its Folder is the `h` tag, which
 *   means fetching it.
 *
 * Returns null for anything else — a Ship project's `naddr` is a perfectly good
 * reference that Peek has nowhere to open, and saying so beats redirecting
 * somewhere arbitrary.
 */
export async function folderForReferenceAsViewer(
  reference: string,
  relayUrl: string,
  token: StoredToken,
): Promise<string | null> {
  const bare = reference.replace(/^nostr:/i, '')

  try {
    const pointer = referenceToPointer(bare)
    // Only Peek's own container kind. Another app's addressable object is not
    // ours to open, however well-formed its reference is.
    return pointer.kind === KIND_TOPIC && pointer.identifier ? pointer.identifier : null
  } catch {
    // Not an address — fall through to the event forms below.
  }

  let id: string
  try {
    id = /^[0-9a-f]{64}$/i.test(bare) ? bare.toLowerCase() : decodeNevent(bare).id
  } catch {
    return null
  }

  const [event] = await viewerQuery(relayUrl, token)([{ ids: [id], limit: 1 }])
  return event?.tags.find((t) => t[0] === 'h')?.[1] ?? null
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
      const object = await resolveForeignObject(address, query, people)
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
): Promise<ActResult & { created?: string }> {
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

  const resolved = await resolveManifest(pointer, query)
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
    Two spellings, and reading only one made five of Ship's fifteen projects
    unactionable from here.

    A Folder is named by NIP-29's `h` on most events. But a record published
    *globally* — belonging to no Folder itself while still naming one — carries
    `buzz-channel` instead, which is the relay's own tag rather than any app's
    invention. Ship's projects moved to that shape in REW-11, and its fold has
    read both ever since (`projectFolder` in `ship/src/fold.ts`); this did not,
    so acting on a project created after that change failed with "That object
    has no Folder, so there is nowhere to write." — on the five newest, which
    are exactly the ones somebody would reach for.

    Both tags are protocol-level, so knowing them is not knowing what Ship is.
    It does belong one layer down in the runtime, where every consumer would
    get it rather than each discovering it; filed rather than done here, because
    a person is blocked on this now.
  */
  const folderTag = (name: string) => root.tags.find((t) => t[0] === name)?.[1]
  const folder = folderTag('h') ?? folderTag('buzz-channel')
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

  const signed = await signViaEstivaId(built, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return fail(result.reason ?? 'The relay rejected the change.')
  /*
    The address of what was just created, so the caller can reference it — the
    launcher drops it into the active composer and the reply renders it as a
    widget, which is the end of the round trip rather than a flourish.

    Only for a creation: a change is a statement about an object that already
    had an address, and returning that one would read as "here is the new
    thing" when nothing new exists.
  */
  const created = newId ? `${built.kind}:${token.pubkey}:${newId}` : undefined
  return { ok: true, ...(created ? { created } : {}) }
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
 */
export async function searchMessagesAsViewer(
  term: string,
  relayUrl: string,
  token: StoredToken,
  limit = 20,
): Promise<SignedEvent[]> {
  const query = viewerQuery(relayUrl, token)
  return query([{ kinds: [KIND_MESSAGE], search: term, limit }])
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
