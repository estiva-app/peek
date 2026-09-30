/**
 * PER-24, read back from production through the app's own reads: for every
 * bare file the caller can read, the roots `resolveObjectAsViewer` finds (what
 * `useFileView` passes as `rootIds`), and what `fileConversationAsViewer` then
 * draws — in particular each deleted root's stand-in and the replies under it.
 * Beside it, the file's raw `#A` count, so a reply nobody can see shows as a
 * difference. Read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-per24-deleted-roots.ts [address-suffix]
 */
import { queryRelay } from '@/nostr/bridge'
import { resolveObjectAsViewer } from '@/nostr/foreign'
import { anchorsOf } from '@estiva-app/conversation'
import { fileConversationAsViewer } from '@/nostr/fileConversation'
import type { StoredToken } from '@/auth/estivaId'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')

async function agentToken(): Promise<StoredToken> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      clientId: process.env.ESTIVA_ID_CLIENT_ID,
      clientSecret: process.env.ESTIVA_ID_CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; expires_in?: number }
  return { accessToken: body.access_token, pubkey: body.pubkey, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
}

export default async function main() {
  const suffix = process.argv[2] ?? ''
  const token = await agentToken()
  const files = await queryRelay(RELAY_URL, [{ kinds: [30840], limit: 1000 }], token.accessToken, token.pubkey)
  if (!files.ok) throw new Error(`file read refused: ${files.reason}`)
  const addresses = files.events
    .map((f) => `30840:${f.pubkey}:${f.tags.find((t) => t[0] === 'd')?.[1]}`)
    .filter((a) => a.endsWith(suffix))
  console.log(`files: ${addresses.length}`)

  let hidden = 0
  let standIns = 0
  for (const address of addresses) {
    const found = await resolveObjectAsViewer(address, RELAY_URL, token)
    if (!found) {
      console.log(`…${address.slice(-12)} unresolved`)
      continue
    }
    const rootIds = found.comments.map((c) => c.id)
    const conversation = await fileConversationAsViewer({ kind: 'file', address, h: '' }, rootIds, RELAY_URL, token)
    const drawn = new Set([...conversation.roots.filter((r) => !r.deleted), ...Object.values(conversation.replies).flat()].map((e) => e.id))

    const byA = await queryRelay(RELAY_URL, [{ kinds: [1111], '#A': [address], limit: 1000 }], token.accessToken, token.pubkey)
    if (!byA.ok) throw new Error(`#A read refused: ${byA.reason}`)
    const notDrawn = byA.events.filter((e) => anchorsOf(e).includes(address) && !drawn.has(e.id))
    hidden += notDrawn.length

    const deleted = conversation.roots.filter((r) => r.deleted)
    standIns += deleted.length
    console.log(`…${address.slice(-12)} roots ${conversation.roots.length} drawn ${drawn.size} #A ${byA.events.length} not drawn ${notDrawn.length}`)
    for (const r of deleted) {
      const replies = conversation.replies[r.id] ?? []
      console.log(`   deleted root …${r.id.slice(-12)} dated ${new Date(r.createdAt * 1000).toISOString()}, replies: ${replies.map((e) => e.id.slice(0, 12)).join(', ')}`)
    }
    for (const e of notDrawn) console.log(`   not drawn ${e.id.slice(0, 12)} ${JSON.stringify(e.tags.filter((t) => t[0] === 'e'))}`)
  }
  console.log(`\ndeleted-root stand-ins ${standIns}, #A comments still not drawn ${hidden}`)
}
