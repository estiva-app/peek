/**
 * Be the second device for DMS-8: read a person's DM unread state and their
 * merged NIP-RS blob, as that person, without marking anything read.
 *
 *   PEEK_TOKEN_FILE=/path/to/token.json node scripts/run-in-vite.mjs scripts/probe-dms8-dm-read-state.ts
 *
 * `PEEK_TOKEN_FILE` holds the signed-in tab's `sessionStorage['peek.estivaId.token']`
 * verbatim — keep it outside every repository. The token is the person, so
 * this reads exactly what their own second device would: the same Convex
 * `unread.summary` the sidebar draws the dot from, and the same relay slots
 * `ReadStateSync` merges. Nothing here writes: no mutation, no publish.
 *
 * The done-when is "the DM's channel uuid is in the published blob", read back,
 * so the line that matters is the per-DM `blob:` value. Run it once before the
 * person opens the DM and once after they have (and flushed, or waited on the
 * debounce), and the uuid should go from `absent` to a timestamp while the dot
 * goes from `unread` to `read` — through Convex for the dot, through the relay
 * for the blob, and the two must agree.
 */
import { readFileSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { loadMergedReadState } from '../src/nostr/readStateRelay'
import { containerContext, loadSlotIdentity } from '../src/nostr/readState'

const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

async function main() {
  const file = process.env.PEEK_TOKEN_FILE
  if (!file) throw new Error('PEEK_TOKEN_FILE is required')
  const token = JSON.parse(readFileSync(file, 'utf8')) as { accessToken: string; pubkey: string; expiresAt?: number }
  if (token.expiresAt && token.expiresAt < Date.now()) throw new Error('the token has expired — copy a fresh one')

  const convex = new ConvexHttpClient(CONVEX_URL)
  convex.setAuth(token.accessToken)
  const [relay, channels, summary] = await Promise.all([
    convex.query(api.nostr.config.relayConfig, {}),
    convex.query(api.nostr.outbox.dmChannels, {}),
    convex.query(api.unread.summary, {}),
  ])
  if (!relay?.relayUrl) throw new Error('relayConfig gave no relayUrl')

  const seam = { relayUrl: relay.relayUrl, accessToken: token.accessToken, pubkey: token.pubkey }
  const state = await loadMergedReadState(seam, loadSlotIdentity())
  if (!state) throw new Error('loadMergedReadState returned nothing — no session or no relay')

  console.log(`as ${token.pubkey.slice(0, 8)}…  relay ${relay.relayUrl}  ${new Date().toISOString()}`)
  console.log(`merged contexts: ${Object.keys(state.merged).length}   DMs with a channel: ${channels.length}`)
  for (const { dmKey, channelUuid } of channels) {
    const context = containerContext(channelUuid)
    const at = context ? state.merged[context] : undefined
    const dot = summary.dms.includes(dmKey) ? 'unread' : 'read  '
    const blob = at === undefined ? 'absent' : `${at}  ${new Date(at * 1000).toISOString()}`
    const shape = context ? '' : '  (uuid is not v4-shaped: containerContext drops it)'
    console.log(`  dm ${dmKey.padEnd(34)} ${channelUuid}  dot=${dot}  blob=${blob}${shape}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
