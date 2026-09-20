/**
 * CON-11's done-when, read back from production through the app's own read:
 * for every topic somebody has mentioned from another topic, what
 * `useTopicMentions` would hand Activity — the same `topicMentionsAsViewer`
 * the hook calls, against the real relay, as the agent. Read-only.
 *
 * Goes through Vite because `bridge.ts` reads `import.meta.env`:
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-con11-activity-readback.ts
 */
import { KIND_TOPIC } from '@/nostr/foreign'
import { queryRelay } from '@/nostr/bridge'
import { topicMentionsAsViewer } from '@/nostr/topicMentions'
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
  const topics = await queryRelay(RELAY_URL, [{ kinds: [KIND_TOPIC], limit: 500 }], token.accessToken, token.pubkey)
  if (!topics.ok) throw new Error(`kind:39000 read refused: ${topics.reason}`)
  const nameOf = (e: { tags: string[][] }) => e.tags.find((t) => t[0] === 'name')?.[1] ?? '?'
  console.log(`${topics.events.length} topics on ${RELAY_URL} as ${token.pubkey.slice(0, 8)}…`)
  let mentioned = 0
  for (const t of topics.events) {
    const uuid = t.tags.find((x) => x[0] === 'd')?.[1]
    if (!uuid) continue
    const address = `${t.kind}:${t.pubkey}:${uuid}`
    const mentions = await topicMentionsAsViewer(address, uuid, RELAY_URL, token)
    if (mentions.length === 0) continue
    mentioned += 1
    console.log(`\n"${nameOf(t)}" (${uuid}) — Activity would carry ${mentions.length} mention(s):`)
    for (const m of mentions) {
      const from = topics.events.find((x) => x.tags.some((y) => y[0] === 'd' && y[1] === m.folder))
      console.log(
        `  ${new Date(m.createdAt * 1000).toISOString().slice(0, 16)}  kind:${m.kind}  Mentioned in "${from ? nameOf(from) : m.folder}"  by ${m.author.slice(0, 8)}…\n` +
          `    saidIn ${m.saidIn.slice(0, 14)}…${m.saidIn.slice(-8)}  ${JSON.stringify(m.body.slice(0, 70))}`,
      )
    }
  }
  console.log(`\n${mentioned} topic(s) with a mention from another channel.`)
}
