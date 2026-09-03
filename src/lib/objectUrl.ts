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
