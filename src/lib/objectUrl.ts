/**
 * Object URLs — an address bar somebody else can resolve (PEE-14).
 *
 * Peek already had path routing and a per-topic URL before this ticket; what it
 * did not have is a URL that means anything *outside* Peek. `/topics/<id>`
 * carries a Convex `seedKey` — Peek-private, and for seeded data literally
 * `'1'`..`'9'`. No other app can resolve one, and neither can a second Peek
 * deployment.
 *
 * The grammar is RFC 0.5 §7:
 *
 *     /<type>s              a directory of that kind
 *     /<type>/<slug>-<d>    one object
 *
 * where `d` is the object's protocol identifier. For a Topic that is its NIP-29
 * channel uuid, which is exactly the `d` of the relay's `kind:39000` — measured
 * across all 50 production channels (RFC 0.4 §5.2), so nothing new has to be
 * minted to put a resolvable identity in the URL.
 *
 * Two properties from §7.2 do all the work here:
 *
 *   - **The uuid is the whole identity, and it is not truncated.** A consumer
 *     resolves `{kinds: [39000], "#d": ["<uuid>"]}` — one query, no index, and
 *     no service that can go down and take every published link with it.
 *   - **The slug is decorative.** Renaming a topic changes it and the old link
 *     still resolves, because a reader MUST ignore everything before the final
 *     uuid. That is why `identifierFromRef` reads the tail rather than trying
 *     to parse the ref into parts.
 *
 * Kept free of React and of `@/api` so the grammar can be tested on its own;
 * the hook that needs a topic lookup is `useTopicPath`.
 */

/**
 * A v4 uuid at the very end of a ref.
 *
 * Anchored at the end rather than searched for, because §7.2's rule is
 * positional: the identity is the tail, and everything before it is a human
 * label that may itself contain hyphens, digits and hex.
 */
const TRAILING_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Slugs are cut here. Long enough to stay recognisable in a chat client's link
 * preview, short enough that the uuid is not pushed off the end of a rendered
 * URL — which is the only thing in the ref that carries meaning.
 */
const SLUG_MAX_LENGTH = 60

/**
 * A title reduced to URL-safe words. Decorative by contract: nothing resolves
 * through it, so it is free to be lossy — accents folded, punctuation dropped,
 * runs collapsed.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
}

/** `<slug>-<identifier>`, or the bare identifier when the title slugs to nothing. */
export function objectRef(identifier: string, title?: string): string {
  const slug = title ? slugify(title) : ''
  return slug ? `${slug}-${identifier}` : identifier
}

/**
 * The identity out of a ref, or `null` if it carries none.
 *
 * Lowercased on the way out: the relay's `d` values are lowercase uuids, and a
 * link that has been through a system which upper-cased it should still resolve
 * rather than silently miss.
 */
export function identifierFromRef(ref: string): string | null {
  const match = TRAILING_UUID_RE.exec(ref)
  return match ? match[0].toLowerCase() : null
}

/**
 * A NIP-33 address — `<kind>:<pubkey>:<d>` — and nothing else.
 *
 * The `d` is deliberately unconstrained: RFC 0.4 §4.3 says a uuid, Ship writes
 * one, and an app nobody has written may not. What makes this unambiguous
 * against the `<slug>-<uuid>` refs beside it is the two colons, which a slug
 * cannot contain.
 */
const ADDRESS_RE = /^(\d{1,6}):([0-9a-f]{64}):(.+)$/i

/**
 * The address a `/topic/<ref>` path names, or `null` when it names a topic —
 * FOL-19.
 *
 * One route serves two grammars. `/topic/<slug>-<uuid>` is Peek's own topic,
 * §7's shape and the only one that existed before this; `/topic/<address>` is
 * **any file**, Peek's or another app's, resolved by address rather than
 * against a listing's peers. Which one a link is, is readable from the link:
 * an address carries two colons and a slug carries none, so nothing has to be
 * fetched to decide and a legacy link is untouched.
 *
 * The ref as given is tested **first**, because `useParams` has already decoded
 * the path segment and decoding twice would corrupt a `d` containing a literal
 * `%`. The second attempt is for a link that arrived still escaped — a chat
 * client that percent-encoded the colons, or `location.pathname` read directly.
 */
export function addressFromRef(ref: string): string | null {
  if (ADDRESS_RE.test(ref)) return ref
  try {
    const decoded = decodeURIComponent(ref)
    return ADDRESS_RE.test(decoded) ? decoded : null
  } catch {
    // A stray `%` is not an address either.
    return null
  }
}

/**
 * The path one file opens at — RFC 0.5 §10.7 and the project brief's "one page
 * shape for every file" (FOL-19).
 *
 * The colons are left as they are. A colon is a legal path character (RFC 3986
 * `pchar`), and `%3A` would make the one part of the URL that carries meaning
 * unreadable — §7.3's objection to bech32 in URLs, arrived at from the other
 * side. Only the `d` is escaped, because it is the one segment an app is free
 * to put anything in.
 */
export function filePath(address: string): string {
  const match = ADDRESS_RE.exec(address)
  if (!match) return `/topic/${encodeURIComponent(address)}`
  const [, kind, pubkey, identifier] = match
  return `/topic/${kind}:${pubkey.toLowerCase()}:${encodeURIComponent(identifier)}`
}

/** What `topicPath` needs to build a link — a `Topic`, or anything shaped like one. */
export interface TopicLinkTarget {
  id: string
  title?: string
  /** The NIP-29 channel uuid. Absent on mock topics and on any created before
   *  Nostr emission was wired up, which is why the legacy path still exists. */
  folderId?: string | null
}

/**
 * The path for one topic.
 *
 * Falls back to the legacy `/topics/<peek-id>` shape when the topic has no
 * channel uuid — mock data in tests and Storybook, and pre-emission topics on
 * production. That link is not shareable outside Peek, and it is the honest
 * answer for an object which genuinely has no protocol identity yet. A topic
 * that later gains one is canonicalised by `TopicsPage` on the next render.
 */
export function topicPath(
  topic: TopicLinkTarget,
  opts?: { huddleId?: string | null },
): string {
  const base = topic.folderId
    ? `/topic/${objectRef(topic.folderId, topic.title)}`
    : `/topics/${encodeURIComponent(topic.id)}`
  return opts?.huddleId ? `${base}?huddle=${encodeURIComponent(opts.huddleId)}` : base
}

/**
 * A topic's shareable URL, or null when it has none — PEE-17.
 *
 * **Null is the point.** `topicPath` falls back to `/topics/<peek-id>` for a
 * topic with no channel uuid, and that link resolves nowhere but this
 * deployment: the id is Peek-private, and for seeded data literally `'1'`. A
 * "Copy link" that handed somebody one of those would be worse than having no
 * button, because it looks like it worked.
 *
 * The origin is passed rather than read from `location`, so the grammar stays
 * testable without a document and a link built on the server is the same link.
 */
export function shareableTopicUrl(topic: TopicLinkTarget, origin: string): string | null {
  if (!topic.folderId) return null
  return `${origin.replace(/\/+$/, '')}${topicPath(topic)}`
}

/**
 * A message's shareable URL, or null when it has none — PEE-17.
 *
 * A `kind:9` has no `d`, so its event id is the whole identity — RFC 0.5 §7.6,
 * amended once it turned out that recommending an `nevent` here contradicted
 * §7.3's argument against bech32 in URLs. The raw id has neither of §7.3's
 * problems: nothing optional is encoded into it, and it resolves with
 * `{ids: ["<id>"]}`.
 *
 * **Null until the message reaches the relay.** A reply exists in Convex the
 * moment it is sent and gains its event id only when it is published, so the
 * affordance is absent rather than broken for a message that has not landed —
 * the same rule `shareableTopicUrl` follows for a topic with no channel uuid.
 */
export function shareableMessageUrl(eventId: string | undefined | null, origin: string): string | null {
  if (!eventId || !/^[0-9a-f]{64}$/i.test(eventId)) return null
  return `${origin.replace(/\/+$/, '')}/message/${eventId.toLowerCase()}`
}
