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
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/peek-keeps-a-plain-copy-on-the-device-until-sign-out.md
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
import { clearPagePictures } from '@/lib/pagePicture'
import { clearCardShapes } from '@/lib/cardShapes'
import { clearUnavailableCards } from '@/lib/unavailableCards'
import { clearRecents } from '@/lib/recents'

/**
 * Bump when what Peek folds from the copy changes meaning: a copy written
 * under another version is dropped unread and the next load reads the relay.
 */
export const DEVICE_COPY_VERSION = 1

const DATABASE = 'peek-device-copy'

/**
 * How long a copy-first read waits for the stored copy. The IndexedDB read
 * measured 3–14 ms for 2k–8k events, but it queues behind another tab's save;
 * waiting costs nothing, since the relay's read runs beside it and wins if
 * it lands first.
 */
const READY_WAIT_MS = 3_000

let storage: SnapshotStorage | undefined
function deviceStorage(): SnapshotStorage {
  storage ??=
    typeof indexedDB === 'undefined'
      ? memorySnapshotStorage()
      : indexedDbSnapshotStorage(indexedDB as unknown as IdbFactoryLike, DATABASE)
  return storage
}

/** Whose copy this device last held: somebody else signing in wipes it first. */
export const OWNER_KEY = 'peek-device-copy-owner'

/** Kept as the owner while a sign-out's clear may not have finished: the next copy opened wipes first. */
export const SIGNED_OUT = 'signed-out'

let current: { scope: string; snapshot: EventSnapshot } | undefined
/** Set by sign-out: from then on this page keeps nothing, whatever answers still arrive. */
let leaving = false

function ownerOnDevice(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function rememberOwner(scope: string): void {
  try {
    localStorage.setItem(OWNER_KEY, scope)
  } catch {
    // Without storage the copy is this page's alone anyway.
  }
}

/** The copy for this person on this relay, opened on first use. One person per tab. */
function copyFor(relayUrl: string, pubkey: string): EventSnapshot {
  const scope = snapshotScope(relayUrl, pubkey)
  if (current?.scope === scope) return current.snapshot
  current?.snapshot.discard()
  /*
    Another person's copy on this device — they signed out somewhere other than
    Peek's menu, or their session ran out — is removed before this one is read:
    the copy is kept until sign-out, and a different person signing in is one.
  */
  const base = deviceStorage()
  const previous = ownerOnDevice()
  if (previous && previous !== scope) {
    clearPagePictures()
    clearUnavailableCards()
    clearCardShapes()
    clearRecents()
  }
  const wiped = previous && previous !== scope ? base.clear().catch(() => undefined) : Promise.resolve()
  rememberOwner(scope)
  const storage: SnapshotStorage = {
    load: (s) => wiped.then(() => base.load(s)),
    save: (s, change) => base.save(s, change),
    clear: () => base.clear(),
  }
  const snapshot = createEventSnapshot({ storage, scope, version: DEVICE_COPY_VERSION })
  current = { scope, snapshot }
  return snapshot
}

/** Relay answers waiting to be kept: taken in when the tab is idle, never in front of a click. */
const toKeep: { snapshot: EventSnapshot; filters: Record<string, unknown>[]; events: SignedEvent[] }[] = []
let keeping = false

function keepWhenIdle(): void {
  if (keeping) return
  keeping = true
  const run = () => {
    keeping = false
    const started = performance.now()
    // About one frame's work per idle slot, in the order the answers came.
    while (toKeep.length && performance.now() - started < 12) {
      const { snapshot, filters, events } = toKeep.shift()!
      snapshot.absorb(filters, events)
    }
    if (toKeep.length) keepWhenIdle()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2_000 })
  else setTimeout(run, 50)
}

/**
 * Start reading the stored copy now, beside the first render rather than
 * after it: the page's first reads then find it already in memory.
 */
export function warmDeviceCopy(relayUrl: string | null | undefined, pubkey: string | undefined): void {
  if (relayUrl && pubkey && !leaving) copyFor(relayUrl, pubkey)
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
  if (!pubkey || leaving) return null
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
  if (!pubkey || leaving) return
  toKeep.push({ snapshot: copyFor(relayUrl, pubkey), filters, events })
  keepWhenIdle()
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
  leaving = true
  current?.snapshot.discard()
  current = undefined
  toKeep.length = 0
  clearPagePictures()
  clearUnavailableCards()
  clearCardShapes()
  // The launcher's Recent holds titles, summaries and projects of files opened (SUM-7).
  clearRecents()
  // If the clear below does not finish before the page leaves, the next copy opened wipes first.
  rememberOwner(SIGNED_OUT)
  await settled(
    deviceStorage()
      .clear()
      .catch(() => undefined),
    ms,
  )
}

/**
 * Another tab signed out (PEE-3: one session for every tab). This tab stops
 * keeping anything and clears again: a save it had in flight could otherwise
 * land after the signing-out tab's clear and refill the copy.
 */
export function followSignOutElsewhere(event: Pick<StorageEvent, 'key' | 'newValue'>): void {
  if (event.key !== OWNER_KEY || event.newValue !== SIGNED_OUT || leaving) return
  void clearDeviceCopy()
}
if (typeof window !== 'undefined') window.addEventListener('storage', followSignOutElsewhere)

/** Tests: forget the open copy and use this storage. */
export function resetDeviceCopyForTest(next?: SnapshotStorage): void {
  current?.snapshot.close()
  current = undefined
  toKeep.length = 0
  leaving = false
  storage = next
}
