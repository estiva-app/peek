/**
 * Read state on the relay — Peek's half of NIP-RS (SPEC §11, CON-19).
 *
 * The grammar — context ids, the blob, the byte cap, the event, the merge —
 * lives in `@estiva-app/conversation`, the same code Ship runs, so the two
 * apps cannot drift on what a marker means. What stays here is what only Peek
 * can say: where this installation's slot is kept, what it calls itself, where
 * its randomness comes from, and how far back it reads.
 *
 * **`localStorage`, never `sessionStorage`.** A slot that does not survive a
 * browser restart mints a new one every session, and the person accumulates
 * slots until the oldest stop being merged. Storage can throw outright (Safari
 * private mode), so a failure degrades to an ephemeral slot rather than a crash.
 */
import { KIND } from '@estiva-app/protocol'
import {
  READ_STATE_HORIZON_DAYS,
  type SlotIdentity,
  loadSlotIdentity as loadSlot,
  readStateDTag,
  rotateSlotId as rotateSlot,
} from '@estiva-app/conversation'

/** Where this installation's slot identity lives. Must survive a browser restart. */
export const SLOT_STORAGE_KEY = 'estiva-peek:read-state-slot'

/** What Peek's `client_id` starts with: `peek-<8hex>`. */
const CLIENT_PREFIX = 'peek'

/**
 * Peek's horizon, in days. Peek's topics are long-lived, so it reads back
 * further than NIP-RS's reference default of seven; nothing before it can
 * light a dot (§11.6).
 */
export const PEEK_HORIZON_DAYS = READ_STATE_HORIZON_DAYS

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** This installation's slot, minted once and then reused. */
export function loadSlotIdentity(storage: Storage | undefined = safeLocalStorage()): SlotIdentity {
  return loadSlot({ storage, storageKey: SLOT_STORAGE_KEY, clientPrefix: CLIENT_PREFIX, random })
}

/**
 * A new slot id under the same `client_id`, for when our coordinate holds
 * another installation's blob: writing to it would overwrite them every time.
 */
export function rotateSlotId(identity: SlotIdentity, storage: Storage | undefined = safeLocalStorage()): SlotIdentity {
  return rotateSlot(identity, { storage, storageKey: SLOT_STORAGE_KEY, random })
}

/** This installation's own slot, and nothing else — what the write queue hydrates from. */
export function readStateSlotFilter(pubkey: string, slotId: string): Record<string, unknown> {
  return { kinds: [KIND.APP_DATA], authors: [pubkey], '#d': [readStateDTag(slotId)] }
}
