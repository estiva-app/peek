/**
 * CON-13's done-when, Peek half, read back from production through the app's
 * own reads: for one address (a Ship issue), what `useFileMentions` hands the
 * file page's Activity, and whether the same comment is kept out of the
 * page's own roots by `isCommentOn`. Read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-con13-readback.ts <address> [--show <event id>]
 */
import { queryRelay } from '@/nostr/bridge'
import { fileMentionsAsViewer } from '@/nostr/fileMentions'
import { isCommentOn } from '@estiva-app/conversation'
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
  const token = await agentToken()
  const args = process.argv.slice(2)
  const showAt = args.indexOf('--show')
  if (showAt >= 0) {
    const r = await queryRelay(RELAY_URL, [{ kinds: [1111, 9], limit: 5000 }], token.accessToken, token.pubkey)
    console.log(JSON.stringify(r.events.find((e) => e.id.startsWith(args[showAt + 1])), null, 1))
    return
  }
  const address = args[0]
  if (!address) throw new Error('usage: <address>')
  // Both kinds, as `resolveForeignObject` reads a Ship issue (its manifest says `alsoRead: [9]`) — CON-14.
  const tagged = await queryRelay(RELAY_URL, [{ kinds: [1111, 9], '#a': [address], limit: 500 }], token.accessToken, token.pubkey)
  if (!tagged.ok) throw new Error(`#a read refused: ${tagged.reason}`)
  const roots = tagged.events.filter((e) => !e.tags.some((t) => t[0] === 'e'))
  console.log(`${tagged.events.length} kind:1111/9 carry ${address} as \`a\` (${roots.length} roots)`)
  for (const e of roots) {
    const A = e.tags.find((t) => t[0] === 'A')?.[1] ?? '-'
    console.log(`  ${e.id.slice(0, 8)} kind:${e.kind} A=${A.slice(0, 14)}… isCommentOn=${isCommentOn(e, address)} ${JSON.stringify(e.content.slice(0, 50))}`)
  }
  // The page's own root read: `useFileConversationView` hands every `#a` root to this, and it drops the mentions.
  const h = roots[0]?.tags.find((t) => t[0] === 'h')?.[1] ?? ''
  const conversation = await fileConversationAsViewer({ kind: 'file', address, h }, roots.map((r) => r.id), RELAY_URL, token)
  console.log(`fileConversationAsViewer keeps ${conversation.roots.length} of ${roots.length} root(s): ${conversation.roots.map((r) => `${r.id.slice(0, 8)} kind:${r.kind}`).join(', ')}`)
  const mentions = await fileMentionsAsViewer(address, RELAY_URL, token)
  console.log(`useFileMentions → ${mentions.length} row(s) under Mentioned in:`)
  for (const m of mentions) console.log(`  ${m.id.slice(0, 8)} said in ${m.saidIn.slice(0, 14)}… ${JSON.stringify(m.body.slice(0, 50))}`)
}
