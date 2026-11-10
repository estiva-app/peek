import { RELAY_URL } from '@/api/relayUrl'

let held: Promise<unknown> | undefined

/**
 * The relay's NIP-11 document, which needs no sign-in, read once per page and shared by everything that asks it
 * (the project-fields switch, whether a live watch names teams). `null` in a build with no relay (tests, Storybook).
 * A read that fails is forgotten, so the next caller asks again.
 */
export function relayInfo(): Promise<unknown> {
  held ??= read().catch((error: unknown) => {
    held = undefined
    throw error
  })
  return held
}

async function read(): Promise<unknown> {
  if (!RELAY_URL) return null
  const res = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay information failed: ${res.status}`)
  return res.json()
}

let relay = { info: relayInfo }

/** The relay as `relayNamesTeams` asks it: one object per page, so interop reads its answer once. */
export function peekRelay(): { info: () => Promise<unknown> } {
  return relay
}

/** Forget the relay's answer, so a test can change it. */
export function forgetRelayInfo(): void {
  held = undefined
  relay = { info: relayInfo }
}
