/**
 * Merging read state across every slot the person owns (CRO-5).
 *
 * CRO-4 wrote one slot. This is the half that makes "read it in Ship, it is
 * read in Peek" true: Peek-in-Chrome and Ship-in-Chrome own different
 * coordinates by design, and the person's actual read frontier is the maximum
 * across all of them.
 *
 * ## A grow-only max register, and why that shape is the point
 *
 * `effective[context] = max(timestamp) across all blobs` — associative,
 * commutative, idempotent. There is no ordering to get right, no last-writer to
 * pick, and re-running the merge changes nothing. **Everything here is pure**:
 * §11.4's monotonicity is only guaranteed if merging never writes anything, and
 * a merge that advanced local state as a side effect would make re-running it
 * unsafe in a way no test would catch.
 *
 * ## What this must never do
 *
 * **Merge only over the viewer's own slots.** NIP-RS is explicit that this is
 * not a read-receipt protocol: anything exposing what a person has read to
 * somebody else needs their explicit consent. `allSlotsFilter` therefore takes
 * one pubkey and puts it in `authors`, and there is no version of it that takes
 * a list.
 *
 * ## The container prefixed with nothing
 *
 * CRO-5's description says "the containing `h:` context's value". As in CRO-4,
 * SPEC §11.1 is the authority and the container context is the **bare** channel
 * uuid — an app MUST NOT prefix it. The stale phrasing is in both tickets
 * because both predate CRO-3 writing the convention down.
 */
import { MAX_CONTEXTS, MAX_TIMESTAMP, isPublishableContextId, type ReadStateBlob } from './readState'

/** One slot as it came off the relay, with the facts a conflict needs. */
export interface SlotBlob {
  /** The `d` tag — names the coordinate, so a stale duplicate can be deleted. */
  dTag: string
  eventId: string
  /** Relay `created_at`, in unix seconds. Breaks a `client_id` tie. */
  createdAt: number
  blob: ReadStateBlob
}

/**
 * The person's read frontier, merged across every slot.
 *
 * Bad entries were already dropped by `parseReadStateBlob`; this re-checks
 * because a caller may hand in a blob from somewhere else, and one bad context
 * id in a grow-only store is worth two cheap validations.
 */
export function mergeSlots(slots: readonly SlotBlob[]): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const slot of slots) {
    for (const [id, seconds] of Object.entries(slot.blob.contexts)) {
      if (!isPublishableContextId(id)) continue
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_TIMESTAMP) continue
      if (merged[id] === undefined || seconds > merged[id]) merged[id] = seconds
    }
  }
  // The cap is per blob in the spec, not per merge; a person with eight full
  // slots can legitimately exceed it. Trimming to the newest markers keeps the
  // merged view bounded without ever writing the trimmed version back.
  const keys = Object.keys(merged)
  if (keys.length <= MAX_CONTEXTS) return merged
  const kept: Record<string, number> = {}
  for (const id of keys.sort((a, b) => merged[b] - merged[a]).slice(0, MAX_CONTEXTS)) {
    kept[id] = merged[id]
  }
  return kept
}

/** What the fetched slots say about which one is this installation's. */
export interface OwnSlotVerdict {
  /** This installation's blob: the highest `created_at` carrying our `client_id`. */
  mine: SlotBlob | undefined
  /**
   * Other blobs carrying our `client_id`, newest first.
   *
   * They are still merged — they hold real read state — but the spec SHOULDs
   * deleting them via NIP-09, because two live coordinates claiming one
   * installation is how a rotation or a restore leaves an orphan.
   */
  staleDuplicates: SlotBlob[]
  /**
   * Our own coordinate exists and holds somebody else's `client_id`.
   *
   * Publishing to it would overwrite an installation that is not this one, so
   * the caller MUST mint a new slot id before its next write. Distinct from
   * "our slot is missing", which is the ordinary first-run case.
   */
  coordinateConflicted: boolean
}

/**
 * Decide which slot is ours, and whether our coordinate is safe to write to.
 *
 * Both failure modes here are real rather than defensive: a key rotation
 * orphans a blob, and a backup/restore duplicates a `client_id`. Neither
 * announces itself — the symptom is two installations quietly overwriting one
 * coordinate, each undoing the other's markers on every publish.
 */
export function classifyOwnSlots(
  slots: readonly SlotBlob[],
  clientId: string,
  ownDTag: string,
): OwnSlotVerdict {
  const byClientId = slots
    .filter((s) => s.blob.client_id === clientId)
    .sort((a, b) => b.createdAt - a.createdAt)
  const [mine, ...staleDuplicates] = byClientId
  const atOwnCoordinate = slots.find((s) => s.dTag === ownDTag)
  return {
    mine,
    staleDuplicates,
    coordinateConflicted:
      atOwnCoordinate !== undefined && atOwnCoordinate.blob.client_id !== clientId,
  }
}

/**
 * When was this context last read, with the container's frontier applied?
 *
 * SPEC §11.3: a container's frontier propagates down, so
 * `effective(thread:<root>)` is the later of the thread's own marker and the
 * container's. Marking a container read clears threads whose events predate the
 * frontier; replies newer than it stay unread until their own marker advances.
 *
 * **Applied here, at read time, never by writing extra keys.** Writing the
 * container's value onto each child would be the same answer today and a
 * permanent one — the blob is grow-only, and a child that later gets its own
 * newer marker would still carry the inherited one forever.
 *
 * `containerContextId` is optional because §11.3 says so: an event that cannot
 * be resolved to its container degrades to its own merged value alone, rather
 * than guessing at a frontier.
 */
export function effectiveReadAt(
  merged: Readonly<Record<string, number>>,
  contextId: string,
  containerContextId?: string,
): number | undefined {
  const own = merged[contextId]
  const container = containerContextId === undefined ? undefined : merged[containerContextId]
  if (own === undefined) return container
  if (container === undefined) return own
  return Math.max(own, container)
}

/**
 * Has this context been read at or after `atSeconds`?
 *
 * The question every unread indicator actually asks. Absence of a context means
 * **unread** (SPEC §11.6), which is why a missing marker answers `false` rather
 * than something softer — and why the horizon in `allSlotsFilter` matters:
 * a container last read before it reads as unread until CRO-6's cache exists.
 */
export function isReadAt(
  merged: Readonly<Record<string, number>>,
  contextId: string,
  atSeconds: number,
  containerContextId?: string,
): boolean {
  const effective = effectiveReadAt(merged, contextId, containerContextId)
  return effective !== undefined && effective >= atSeconds
}
