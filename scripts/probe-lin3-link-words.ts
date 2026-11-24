/**
 * LIN-3: which word does the shared writer give each file kind on production,
 * and what link does it write — beside the words Peek's own copy gives today.
 *
 * Reads every `kind:31990` as the agent, publishes nothing. Prints
 * `fileLinkWordsOf` (interop, the shared writer) and, for one real file of
 * each kind, the path it writes. A control: a made-up `d` that is not a v4
 * uuid gets no link.
 *
 *   set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-lin3-link-words.ts
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'
import { fileLinkWordsOf, filePathOf } from '@estiva-app/interop'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva', 'estiva-agent-main')

async function agentClient() {
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

  const manifests: SignedEvent[] = await relay.query([{ kinds: [31990], limit: 100 }])
  const words = fileLinkWordsOf(manifests)
  console.log(`relay ${RELAY_URL}: ${manifests.length} manifests`)
  console.log('shared words by kind', JSON.stringify(words.byKind))
  console.log('no words (before the manifests):', filePathOf(`30840:${'a'.repeat(64)}:0f8fad5b-d9cb-469f-a165-70867728950e`, { byKind: {} }))

  for (const kind of [30840, 30842, 30850, 30851, 30852]) {
    const [found] = await relay.query([{ kinds: [kind], limit: 1 }])
    if (!found) {
      console.log(`${kind}: no file`)
      continue
    }
    const d = found.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? ''
    const title = found.tags.find((t: string[]) => t[0] === 'title' || t[0] === 'name')?.[1]
    console.log(`${kind}: ${filePathOf(`${kind}:${found.pubkey}:${d}`, words, title)}`)
  }
  console.log('control, PROJ-1 →', filePathOf(`30850:${'a'.repeat(64)}:PROJ-1`, words))
  process.exit(0)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
