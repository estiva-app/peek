/**
 * FOL-26: where each Convex topic's old link should land — read-only, run as
 * the agent identity against production.
 *
 *   cd ~/peek-fol26-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol26-topic-links.ts
 *
 * Prints `src/lib/legacyTopicLinks.ts`'s table. The target is resolved exactly
 * the way `shr8-migrate.ts` chose where each topic's messages went, because a
 * link should land where the conversation now is: a `30840` in a team whose
 * `title` is the Convex title verbatim (CON-4's contract), and otherwise the
 * Ship project that lives in the topic's channel (CON-12). A topic with
 * neither is printed as unresolved, for a person to place by hand.
 *
 * Convex is read once, here, so the bundle never has to: the table is what
 * lets the old routes redirect with `*.convex.cloud` blocked.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { TEAMS } from './con4-discarded.js'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

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
  const text = await res.text()
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text.slice(0, 200)}`)
  return JSON.parse(text) as SignedEvent[]
}

async function convex<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (body.status === 'error') throw new Error(`${path}: ${body.errorMessage}`)
  return (body.value ?? body) as T
}

const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]

async function main() {
  const t = await token()
  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})

  // A `30840` in a team, by title — every author, not only the agent's, so a
  // file a person made under the same title shows up as the ambiguity it is.
  const files: Array<{ team: string; e: SignedEvent }> = []
  for (const [team, uuid] of Object.entries(TEAMS)) {
    for (const e of await query([{ kinds: [30840], '#h': [uuid], limit: 500 }], t)) files.push({ team, e })
  }

  // The Ship project in a channel: both spellings, then the re-linked ones by
  // their issues' `h` and `a` — `shr8-migrate.ts` `survey` explains all three.
  const projects = await query([{ kinds: [30850], limit: 500 }], t)
  const projectAddress = (p: SignedEvent) => `30850:${p.pubkey}:${tag(p, 'd')}`
  const projectByChannel = new Map<string, string>()
  for (const p of projects) {
    const channel = tag(p, 'h') ?? tag(p, 'buzz-channel')
    if (channel) projectByChannel.set(channel, projectAddress(p))
  }
  const known = new Set(projects.map(projectAddress))
  for (const issue of await query([{ kinds: [30851], limit: 2000 }], t)) {
    const channel = tag(issue, 'h')
    const address = tag(issue, 'a')
    if (channel && address && known.has(address) && !projectByChannel.has(channel)) projectByChannel.set(channel, address)
  }

  const rows: string[] = []
  for (const topic of topics) {
    const byTitle = files.filter((f) => tag(f.e, 'title') === topic.title)
    const byTitleNewest = [...byTitle].sort((a, b) => b.e.created_at - a.e.created_at)[0]
    const project = topic.channelUuid ? projectByChannel.get(topic.channelUuid) : undefined
    const address = byTitleNewest
      ? `30840:${byTitleNewest.e.pubkey}:${tag(byTitleNewest.e, 'd')}`
      : project
    const note = byTitle.length > 1 ? ` // AMBIGUOUS: ${byTitle.length} files titled this` : ''
    rows.push(
      `  { id: ${JSON.stringify(topic.id)}, channel: ${JSON.stringify(topic.channelUuid)}, title: ${JSON.stringify(topic.title)}, ` +
        (address ? `file: ${JSON.stringify(address)}` : `team: 'UNRESOLVED'`) +
        ` },${note}${byTitleNewest && project ? ` // also a project in its channel: ${project}` : ''}`,
    )
  }
  console.log(`// ${topics.length} topics, read ${new Date().toISOString()}`)
  console.log(rows.join('\n'))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
