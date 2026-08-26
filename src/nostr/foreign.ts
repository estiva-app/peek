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
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { RelayReadError } from './relayRead'
import { pointerToAddress, referenceToPointer } from '../../convex/nostr/nip19'
import {
  buildActionEvent,
  peopleViaRelay,
  resolveFolderProject,
  resolveForeignObject,
  resolveManifest,
  type FolderProject,
  type ForeignObject,
  type People,
  type PeopleFn,
  type QueryFn,
} from '../../convex/nostr/projection'

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
 * Profiles already looked up this session (FEE-1).
 *
 * A topic with ten reference widgets resolves ten times, each one asking who
 * the same handful of people are. Module-level rather than per-call, so the
 * sidebar and every widget in the conversation share one answer.
 *
 * Misses are cached too — someone with no published profile would otherwise be
 * asked about on every single resolve, which is the common case for anyone who
 * has not finished setting up their Estiva ID. The cost is that a profile
 * published mid-session appears on the next reload rather than immediately,
 * which is the right way round for something read this often and changed this
 * rarely.
 */
const knownPeople = new Map<string, People[string]>()

function cachedPeople(query: QueryFn): PeopleFn {
  const fromRelay = peopleViaRelay(query)
  return async (pubkeys) => {
    const unknown = pubkeys.filter((key) => !knownPeople.has(key))
    if (unknown.length > 0) {
      const found = await fromRelay(unknown)
      for (const key of unknown) knownPeople.set(key, found[key] ?? {})
    }
    return Object.fromEntries(pubkeys.map((key) => [key, knownPeople.get(key) ?? {}]))
  }
}

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
  args: { naddr: string; actionId: string; value: string },
  relayUrl: string,
  token: StoredToken,
): Promise<ActResult> {
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
  const folder = root.tags.find((t) => t[0] === 'h')?.[1]
  if (!folder) return fail('That object has no Folder, so there is nowhere to write.')

  // `@me` lets the UI offer "assign to me" without the caller composing a
  // pubkey. It resolves against the signed-in viewer, which is the only
  // identity this could honestly mean.
  const value = args.value === '@me' ? token.pubkey : args.value

  const built = buildActionEvent({
    manifest: resolved.manifest,
    kind: pointer.kind,
    address,
    objectAuthor: pointer.pubkey,
    folder,
    actionId: args.actionId,
    value,
    pubkey: token.pubkey,
    createdAtMs: Date.now(),
  })
  if (typeof built === 'string') return fail(built)

  const signed = await signViaEstivaId(built, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  if (!result.ok) return fail(result.reason ?? 'The relay rejected the change.')
  return { ok: true }
}
