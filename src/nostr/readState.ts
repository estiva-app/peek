/**
 * Read state on the relay — NIP-RS, per person rather than per app (CRO-4).
 *
 * Peek's `readState` table is per viewer *and* per deployment: reading a topic
 * in Peek leaves Ship still showing it unread, because the two have no shared
 * place to record it. SPEC §11 fixes that with NIP-RS — `kind:30078` blobs,
 * NIP-44 self-encrypted, **one per installation**, merged by taking the maximum
 * timestamp per context.
 *
 * This is the write half. Fetching every slot and merging is CRO-5.
 *
 * **Pure by construction.** Nothing here reaches the network or the browser, so
 * the grammar can be exercised by a Node probe against production without
 * dragging in `import.meta.env` — which is how the done-when's "read the blob
 * back" is actually checked. The relay calls live in `readStateRelay.ts`.
 *
 * ## The context identifier is the whole point, and the ticket has it wrong
 *
 * CRO-4's description says the container context is `h:<folder-uuid>`. SPEC
 * §11.1 — written by CRO-3, after this ticket was filed — says the opposite,
 * and says it as a MUST NOT:
 *
 * > **The container context is the bare channel uuid.** NIP-RS's grandfathered
 * > clause states that "a bare channel identifier remains the channel context",
 * > and the reference clients write exactly that. An app MUST NOT prefix it.
 *
 * The spec wins, and the cost of getting it wrong is not a bug that can be
 * fixed later: NIP-RS blobs are **grow-only**, so a prefixed key published once
 * is permanent. Every reader would then have to tolerate both spellings forever,
 * and until they did, one app would mark a container read and the other would
 * still show it unread — which is the exact symptom this project exists to fix.
 *
 * ## Slots, and why this pays for them where `stars.ts` does not
 *
 * One blob per installation, never one shared blob. Peek-in-Chrome and
 * Ship-in-Chrome own different slots by design, and the merge across them is
 * what makes read state follow the person. `stars.ts` chose last-write-wins for
 * the opposite reason: a lost star is one click to restore, and a lost read
 * marker is invisible.
 */
import type { UnsignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'

/** NIP-RS's own `t` tag. Not Peek's — a reader of any app filters on this. */
export const READ_STATE_TAG = 'read-state'

/** The `d`-tag prefix the relay's NIP-RS predicate keys on (SPEC §11.6). */
export const READ_STATE_D_PREFIX = 'read-state:'

/** Limits from NIP-RS and the reference implementation (SPEC §11.6). */
export const MAX_CONTEXTS = 10_000
export const MAX_CONTEXT_ID_BYTES = 256
export const MAX_TIMESTAMP = 4_294_967_295

/** Where this installation's slot identity lives. Must survive a browser restart. */
export const SLOT_STORAGE_KEY = 'estiva-peek:read-state-slot'

// ---------------------------------------------------------------------------
// Context identifiers — SPEC §11.1
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const EVENT_ID_RE = /^[0-9a-f]{64}$/
// A file's address, `<kind>:<pubkey>:<d>` — the `a` value a comment carries on
// the wire. Kind 30000–39999 and a 64-hex pubkey are what make it an address;
// the `d` is whatever the file chose, and is kept verbatim (a `d` is case-sensitive,
// so lowercasing it would name a different file). No whitespace, because the
// `a` tag would not carry it either.
const ADDRESS_RE = /^3[0-9]{4}:[0-9a-f]{64}:[^\s]*$/

/**
 * The container context: the **bare** channel uuid, no prefix.
 *
 * Returns `undefined` rather than coercing, because the input is often a Peek
 * topic id (a Convex `seedKey`) where a channel uuid is expected, and publishing
 * one of those would put an identifier no other app can interpret into a
 * grow-only blob.
 */
export function containerContext(channelUuid: string | null | undefined): string | undefined {
  if (!channelUuid) return undefined
  const value = channelUuid.toLowerCase()
  return UUID_RE.test(value) ? value : undefined
}

/**
 * The file context: the file's **bare** address, no prefix (SPEC §11.1, FOL-16).
 *
 * A file's conversation is its own stream — the roots whose `a` names the
 * file — and this is that stream's frontier. It is the address verbatim
 * because that is the scope a comment carries on the wire, exactly as the
 * container context is the bare `h`. Reading the channel does not advance it
 * and it does not advance the channel (§11.3): that is the whole point.
 *
 * Refuses anything that is not an address, on the same terms as
 * {@link containerContext} — a Peek topic id or a `file:`-prefixed guess must
 * not reach a grow-only blob.
 */
export function fileContext(address: string | null | undefined): string | undefined {
  if (!address) return undefined
  if (new TextEncoder().encode(address).length > MAX_CONTEXT_ID_BYTES) return undefined
  return ADDRESS_RE.test(address) ? address : undefined
}

/**
 * `thread:<root-event-id>`. NIP-RS's own well-known scheme, adopted verbatim.
 *
 * §11.1: a key beginning `thread:` whose remainder is not 64 lowercase hex is
 * not a well-known context and MUST NOT be treated as one — so a Peek message
 * key that has never been published to the relay yields nothing, rather than a
 * `thread:` key that only Peek can read.
 */
export function threadContext(rootEventId: string | null | undefined): string | undefined {
  if (!rootEventId) return undefined
  const value = rootEventId.toLowerCase()
  return EVENT_ID_RE.test(value) ? `thread:${value}` : undefined
}

/** `msg:<event-id>`, under the same rule as {@link threadContext}. */
export function messageContext(eventId: string | null | undefined): string | undefined {
  if (!eventId) return undefined
  const value = eventId.toLowerCase()
  return EVENT_ID_RE.test(value) ? `msg:${value}` : undefined
}

/** Epoch ms → the unix **seconds** NIP-RS stores, clamped to its integer range. */
export function toContextSeconds(atMs: number): number {
  const seconds = Math.floor(atMs / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  return Math.min(seconds, MAX_TIMESTAMP)
}

// ---------------------------------------------------------------------------
// Slot identity
// ---------------------------------------------------------------------------

export interface SlotIdentity {
  /** 32 lowercase hex. The `d` tag is `read-state:<slotId>`. */
  slotId: string
  /** A stable string naming this installation, 1–64 chars. */
  clientId: string
}

const SLOT_ID_RE = /^[0-9a-f]{32}$/

function randomSlotId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * This installation's slot, minted once and then reused.
 *
 * **`localStorage`, never `sessionStorage`.** A slot that does not survive a
 * browser restart mints a new one every session, and because blobs are per
 * coordinate the person accumulates slots until they pass the reference
 * client's limit of 8 — at which point the oldest read state silently stops
 * being merged.
 *
 * Storage can throw outright (Safari private mode, a browser set to block site
 * data), so a failure to persist degrades to an ephemeral slot rather than
 * taking the app down. That publishes read state that will not be found again,
 * which is worse than nothing but better than a crash — and it is the same
 * trade every other storage read in this app makes.
 */
export function loadSlotIdentity(storage: Storage | undefined = safeLocalStorage()): SlotIdentity {
  const fresh = (): SlotIdentity => ({ slotId: randomSlotId(), clientId: `peek-${randomSlotId().slice(0, 8)}` })
  if (!storage) return fresh()
  try {
    const raw = storage.getItem(SLOT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SlotIdentity>
      if (
        typeof parsed.slotId === 'string' &&
        SLOT_ID_RE.test(parsed.slotId) &&
        typeof parsed.clientId === 'string' &&
        parsed.clientId.length >= 1 &&
        parsed.clientId.length <= 64
      ) {
        return { slotId: parsed.slotId, clientId: parsed.clientId }
      }
    }
  } catch {
    // Unparseable or unreadable — mint a new one below rather than fail the read.
  }
  const identity = fresh()
  try {
    storage.setItem(SLOT_STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Ephemeral slot. See the header above.
  }
  return identity
}

/**
 * Mint and persist a new slot id, keeping the same `client_id`.
 *
 * For one case only: our coordinate exists on the relay and carries somebody
 * else's `client_id` (CRO-5). Publishing to it would overwrite another
 * installation on every write, and it would overwrite us on every one of theirs
 * — a fight neither side can see. The `client_id` is kept because it still
 * names this installation truthfully; it is the coordinate that is taken.
 */
export function rotateSlotId(
  identity: SlotIdentity,
  storage: Storage | undefined = safeLocalStorage(),
): SlotIdentity {
  const rotated: SlotIdentity = { slotId: randomSlotId(), clientId: identity.clientId }
  try {
    storage?.setItem(SLOT_STORAGE_KEY, JSON.stringify(rotated))
  } catch {
    // Ephemeral, same trade as `loadSlotIdentity`.
  }
  return rotated
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** `read-state:<slot-id>` — the `d` tag the relay's NIP-RS predicate matches. */
export function readStateDTag(slotId: string): string {
  if (!SLOT_ID_RE.test(slotId)) {
    throw new Error(`slot id must be 32 lowercase hex, got "${slotId}"`)
  }
  return `${READ_STATE_D_PREFIX}${slotId}`
}

// ---------------------------------------------------------------------------
// The blob
// ---------------------------------------------------------------------------

export interface ReadStateBlob {
  v: 1
  client_id: string
  /** context id → unix seconds. */
  contexts: Record<string, number>
}

/**
 * Parse a decrypted blob, dropping entries it cannot trust and keeping the rest.
 *
 * Per-entry filtering rather than all-or-nothing, which is what NIP-RS itself
 * does for a context with a bad timestamp: one unreadable key must not discard a
 * person's whole read history.
 *
 * Returns `undefined` only when the blob is not a v1 NIP-RS blob at all — the
 * caller needs that apart from "an empty blob", because a slot that will not
 * parse must not be republished over with an empty one.
 */
export function parseReadStateBlob(plaintext: string | undefined): ReadStateBlob | undefined {
  if (!plaintext) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(plaintext)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const blob = raw as Partial<ReadStateBlob>
  // An unknown version is not guessed at — reading a v2 blob with v1 rules would
  // silently drop whatever v2 added, and the blob is grow-only.
  if (blob.v !== 1) return undefined
  const clientId =
    typeof blob.client_id === 'string' && blob.client_id.length >= 1 && blob.client_id.length <= 64
      ? blob.client_id
      : ''
  const contexts: Record<string, number> = {}
  const source = typeof blob.contexts === 'object' && blob.contexts !== null ? blob.contexts : {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!isPublishableContextId(key)) continue
    if (typeof value !== 'number' || !Number.isInteger(value)) continue
    if (value < 0 || value > MAX_TIMESTAMP) continue
    contexts[key] = value
  }
  return { v: 1, client_id: clientId, contexts }
}

/**
 * Is this a context id worth putting in a grow-only blob?
 *
 * Rejects the well-known prefixes whose remainder is not 64 hex, per §11.1 —
 * which is also what catches a Peek-private id that has been handed in by
 * mistake, since none of those are event ids.
 */
export function isPublishableContextId(id: string): boolean {
  if (id.length === 0) return false
  if (new TextEncoder().encode(id).length > MAX_CONTEXT_ID_BYTES) return false
  if (id.startsWith('thread:')) return EVENT_ID_RE.test(id.slice('thread:'.length))
  if (id.startsWith('msg:')) return EVENT_ID_RE.test(id.slice('msg:'.length))
  // Anything else is a container: a bare channel uuid, or since FOL-16 a bare
  // file address — the two scopes a message carries on the wire (SPEC §11.1).
  return UUID_RE.test(id) || ADDRESS_RE.test(id)
}

/** Serialize for encryption. Sorted keys, so an unchanged set is an unchanged string. */
export function serializeReadStateBlob(blob: ReadStateBlob): string {
  const contexts: Record<string, number> = {}
  for (const key of Object.keys(blob.contexts).sort()) contexts[key] = blob.contexts[key]
  return JSON.stringify({ v: blob.v, client_id: blob.client_id, contexts })
}

/**
 * Apply read markers to a context map, taking the later of the two.
 *
 * §11.4: a client MUST NOT lower a timestamp. The merge rule is a maximum, so a
 * lower value is not merely ignored — it cannot be expressed. There is no
 * mark-as-unread in NIP-RS, and writing a smaller number is not a way to get one.
 *
 * The cap is applied by **dropping the oldest markers**, not by refusing the
 * write: the alternative is that a person who has read 10,000 things can never
 * mark anything read again, and the oldest marker is the one whose loss matters
 * least.
 */
export function advanceContexts(
  current: Readonly<Record<string, number>>,
  updates: Readonly<Record<string, number>>,
): Record<string, number> {
  const next: Record<string, number> = { ...current }
  for (const [id, seconds] of Object.entries(updates)) {
    if (!isPublishableContextId(id)) continue
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_TIMESTAMP) continue
    if (next[id] === undefined || seconds > next[id]) next[id] = seconds
  }
  const keys = Object.keys(next)
  if (keys.length <= MAX_CONTEXTS) return next
  const keep = keys.sort((a, b) => next[b] - next[a]).slice(0, MAX_CONTEXTS)
  const capped: Record<string, number> = {}
  for (const id of keep) capped[id] = next[id]
  return capped
}

// ---------------------------------------------------------------------------
// The event
// ---------------------------------------------------------------------------

/**
 * The unsigned `kind:30078` carrying one slot's read state.
 *
 * **Exactly one `d` and exactly one `["t","read-state"]`** — SPEC §11.6 makes
 * the relay's NIP-RS handling a narrow predicate on that shape, and an event
 * that misses it is not rejected. It is silently stored as an ordinary
 * addressable event, which reads as a successful publish and is never merged by
 * anybody. That is the failure this shape exists to avoid.
 *
 * **No `h` tag**, for the same reason `stars.ts` has none: the relay's read path
 * treats an explicit `h` as authoritative, so a stray one would scope a global
 * event into a channel.
 */
export function buildReadStateEvent(
  pubkey: string,
  nowMs: number,
  slotId: string,
  ciphertext: string,
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(nowMs / 1000),
    kind: KIND.APP_DATA,
    tags: [
      ['d', readStateDTag(slotId)],
      ['t', READ_STATE_TAG],
    ],
    content: ciphertext,
  }
}

/** This installation's own slot, and nothing else. */
export function readStateSlotFilter(pubkey: string, slotId: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [readStateDTag(slotId)] }
}

/**
 * The default time horizon for fetching slots, in days (CRO-5).
 *
 * NIP-RS calls blobs "best-effort recent activity hints bounded by a time
 * horizon" and fixes no value, so this is a client choice. Seven days matches
 * the reference implementation's default.
 *
 * **The consequence bites and is not a bug here.** Absence of a context means
 * unread (SPEC §11.6), so a container last read three weeks ago reads as unread
 * until the client keeps its own cache behind the protocol — which is CRO-6,
 * and why CRO-6 has to land before anything cuts over to this.
 */
export const DEFAULT_HORIZON_DAYS = 7

/**
 * Peek's horizon (CRO-6).
 *
 * The reference default is 7 days. Peek's topics are long-lived, so a wider
 * window is worth having and costs nothing: the relay stores the events either
 * way, and the query is bounded by author and tag rather than by scan.
 *
 * This narrows the gap the cache has to cover; it does not close it, which is
 * why CRO-6 does both rather than choosing. Any finite horizon still turns a
 * long-quiet container into "never read", and only a durable local cache can
 * tell those apart.
 */
export const PEEK_HORIZON_DAYS = 90

/**
 * Every read-state slot **this person** owns, within the horizon.
 *
 * `authors` is the viewer themselves. NIP-RS is explicit that this is not a
 * read-receipt protocol: exposing what somebody has read to anybody else needs
 * their consent, so this takes one pubkey and there is deliberately no variant
 * that takes a list.
 */
export function allSlotsFilter(
  pubkey: string,
  nowMs: number,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): Record<string, unknown> {
  const since = toContextSeconds(nowMs) - Math.round(horizonDays * 24 * 60 * 60)
  return {
    kinds: [KIND.APP_DATA],
    authors: [pubkey],
    '#t': [READ_STATE_TAG],
    since: Math.max(0, since),
  }
}
