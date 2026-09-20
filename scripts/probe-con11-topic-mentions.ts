/**
 * CON-11 on production, read-only: which messages on the relay name a Peek
 * topic's address — a `kind:9` or `kind:1111` carrying `a = 39000:<relay>:<uuid>`
 * — and whether each sits in that topic's own channel (its stream) or in
 * another (a mention, which is what Activity's second relation shows).
 *
 * Writes nothing.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con11-topic-mentions.ts
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const KIND_TOPIC = 39000

type Token = { accessToken: string; pubkey: string }

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${await res.text()}`)
  return (await res.json()) as SignedEvent[]
}

const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are not set')
  const t = await token()
  const topics = await query([{ kinds: [KIND_TOPIC], limit: 500 }], t)
  const addressOf = (e: SignedEvent) => `${e.kind}:${e.pubkey}:${tag(e, 'd')}`
  const titleOf = new Map(topics.map((e) => [addressOf(e), tag(e, 'name') ?? '?']))
  console.log(`${topics.length} kind:39000 on ${RELAY_URL} (agent ${t.pubkey.slice(0, 8)}…)`)
  const addresses = topics.map(addressOf)
  const mentions = await query([{ kinds: [9, 1111], '#a': addresses, limit: 2000 }], t)
  console.log(`${mentions.length} kind:9/1111 carrying a topic address in \`a\``)
  for (const m of mentions.sort((a, b) => a.created_at - b.created_at)) {
    const h = tag(m, 'h') ?? '-'
    const named = m.tags.filter((x) => x[0] === 'a' && titleOf.has(x[1])).map((x) => x[1])
    for (const a of named) {
      const own = a.endsWith(`:${h}`)
      console.log(
        `${new Date(m.created_at * 1000).toISOString().slice(0, 16)}  kind:${m.kind}  ${own ? 'IN ITS OWN channel' : 'from another channel'}  → "${titleOf.get(a)}" (${a.slice(-8)})\n` +
          `    h ${h.slice(0, 8)}…  by ${m.pubkey.slice(0, 8)}…  ${JSON.stringify(m.content.slice(0, 80))}`,
      )
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
