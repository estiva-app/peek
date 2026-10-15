/**
 * The chosen cards this device found it could not show (OPT-10; Miky, 15 Oct).
 *
 * A card whose file is deleted, or not the reader's to see, is known only once
 * the relay answers; until then it holds a whole card's height, and then
 * closes to its one-line "not available." row — a jump of about 200px on every
 * open. Remembered here, it draws that row from the first paint the next time:
 * only the first open on a device moves. Kept with the copy on the device, and
 * cleared with it at sign-out.
 *
 * In localStorage, not the copy's IndexedDB, because the first paint reads it
 * synchronously; a few hundred addresses at most.
 */
const KEY = 'peek.unavailable-cards'
const LIMIT = 300

/** Read once per page: a card's first paint asks it, and a screen of cards asks it many times. */
let held: Set<string> | undefined

function list(): Set<string> {
  if (held) return held
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    held = new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    held = new Set()
  }
  return held
}

function write(next: Set<string>): void {
  held = new Set([...next].slice(-LIMIT))
  try {
    localStorage.setItem(KEY, JSON.stringify([...held]))
  } catch {
    // Full or blocked storage: the next page draws the card as if never seen, which is only the first-open jump.
  }
}

/** Whether this device last found the card for `reference` not available. */
export function rememberedUnavailable(reference: string): boolean {
  return list().has(reference)
}

/** The relay's answer for a chosen card: remembered when it is not available, forgotten when it is. */
export function noteCardAvailability(reference: string, available: boolean): void {
  const current = list()
  if (available !== current.has(reference)) return
  const next = new Set(current)
  if (available) next.delete(reference)
  else next.add(reference)
  write(next)
}

/** Sign-out: what this device remembered about the person's cards goes with the rest of the copy. */
export function clearUnavailableCards(): void {
  held = undefined
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear where storage is blocked.
  }
}
