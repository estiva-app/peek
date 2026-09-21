/**
 * CON-15's done-when, read back from production through the app's own reads:
 * for one address (a Ship issue), what the widget count (`conversationsAsViewer`,
 * behind `useConversationBadges`) and the widget's read-only comments list
 * (`resolveObjectAsViewer`) say, beside the raw `#a` union that interop
 * 0.25.0 counted. Read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-con15-readback.ts <address>
 */
import { queryRelay } from '@/nostr/bridge'
import { conversationsAsViewer, resolveObjectAsViewer } from '@/nostr/foreign'
import { isCommentOn } from '@/nostr/fileConversation'
import type { StoredToken } from '@/auth/estivaId'
import { createRequire } from 'node:module'

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
  const address = process.argv[2]
  if (!address) throw new Error('usage: <address>')
  const require = createRequire(import.meta.url)
  console.log(`interop ${(require('@estiva-app/interop/package.json') as { version: string }).version} (what this checkout bundles)`)
  const token = await agentToken()

  // The before: interop 0.25.0 counted every kind:1111/9 carrying the address as `a`.
  const tagged = await queryRelay(RELAY_URL, [{ kinds: [1111, 9], '#a': [address], limit: 500 }], token.accessToken, token.pubkey)
  if (!tagged.ok) throw new Error(`#a read refused: ${tagged.reason}`)
  console.log(`raw #a union (what 0.25.0 counted): ${tagged.events.length}`)
  for (const e of tagged.events) {
    const A = e.tags.find((t) => t[0] === 'A')?.[1] ?? '-'
    console.log(`  ${e.id.slice(0, 8)} kind:${e.kind} A=${A.slice(0, 14)}… app isCommentOn=${isCommentOn(e, address)} ${JSON.stringify(e.content.slice(0, 40))}`)
  }

  // The after, through the same two reads the app makes.
  const found = await resolveObjectAsViewer(address, RELAY_URL, token)
  if (!found) throw new Error('resolveObjectAsViewer: null')
  console.log(`resolveObjectAsViewer comments: ${found.comments.length} → ${found.comments.map((c) => c.id.slice(0, 8)).join(', ')}`)
  const conversations = await conversationsAsViewer([found], RELAY_URL, token)
  const messages = conversations[found.ref] ?? []
  console.log(`widget count (conversationsAsViewer): ${messages.length} → ${messages.map((m) => m.id.slice(0, 8)).join(', ')}`)
}
