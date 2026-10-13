/**
 * The copy on the device that a reload draws Desk from (PEE-2).
 *
 * Miky, 12 Oct: a copy that survives a reload, kept until sign-out; while it is
 * older than the relay it shows as it is, and corrections land in place. The
 * copy is `@estiva-app/platform`'s event snapshot — signed events and the
 * plaintexts of the person's own blobs, never a folded view — held in
 * IndexedDB per relay and person.
 *
 * ## How a store uses it
 *
 * Every answer the relay gives `queryRelay` is kept here, whoever asked. A
 * store that should draw before the relay answers asks {@link readFromCopy}
 * with the same filters it sends the relay, folds that answer as it would the
 * relay's, and sends the relay its read as before: the relay's answer replaces
 * the copy's, and a store that already has the relay's answer ignores a late
 * copy. The copy never stands in for the relay's answer where the difference
 * matters — a blob drawn from it is `cached`, and nothing publishes over it.
 *
 * A direct message is kept as the relay sends it, in plain text like a topic
 * message (Miky, 13 Oct). Signing out removes every copy.
 */
import {
  createEventSnapshot,
  indexedDbSnapshotStorage,
  memorySnapshotStorage,
  snapshotScope,
  type EventSnapshot,
  type IdbFactoryLike,
  type SnapshotStorage,
} from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'

/**
 * Bump when what Peek folds from the copy changes meaning: a copy written
 * under another version is dropped unread and the next load reads the relay.
 */
export const DEVICE_COPY_VERSION = 1

const DATABASE = 'peek-device-copy'

/**
 * How long a read waits for the stored copy before going without it. The
 * IndexedDB read measured 3–14 ms for 2k–8k events; a browser that takes
 * longer than this is slower than the relay would be.
 */
const READY_WAIT_MS = 300

let storage: SnapshotStorage | undefined
function deviceStorage(): SnapshotStorage {
  storage ??=
    typeof indexedDB === 'undefined'
      ? memorySnapshotStorage()
      : indexedDbSnapshotStorage(indexedDB as unknown as IdbFactoryLike, DATABASE)
  return storage
}

let current: { scope: string; snapshot: EventSnapshot } | undefined

/** The copy for this person on this relay, opened on first use. One person per tab. */
function copyFor(relayUrl: string, pubkey: string): EventSnapshot {
  const scope = snapshotScope(relayUrl, pubkey)
  if (current?.scope === scope) return current.snapshot
  current?.snapshot.close()
  const snapshot = createEventSnapshot({ storage: deviceStorage(), scope, version: DEVICE_COPY_VERSION })
  current = { scope, snapshot }
  return snapshot
}

/**
 * Start reading the stored copy now, beside the first render rather than
 * after it: the page's first reads then find it already in memory.
 */
export function warmDeviceCopy(relayUrl: string | null | undefined, pubkey: string | undefined): void {
  if (relayUrl && pubkey) copyFor(relayUrl, pubkey)
}

function settled<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
}

/**
 * What the copy holds for these filters, or `null` when it has never seen the
 * relay answer them — a read that has to wait for the relay, as before.
 */
export async function readFromCopy(
  relayUrl: string,
  filters: Record<string, unknown>[],
  pubkey: string | undefined,
): Promise<SignedEvent[] | null> {
  if (!pubkey) return null
  const snapshot = copyFor(relayUrl, pubkey)
  await settled(snapshot.ready, READY_WAIT_MS)
  return snapshot.answer(filters)
}

/** Keep the relay's answer: what it sent, and what it no longer has. */
export function keepRelayAnswer(
  relayUrl: string,
  filters: Record<string, unknown>[],
  pubkey: string | undefined,
  events: SignedEvent[],
): void {
  if (!pubkey) return
  copyFor(relayUrl, pubkey).absorb(filters, events)
}

/**
 * The person's own plaintext for a ciphertext this tab's copy holds. A
 * ciphertext always decrypts to the same text, so this is never stale, and an
 * unchanged blob costs no `/nip44/decrypt` on any load after the first.
 */
export function plaintextFromCopy(ciphertext: string): string | undefined {
  return current?.snapshot.plaintextOf(ciphertext)
}

export function keepPlaintext(ciphertext: string, plaintext: string): void {
  current?.snapshot.keepPlaintext(ciphertext, plaintext)
}

/** Sign-out: every copy on this device goes. Never throws, and waits at most `ms`. */
export async function clearDeviceCopy(ms = 1_000): Promise<void> {
  current?.snapshot.discard()
  current = undefined
  await settled(
    deviceStorage()
      .clear()
      .catch(() => undefined),
    ms,
  )
}

/** Tests: forget the open copy and use this storage. */
export function resetDeviceCopyForTest(next?: SnapshotStorage): void {
  current?.snapshot.close()
  current = undefined
  storage = next
}
