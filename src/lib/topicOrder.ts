/**
 * The order this browser last drew a person's topics in (TOPI-10): a topic's
 * address → its newest activity, Unix seconds. Read for the Topics column's
 * first draw, so it is not a skeleton while the order is read again.
 *
 * It says which topics the person is in and when each was last active, so it
 * is part of the copy on the device and goes with it (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/peek-keeps-a-plain-copy-on-the-device-until-sign-out.md):
 * on sign-out, in any tab, and when someone else signs in.
 */

/** Where it is kept, per person: `<TOPIC_ORDER_KEY>.<pubkey>`. */
export const TOPIC_ORDER_KEY = 'peek.topics.activity'
const storeKey = (pubkey: string) => `${TOPIC_ORDER_KEY}.${pubkey}`

/** Set by a sign-out: this tab keeps nothing more, as the copy's own tab does not. */
let signedOut = false

export function readTopicOrder(pubkey: string): Map<string, number> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storeKey(pubkey)) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return new Map()
    return new Map(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  } catch {
    return new Map()
  }
}

export function writeTopicOrder(pubkey: string, at: ReadonlyMap<string, number>): void {
  // A watch still open after a sign-out in another tab must not write it back.
  if (signedOut) return
  try {
    window.localStorage.setItem(storeKey(pubkey), JSON.stringify(Object.fromEntries(at)))
  } catch {
    // Storage refused (a private window, a full quota): the next first draw waits for the read.
  }
}

/**
 * Remove every person's order from this browser. `signOut`: this tab writes
 * none again (a sign-out); without it, someone else signing in, whose own
 * order is written from their next read.
 */
export function clearTopicOrder({ signOut = false }: { signOut?: boolean } = {}): void {
  if (signOut) signedOut = true
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(`${TOPIC_ORDER_KEY}.`)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // Storage unreadable: nothing was kept in it either.
  }
}

/** Tests: a tab that has not signed out. */
export function resetTopicOrderForTest(): void {
  signedOut = false
}
