/**
 * FOL-38: do Peek's three links resolve against production, through the same
 * calls the widget makes?
 *
 * Reads as the agent, publishes nothing. For a real bare file with a real
 * root comment, and a real message, it builds the three URLs the ticket
 * names, matches each against the URL shapes on the relay (and against the
 * shape the next manifest publish adds, marked as such), then resolves what
 * the match names with `resolveForeignObject` / `resolveForeignEvent` and
 * prints what a consumer would draw. What it cannot prove: a person's
 * composer sending the tag — that leg is the person's (see the PR).
 *
 *   set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx scripts/probe-fol38-live-resolve.ts
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'
import {
  KIND_BARE_FILE,
  createProjectionCache,
  matchObjectUrl,
  resolveForeignEvent,
  resolveForeignObject,
  urlPatternsOf,
  type QueryFn,
  type UrlPattern,
} from '@estiva-app/interop'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const APP_URL = 'https://peek.estiva.app'
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva-agent-main')

interface AgentClient {
  loadCredentials(): { base: string; clientId: string }
  clientCredentialsToken(credentials: unknown): Promise<{ pubkey: string; access_token: string }>
  estivaIdSigner(options: { base: string; pubkey: string; token: string }): unknown
  Relay: new (url: string, signer: unknown) => { query(filters: Record<string, unknown>[]): Promise<SignedEvent[]> }
}
async function agentClient(): Promise<AgentClient> {
  const load = (rel: string) => import(pathToFileURL(join(AGENT_DIR, rel)).href)
  const [credentials, signer, protocol] = await Promise.all([
    load('lib/agent/credentials.ts'),
    load('lib/nostr/signer.ts'),
    load('node_modules/@estiva-app/protocol/dist/index.js'),
  ])
  return { ...credentials, ...signer, Relay: protocol.Relay }
}

const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

async function main() {
  const agent = await agentClient()
  const credentials = agent.loadCredentials()
  const token = await agent.clientCredentialsToken(credentials)
  const relay = new agent.Relay(RELAY_URL, agent.estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }))
  const query: QueryFn = (filters) => relay.query(filters)
  const cache = createProjectionCache()

  // ── the shapes ────────────────────────────────────────────────────────────
  const manifests = await query([{ kinds: [31990], limit: 100 }])
  const live: UrlPattern[] = manifests.flatMap((m) => urlPatternsOf(m))
  const next: UrlPattern[] = [...live, { pattern: `${APP_URL}/topic/<slug>-<d>?thread=<id>`, kind: 1111 }]
  const liveHasThread = live.some((p) => p.pattern.includes('?thread='))
  console.log(`live shapes: ${live.length}; thread shape on the relay: ${liveHasThread ? 'yes' : 'NO — resolves only after the manifest publish'}`)

  // ── real objects ──────────────────────────────────────────────────────────
  // A root comment on a bare file: `A` names a 30840 and there is no `e`.
  const comments = await query([{ kinds: [1111], '#K': [String(KIND_BARE_FILE)], limit: 50 }])
  const root = comments.find((c) => !c.tags.some((t) => t[0] === 'e') && tag(c, 'A')?.startsWith(`${KIND_BARE_FILE}:`))
  if (!root) throw new Error('no root comment on a bare file found')
  const fileAddress = tag(root, 'A')!
  const [, , fileD] = fileAddress.split(':')
  const [message] = await query([{ kinds: [9], limit: 1 }])
  if (!message) throw new Error('no kind:9 found')

  const urls = {
    topic: `${APP_URL}/topic/some-slug-${fileD}`,
    thread: `${APP_URL}/topic/some-slug-${fileD}?thread=${root.id}`,
    message: `${APP_URL}/message/${message.id}`,
  }

  for (const [name, url] of Object.entries(urls)) {
    console.log(`\n${name}: ${url}`)
    const onLive = matchObjectUrl(url, live)
    const onNext = matchObjectUrl(url, next)
    console.log(`  match (live):  ${JSON.stringify(onLive)}`)
    if (JSON.stringify(onLive) !== JSON.stringify(onNext)) console.log(`  match (next):  ${JSON.stringify(onNext)}`)
    const hit = onNext
    if (!hit) continue
    let found
    if (hit.by === 'id') {
      found = await resolveForeignEvent(hit.identifier, query, undefined, cache)
    } else {
      const filter: Record<string, unknown> = { '#d': [hit.identifier], limit: 1 }
      if (hit.kind !== undefined) filter.kinds = [hit.kind]
      const [object] = await query([filter])
      found = object ? await resolveForeignObject(`${object.kind}:${object.pubkey}:${hit.identifier}`, query, undefined, 0, cache) : null
    }
    if (!found) {
      console.log('  resolved:      null')
      continue
    }
    console.log(`  resolved:      kind ${found.kind}, widget ${JSON.stringify(found.widget)}, app ${found.appName}`)
    console.log(`  title:         ${JSON.stringify(found.slots.title?.value)}${found.slots.title?.isPubkey ? ' (pubkey)' : ''}`)
    console.log(`  body:          ${JSON.stringify(String(found.slots.body?.value ?? '').slice(0, 80))}`)
    console.log(`  openUrl:       ${found.openUrl}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
