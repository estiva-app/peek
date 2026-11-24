/**
 * Object URLs — an address bar somebody else can resolve (PEE-14).
 *
 * The grammar is SPEC §7: `/<word>/<slug>-<d>` for one file, where `d` is its
 * protocol identifier and the slug is decoration, and `/o/<naddr>` for a file
 * whose type has no word. The path names the file and the host names the
 * perspective, so `peek.estiva.app/project/<slug>-<d>` and
 * `ship.estiva.app/project/<slug>-<d>` are one file (FOL-39, §7.7).
 *
 * **Writing a link is the shared package's** (LIN-3): interop's
 * `fileLinkWordsOf` / `filePathOf` / `fileUrlOf`, the same code Ship, Leaf and
 * the agent write with. The word is the kind's owner's (§7.7 rule 1), read off
 * the manifests on the relay — never a table of Peek's, not even for its own
 * `topic`: until the manifests are read a link is the file's `/o/<naddr>`,
 * which Peek opens like any other app does. A `d` that is not a random
 * lowercase uuid gets no link, since the relay refuses any such file.
 *
 * What stays here is Peek's own: the words its `/<word>/` route reads back
 * with (`routeWordsOf`), the registry links are drawn from in render, the old
 * long link it still reads until the stored ones are rewritten
 * (`addressFromRef`), and the Convex topics' `/topic-old/` and messages'
 * `/message/` paths.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-id-is-a-random-uuid-the-same-rule-as-a-teams-id.md
 */
import { fileLinkWordsOf, filePathOf, fileUrlOf, identifierFromRef, objectRef, urlPatternsOf, type LinkManifest } from '@estiva-app/interop'

/**
 * A NIP-33 address — `<kind>:<pubkey>:<d>` — as Peek's old long link,
 * `/topic/<kind>:<pubkey>:<d>`, carried it.
 *
 * Peek no longer writes that link (LIN-3) and reads it only until the stored
 * ones are rewritten, the project's last issue. The two colons make it
 * unambiguous against the `<slug>-<uuid>` refs beside it, which a slug cannot
 * contain. The `d` is any text, a line break included (`s`), as written then.
 */
const ADDRESS_RE = /^(\d{1,6}):([0-9a-f]{64}):(.+)$/is

/**
 * The address an old long link's `/topic/<ref>` names, or `null` when it
 * carries a bare `d` instead — FOL-19, FOL-37.
 *
 * Which grammar a ref is, is readable from the ref: an address carries two
 * colons and a slug carries none, so nothing has to be fetched to decide.
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
 * The words links are written and read with — SPEC §7.7, from the manifests.
 */
export interface RouteWords {
  /** The kinds a `/<word>/` route resolves `#d` against: every shape any manifest declares, for reading. */
  byWord: Readonly<Record<string, readonly number[]>>
  /** The word a kind's link is written with: its owner's (interop's `fileLinkWordsOf`). A kind with none is `/o/`. */
  byKind: Readonly<Record<number, string>>
  /**
   * The origins the shapes are written on — every host some app declares (SPEC
   * §7.7). A chip opens the address as written only on one of these (LTX-6).
   */
  origins?: readonly string[]
}

/**
 * The root paths that are Peek's own and not a file's word: the Convex-era
 * listing and topic pages, the `naddr` form, a message, the sign-in callback,
 * and `/app/`, under which every page of Peek's that is not a file lives. A
 * manifest shape at one of these — Peek's own `/topic-old/` and `/message/` —
 * is a page, not a `#d` route, and stays out of the words. `folders`,
 * `people` and `desk` are the pages that moved under `/app/`, still routed to
 * send an old link on.
 */
export const PEEK_ROOT_PATHS: readonly string[] = ['app', 'auth', 'topics', 'topic-old', 'o', 'message', 'folders', 'people', 'desk']

/** A declared shape's URL taken apart: the path and the query, host dropped. */
const PATTERN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+(\/[^?#]*)?(\?[^#]*)?/i
/** A type word: what §7.7 puts between the host and the `<slug>-<d>`. */
const WORD_RE = /^[a-z][a-z0-9-]*$/i

/**
 * The words the manifests give Peek — §7.7, read and written.
 *
 * `byKind`, the word a link is **written** with, is the shared writer's
 * (`fileLinkWordsOf`): the owner's word, and none where two apps' claims would
 * make the link read back as another file. `byWord`, what Peek's `/<word>/`
 * route **reads** a `d` against, is every declared shape: a shape counts when
 * its path is exactly `/<word>/<slug>-<d>` or `/<word>/<d>`, its query names
 * nothing (a `?thread=<id>` shape is about the comment, not the file —
 * FOL-38), it says which kind it is, and the word is not one of Peek's own
 * root paths. Ship's hash form, `/#/issue/<d>`, has no path word and is
 * skipped; Ship declares the path form beside it. Nothing of Peek's own is
 * merged in: its `topic` is in its manifest like every other app's word.
 */
export function routeWordsOf(manifests: readonly LinkManifest[]): RouteWords {
  const patterns = manifests.flatMap((manifest) => urlPatternsOf(manifest))
  const byWord: Record<string, number[]> = {}
  const origins = new Set<string>()
  for (const { pattern } of patterns) {
    try {
      origins.add(new URL(pattern).origin)
    } catch {
      // Not a URL: it declares no host.
    }
  }
  for (const { pattern, kind } of patterns) {
    if (kind === undefined) continue
    const match = PATTERN_RE.exec(pattern)
    if (!match) continue
    const [, path = '', query = ''] = match
    if (query.includes('<')) continue
    const segments = path.split('/').filter(Boolean)
    if (segments.length !== 2) continue
    const [word, tail] = segments
    if (tail !== '<slug>-<d>' && tail !== '<d>') continue
    if (!WORD_RE.test(word) || PEEK_ROOT_PATHS.includes(word.toLowerCase())) continue
    const kinds = (byWord[word.toLowerCase()] ??= [])
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  /*
    A word that is one of Peek's own pages is never written either (security
    review): any member can publish a manifest, and a newer one naming
    `/message/<slug>-<d>` for a topic would send every topic link Peek writes,
    and every topic page, to a page that cannot open it. The kind falls back to
    its `/o/<naddr>`, which opens the file.
  */
  const byKind = Object.fromEntries(
    Object.entries(fileLinkWordsOf(manifests).byKind).filter(([, word]) => !PEEK_ROOT_PATHS.includes(word.toLowerCase())),
  )
  return { byWord, byKind, origins: [...origins] }
}

/** Every kind any word resolves against — what an unknown word falls back to (§7.7 rule 4). */
export function declaredKinds(words: RouteWords): number[] {
  return [...new Set(Object.values(words.byWord).flat())]
}

/*
  The registry `filePath` reads. Module scope, the way the shapes cache in
  `nostr/foreign.ts` is: the words change only when somebody republishes a
  manifest, and a link is built in render, where nothing can await.
  `foreign.ts` fills it the first time the manifests are read; `App`
  subscribes so links drawn before that are drawn again with the words.
  Before, every link is the file's `/o/<naddr>`, which opens the same file.
*/
const NO_WORDS: RouteWords = { byWord: {}, byKind: {} }
let routeWords: RouteWords = NO_WORDS
let wordsKnown = false
const routeWordListeners = new Set<() => void>()

/** What the manifests declare — from `foreign.ts`, once they have been read. */
export function rememberRouteWords(words: RouteWords): void {
  routeWords = words
  wordsKnown = true
  for (const listener of routeWordListeners) listener()
}

/** Back to no words, as before the manifests are read — for tests. */
export function forgetRouteWords(): void {
  routeWords = NO_WORDS
  wordsKnown = false
  for (const listener of routeWordListeners) listener()
}

/** The registry as it stands; the `useSyncExternalStore` pair with `subscribeRouteWords`. */
export function currentRouteWords(): RouteWords {
  return routeWords
}

export function subscribeRouteWords(listener: () => void): () => void {
  routeWordListeners.add(listener)
  return () => routeWordListeners.delete(listener)
}

/** Resolves once the manifests have been read, or after `ms` — whichever comes first. */
function routeWordsWithin(ms: number): Promise<void> {
  if (wordsKnown) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const timer = setTimeout(done, ms)
    const unsubscribe = subscribeRouteWords(() => {
      if (wordsKnown) done()
    })
  })
}

/**
 * The path one file opens at — interop's `filePathOf` with the words read so
 * far (LIN-3): `/<word>/<slug>-<d>` when the kind's owner declares a word,
 * `/o/<naddr>` when it declares none or the manifests are not read yet, and
 * null for an address no file can have (a `d` that is not a random lowercase
 * uuid, or a kind that is not a file's).
 *
 * The slug is decorative: a caller without the title writes the bare uuid and
 * `FilePage` canonicalises once it knows what the file is called.
 */
export function filePath(address: string, title?: string): string | null {
  return filePathOf(address, routeWords, title)
}

/** {@link filePath} at one comment's thread (FOL-36), or null when the file has no link. */
export function fileThreadPath(address: string, title: string | undefined, thread: string | undefined): string | null {
  const path = filePath(address, title)
  if (path === null) return null
  return thread ? `${path}?${new URLSearchParams({ thread })}` : path
}

/** Whether a path {@link filePath} wrote is the `naddr` form rather than a word's. */
export function isNaddrPath(path: string): boolean {
  return path.startsWith('/o/')
}

/**
 * The file route a pathname is on, or null — `/<word>/<ref>` at the root, for
 * any word that is not one of Peek's own pages (`PEEK_ROOT_PATHS`). What the
 * launcher reads to know which file is open, since FOL-39 put every file at
 * the root and everything else under `/app/`.
 *
 * The ref comes back decoded, as the router hands it to `FilePage`: a
 * pathname keeps the long form's escapes (`/topic/<kind>:<pubkey>:team%3A…`),
 * and read raw it named another file than the page had open (TES-4). A
 * malformed escape stays as written, as the router leaves it.
 */
export function fileRouteFromPath(pathname: string): { word: string; ref: string } | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 2) return null
  const [word, raw] = segments
  if (!WORD_RE.test(word) || PEEK_ROOT_PATHS.includes(word.toLowerCase())) return null
  let ref = raw
  try {
    ref = decodeURIComponent(raw)
  } catch {
    // Kept as written; see above.
  }
  return { word: word.toLowerCase(), ref }
}

/**
 * A file's shareable URL — what "Copy link" hands out (FOL-37): interop's
 * `fileUrlOf` with the words read so far, or null for an address no file can
 * have.
 */
export function shareableFileUrl(address: string, title: string | undefined, origin: string): string | null {
  return fileUrlOf(address, routeWords, origin, title)
}

/**
 * How long Copy link waits for the manifests before it hands out the `/o/`
 * link. A copied link is stored as written once pasted, so the word is worth
 * a moment; the words are read at sign-in, so this is almost never waited.
 */
const COPY_WAITS_FOR_WORDS_MS = 2000

/**
 * Copy link (FOL-37), from a file's page or its row (TOPI-7): {@link shareableFileUrl} on the clipboard, and the link
 * in a prompt for a browser that refuses the clipboard off a menu. Resolves `true` once the clipboard holds it, so
 * the caller can say "Link copied" only then; `false` for an address no file can have.
 *
 * Before the manifests are read it waits for them (at most {@link COPY_WAITS_FOR_WORDS_MS}), so the link copied is
 * the short one rather than `/o/`. With the words already read — nearly always — nothing is awaited before the
 * write, which keeps the click's user activation for the browsers that ask for it.
 */
export function copyFileLink(address: string, title: string | undefined): Promise<boolean> {
  const write = (): Promise<boolean> => {
    const link = shareableFileUrl(address, title, window.location.origin)
    if (!link || !navigator.clipboard) return Promise.resolve(false)
    return navigator.clipboard.writeText(link).then(
      () => true,
      () => {
        window.prompt('Copy this link:', link)
        return false
      },
    )
  }
  return wordsKnown ? write() : routeWordsWithin(COPY_WAITS_FOR_WORDS_MS).then(write)
}

/**
 * Copy a page's own link (a path of Peek's, such as a team's chat), as `copyFileLink` copies a file's: `true` once it is
 * on the clipboard; a browser that refuses is shown the link to copy by hand.
 */
export function copyPageLink(path: string): Promise<boolean> {
  const link = new URL(path, window.location.origin).href
  if (!navigator.clipboard) {
    window.prompt('Copy this link:', link)
    return Promise.resolve(false)
  }
  return navigator.clipboard.writeText(link).then(
    () => true,
    () => {
      window.prompt('Copy this link:', link)
      return false
    },
  )
}

/**
 * Whether a `/<word>/<ref>` names this file, in either grammar — the launcher's
 * "the page you are on is not somewhere to go" (FOL-37).
 *
 * The short form carries only the `d`, so a file is matched on its
 * identifier; the old long form is matched on the whole address.
 */
export function refNamesFile(ref: string, address: string): boolean {
  const asAddress = addressFromRef(ref)
  if (asAddress) return asAddress.toLowerCase() === address.toLowerCase()
  const identifier = identifierFromRef(ref)
  return identifier !== null && address.toLowerCase().endsWith(`:${identifier}`)
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
 * The path for one Convex channel topic — `/topic-old/<slug>-<uuid>` since
 * FOL-37, because these topics are being retired and the short `/topic/`
 * form now belongs to a bare file in a Folder (`filePath`).
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
    ? `/topic-old/${objectRef(topic.folderId, topic.title)}`
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
