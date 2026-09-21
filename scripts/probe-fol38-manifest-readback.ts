/**
 * FOL-38: which URL shapes does Peek's *live* manifest declare?
 *
 * `scripts/publish-manifest.ts` says what the next publish will declare; this
 * reads what production's `kind:31990` for Peek declares today, because the
 * publish is a human's act (the manifest key lives in one checkout) and a
 * consumer resolves against the event on the relay, not the script. A shape
 * missing here resolves nowhere, whatever the script says.
 *
 * Reads as the agent (`~/.estiva-agent.env`), publishes nothing.
 *
 *   set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx scripts/probe-fol38-manifest-readback.ts
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'
import { urlPatternsOf } from '@estiva-app/interop'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
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

async function main() {
  const agent = await agentClient()
  const credentials = agent.loadCredentials()
  const token = await agent.clientCredentialsToken(credentials)
  const relay = new agent.Relay(RELAY_URL, agent.estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }))
  const manifests = await relay.query([{ kinds: [31990], limit: 100 }])
  for (const m of manifests) {
    const name = m.tags.find((t) => t[0] === 'name')?.[1] ?? m.tags.find((t) => t[0] === 'd')?.[1]
    const web = m.tags.filter((t) => t[0] === 'web').map((t) => `${t[1]} (${t[2] ?? ''})`)
    console.log(`\n${name}  by ${m.pubkey.slice(0, 8)}  at ${new Date(m.created_at * 1000).toISOString()}  id ${m.id.slice(0, 8)}`)
    for (const w of web) console.log(`  web  ${w}`)
    for (const u of urlPatternsOf(m)) console.log(`  urls ${u.pattern}  kind=${u.kind ?? '—'}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
