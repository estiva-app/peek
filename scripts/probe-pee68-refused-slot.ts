/**
 * PEE-68: does a read-state slot whose decrypt is refused (a 429) drop its
 * markers from a cold tab's merge, while the merge still says it is complete?
 *
 *   npx tsx scripts/probe-pee68-refused-slot.ts
 *
 * No network: two slots, the second refused on the first read and decrypted on
 * the next, through `@estiva-app/conversation`'s own `fetchReadState` and a
 * fresh cache — what a new tab, or the first load of the day, starts with.
 */
import { createSlotCache, fetchReadState } from '@estiva-app/conversation'

const me = 'f'.repeat(64)
const now = Date.now()
const at = Math.floor(now / 1000) - 60
const file = `30850:${me}:read-elsewhere`
const slot = (d: string, contexts: Record<string, number>) => ({
  id: d.padEnd(64, '0'),
  pubkey: me,
  kind: 30078,
  created_at: at,
  tags: [['d', `read-state:${d}`], ['t', 'read-state']],
  content: JSON.stringify({ v: 1, client: d, contexts }),
  sig: '',
})
const events = [slot('a'.repeat(32), {}), slot('b'.repeat(32), { [file]: at })]
let refuseNext = true
const nip44 = {
  decrypt: async (ciphertext: string) => {
    if (ciphertext.includes('b'.repeat(32)) && refuseNext) {
      refuseNext = false
      throw new Error('POST /nip44/decrypt failed: 429')
    }
    return ciphertext
  },
}
const identity = { slotId: 'a'.repeat(32), clientId: 'peek-aaaa' }
const cache = createSlotCache()
for (const run of ['first load (cold, refused)', 'next refresh']) {
  const state = await fetchReadState(async () => events, me, nip44, identity, now, undefined, cache)
  console.log(run, '→ reachable', state.reachable, '· marker for the file read elsewhere:', state.merged[file] ?? 'ABSENT (reads as unread)')
}
