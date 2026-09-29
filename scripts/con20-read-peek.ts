/**
 * CON-20: what Peek draws for every object the migration touches, through Peek's
 * own reads — `resolveObjectAsViewer` for the roots (the file view's `rootIds`),
 * then `fileConversationAsViewer` for the threads, reactions, resolutions and
 * edits — against `con20-fake-relay.ts` serving a snapshot.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   CON20_RELAY=http://localhost:7781 node scripts/run-in-vite.mjs scripts/con20-read-peek.ts ~/con20-scratch/peek-before.json
 *
 * The objects are every `A` in `~/con20-scratch/plan.json`. The NIP-98 header is
 * still signed as the agent through Estiva ID, which the fake relay ignores.
 */
import './con20-local-auth'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolveObjectAsViewer } from '@/nostr/foreign'
import { fileConversationAsViewer } from '@/nostr/fileConversation'

const out = process.argv[2]
if (!out) throw new Error('usage: con20-read-peek.ts <out.json>')
const RELAY = process.env.CON20_RELAY ?? 'http://localhost:7781'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'

const plan = JSON.parse(readFileSync(process.env.CON20_PLAN ?? `${homedir()}/con20-scratch/plan.json`, 'utf8')) as { about?: string }[]
const addresses = [...new Set(plan.flatMap((row) => (row.about ? [row.about] : [])))].sort()

const res = await fetch(`${ID_ORIGIN}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ grantType: 'client_credentials', clientId: process.env.ESTIVA_ID_CLIENT_ID, clientSecret: process.env.ESTIVA_ID_CLIENT_SECRET }),
})
if (!res.ok) throw new Error(`POST /token: ${res.status}`)
const t = (await res.json()) as { access_token: string; pubkey: string }
const token = { accessToken: t.access_token, pubkey: t.pubkey } as never

const result: Record<string, unknown> = {}
for (const address of addresses) {
  try {
    const object = await resolveObjectAsViewer(address, RELAY, token)
    if (!object) {
      result[address] = 'unresolved'
      continue
    }
    const rootIds = object.comments.map((c) => c.id)
    result[address] = await fileConversationAsViewer({ kind: 'file', address, h: object.folder ?? '' }, rootIds, RELAY, token)
  } catch (e) {
    // Production refuses the agent a Folder it is not in; the control skips these.
    result[address] = `error: ${e instanceof Error ? e.message : String(e)}`
  }
}
writeFileSync(out, JSON.stringify(result, null, 1))
console.log(`${addresses.length} objects read through Peek from ${RELAY} → ${out}`)
