/**
 * FOL-39: which words does production give Peek's file route, and does the
 * read the page makes for `/<word>/<slug>-<d>` answer with the right file?
 *
 * Reads as the agent, publishes nothing. Reads every `kind:31990` on the
 * relay, derives the route words exactly as the app does (`routeWordsOf`),
 * then for the ticket's two paths — the Composition project and one issue —
 * runs the `{kinds, "#d"}` query `fileAddressAsViewer` makes and prints the
 * address and title. Two controls: an unknown word resolves over every
 * declared kind (§7.7 rule 4), and a Folder's uuid under an unknown word
 * resolves to nothing, because 39000 is not a declared kind — which is what
 * "never a bare #d" buys.
 *
 * What it cannot prove: the deployed bundle serving the route. That is the
 * cold-load check in the PR, after the deploy.
 *
 *   set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol39-declared-shapes.ts
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'
import { urlPatternsOf } from '@estiva-app/interop'
import { declaredKinds, filePath, rememberRouteWords, routeWordsOf } from '@/lib/objectUrl'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva-agent-main')
/** The ticket's done-when project, "Composition" — its title is read back below, not assumed. */
const PROJECT_D = 'fa6af533-2fa1-48d8-b7f0-1f6330443e61'
/** This ticket, FOL-39. */
const ISSUE_D = 'acd32a8d-2974-40a8-a4c1-24a1867ff52f'

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

const titleOf = (event: SignedEvent) => event.tags.find((t) => t[0] === 'title' || t[0] === 'name')?.[1] ?? '(untitled)'

async function main() {
  const agent = await agentClient()
  const credentials = agent.loadCredentials()
  const token = await agent.clientCredentialsToken(credentials)
  const relay = new agent.Relay(RELAY_URL, agent.estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }))

  const manifests = await relay.query([{ kinds: [31990], limit: 100 }])
  const words = routeWordsOf(manifests.flatMap((m) => urlPatternsOf(m)))
  rememberRouteWords(words)
  console.log(`relay ${RELAY_URL}: ${manifests.length} manifests`)
  console.log('words  ', JSON.stringify(words.byWord))
  console.log('by kind', JSON.stringify(words.byKind))
  console.log('fallback kinds', declaredKinds(words).join(', '))

  const resolve = async (word: string, d: string) => {
    const kinds = words.byWord[word] ?? declaredKinds(words)
    const [found] = await relay.query([{ kinds: [...kinds], '#d': [d], limit: 1 }])
    const label = found ? `${found.kind}:${found.pubkey.slice(0, 8)}…:${d}  "${titleOf(found)}"` : 'nothing'
    console.log(`\n/${word}/…-${d}\n  kinds ${kinds.join(',')} → ${label}`)
    if (found) console.log(`  filePath → ${filePath(`${found.kind}:${found.pubkey}:${d}`, titleOf(found))}`)
    return found
  }

  await resolve('project', PROJECT_D)
  await resolve('issue', ISSUE_D)
  // Controls.
  await resolve('ticket', ISSUE_D)
  const [folder] = await relay.query([{ kinds: [39000], limit: 1 }])
  if (folder) {
    const folderD = folder.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const found = await resolve('ticket', folderD)
    console.log(found ? '  !! a Folder uuid answered under an unknown word' : '  ok: a Folder uuid is not a file (39000 is not a declared kind)')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
