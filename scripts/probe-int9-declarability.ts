/**
 * What can actually be declared today — measured, not reasoned about (INT-9).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/probe-int9-declarability.ts
 *
 * INT-9's three dead launcher rows each need a different fact settled, and all
 * three were previously settled by reading source. Read-only; publishes nothing.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const KIND_TOPIC = 39000
const KIND_PROJECT = 30850
const KIND_HANDLER = 31990

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, accessToken: string): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function bridge(path: string, payload: unknown, t: { accessToken: string; pubkey: string }) {
  const url = `${RELAY_URL.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

type Filter = Record<string, unknown>
/** Bare array in, bare array out — not `{events: […]}`. */
async function query(filters: Filter[], t: { accessToken: string; pubkey: string }): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, t)
  if (status !== 200) throw new Error(`POST /query ${JSON.stringify(filters)}: ${status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

const tagOf = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

async function main() {
  console.log(`relay ${RELAY_URL}\n`)
  const t = await token()
  console.log(`identity ${t.pubkey.slice(0, 16)}…\n`)

  // ── 1. A topic's Folder: is it readable off the event, or only from `d`? ──
  // `applyActionAsViewer` reads `h ?? buzz-channel` off the root it is acting
  // on. If a 39000 carries neither, a Peek action cannot be delivered however
  // honestly Peek declares it.
  const topics = await query([{ kinds: [KIND_TOPIC], limit: 40 }], t)
  console.log(`── kind:${KIND_TOPIC} topics: ${topics.length}`)
  const withH = topics.filter((e) => tagOf(e, 'h'))
  const withChannel = topics.filter((e) => tagOf(e, 'buzz-channel'))
  const withD = topics.filter((e) => tagOf(e, 'd'))
  console.log(`   carry h            : ${withH.length}/${topics.length}`)
  console.log(`   carry buzz-channel : ${withChannel.length}/${topics.length}`)
  console.log(`   carry d            : ${withD.length}/${topics.length}`)
  if (topics[0]) {
    console.log(`   newest tags        : ${JSON.stringify(topics[0].tags)}`)
    console.log(`   newest author      : ${topics[0].pubkey.slice(0, 16)}…`)
  }
  const authors = new Set(topics.map((e) => e.pubkey))
  console.log(`   distinct authors   : ${authors.size}`)

  // ── 2. A project's Folder tag, live ─────────────────────────────────────
  const projects = await query([{ kinds: [KIND_PROJECT], limit: 60 }], t)
  const pH = projects.filter((e) => tagOf(e, 'h')).length
  const pC = projects.filter((e) => tagOf(e, 'buzz-channel')).length
  console.log(`\n── kind:${KIND_PROJECT} projects: ${projects.length}`)
  console.log(`   carry h            : ${pH}`)
  console.log(`   carry buzz-channel : ${pC}`)

  // ── 3. What the two manifests declare, live rather than from source ──────
  const manifests = await query([{ kinds: [KIND_HANDLER], limit: 30 }], t)
  console.log(`\n── kind:${KIND_HANDLER} manifests: ${manifests.length}`)
  for (const m of manifests) {
    let parsed: { name?: string; actions?: { id: string; label: string }[] } = {}
    try {
      parsed = JSON.parse(m.content)
    } catch {
      console.log(`   ${tagOf(m, 'd')}: unparseable content`)
      continue
    }
    const ks = m.tags.filter((x) => x[0] === 'k').map((x) => x[1])
    const acts = parsed.actions ?? []
    console.log(
      `   ${tagOf(m, 'd')} (${parsed.name ?? '?'}) k=[${ks.join(',')}] actions=${acts.length}` +
        (acts.length ? `: ${acts.map((a) => a.id).join(', ')}` : ' — declares none'),
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
