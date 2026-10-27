/**
 * Where a reference chip leads — RIC-16.
 *
 * > **Miky, 2026-09-12**, after the first pointer mention on production: *"It's
 * > kinda there, but not clickable. It only creates a label, but not really a
 * > link to the mentioned thing."*
 *
 * A chip that names a thing and goes nowhere is half a mention. This decides
 * the other half from what the projection layer resolved — never from the
 * caller knowing in advance, which is the same rule the chip's label follows.
 *
 * Three answers, in the order they are tried:
 *
 * - **Peek's own objects open in Peek**, at the path the app already owns for
 *   them: a Convex topic at `/topic-old/<slug>-<uuid>` (RFC 0.5 §7,
 *   `topicPath`, moved by FOL-37), a message at `/message/<id>` (§7.6,
 *   `shareableMessageUrl`), a bare file at `/topic/<slug>-<d>` (`filePath`,
 *   FOL-37 — `/o/<naddr>` when it resolved without an address, which lands on
 *   the same page). These are in-app links, wired
 *   through the router by the chip so a click does not reload the app.
 * - **Another app's object opens in that app**, at the URL its manifest's
 *   `web` template produced — `openUrl`, the same field the attachment card
 *   reads, so the chip and the card cannot disagree about where a thing lives.
 * - **Nothing, for a reference nothing resolved.** An unresolved chip is not
 *   something a reader can act on, and a link into "that link does not point
 *   at anything" would be a promise the app already knows it cannot keep.
 *
 * Pure, so the grammar is testable without a document; the router and the
 * thread opener are the chip's business.
 */
import { addressToPointer } from '@estiva-app/protocol'
import { KIND_BARE_FILE, writtenOpenerOf, type ForeignObject } from '@estiva-app/interop'
import { currentRouteWords, filePath, objectRef } from '@/lib/objectUrl'
import { MESSAGE_KIND, TOPIC_KIND } from '@/nostr/manifest'

export type ReferenceLink =
  | { place: 'topic'; href: string }
  /** `eventId` is carried so the chip can land on the message when it is on screen. */
  | { place: 'message'; href: string; eventId: string }
  | { place: 'file'; href: string }
  /** Another app's URL — followed by the browser, in a new tab. */
  | { place: 'app'; href: string }

const EVENT_ID = /^[0-9a-f]{64}$/i

export function referenceLink(uri: string, object: ForeignObject | null | undefined): ReferenceLink | null {
  if (!object || object.unreachable) return null

  if (object.kind === TOPIC_KIND && object.address) {
    let identifier: string | undefined
    try {
      identifier = addressToPointer(object.address).identifier
    } catch {
      return null
    }
    if (!identifier) return null
    const title = object.slots.title
    return { place: 'topic', href: `/topic-old/${objectRef(identifier, title && !title.isPubkey ? title.value : undefined)}` }
  }

  if (object.kind === MESSAGE_KIND && EVENT_ID.test(object.eventId)) {
    const eventId = object.eventId.toLowerCase()
    return { place: 'message', href: `/message/${eventId}`, eventId }
  }

  if (object.kind === KIND_BARE_FILE) {
    const title = object.slots.title
    return {
      place: 'file',
      href: object.address
        ? filePath(object.address, title && !title.isPubkey ? title.value : undefined)
        : `/o/${uri.replace(/^nostr:/i, '')}`,
    }
  }

  return object.openUrl ? { place: 'app', href: object.openUrl } : null
}

/**
 * Where a chip written as a URL opens: the address as written, in the app it
 * names (SPEC §7.7, LTX-6) — so `leaf.estiva.app/issue/…` opens Leaf, not Ship,
 * and a link to one block lands on the block, not the top of its file
 * (§13.6.1, WBM-11). Undefined for anything but https — an `http://` link
 * stays a link — and for a host no app declares, which open where
 * {@link referenceLink} says: a chip that draws one file never opens a site no
 * app serves from (WBM-11 security review). The rule is interop's
 * `writtenOpenerOf`, the same in every app (PEEKM-7). `opens` is where the file
 * itself opens, and its origin counts as declared. Peek's own URL is a route,
 * so the router takes it without a reload.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-path-is-the-same-on-every-apps-host.md
 */
export function writtenLinkOf(
  url: string | undefined,
  opens: string | undefined,
  origin = window.location.origin,
  declared: readonly string[] = currentRouteWords().origins ?? [],
): ReferenceLink | undefined {
  if (!url || !opens || !writtenOpenerOf(url, opens, origin, new Set(declared))) return undefined
  let parsed: URL
  let opensHere: boolean
  try {
    parsed = new URL(url)
    opensHere = new URL(opens, origin).origin === origin
  } catch {
    return undefined
  }
  // Peek's own object written on Peek's host already opens here, at the route that can land on a message on screen;
  // only a block (not `#/…`, an old hash route) changes where.
  if (opensHere && parsed.origin === origin && (parsed.hash.length < 2 || parsed.hash.startsWith('#/'))) return undefined
  if (parsed.origin !== origin) return { place: 'app', href: url }
  // A path that starts `//` (`/\` parses the same) would read as another host once it is a route: it opens where its file opens.
  const route = `${parsed.pathname}${parsed.search}${parsed.hash}`
  return new URL(route, origin).origin === origin ? { place: 'file', href: route } : undefined
}
