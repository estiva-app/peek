/**
 * DMS-4: a message sent in a Peek DM is on the relay, and only its
 * participants can read it.
 *
 * Read-only, against **production**, as the agent's own service identity
 * (`~/.estiva-agent.env`). It publishes nothing: the message this looks for is
 * one a person sent from Peek, because no agent can be a signed-in Peek viewer
 * and a message written by this script would prove the relay accepts a kind:9,
 * not that Peek sends one.
 *
 * ## The two legs, and why the second one needs a channel this identity is NOT in
 *
 * A DM channel is `channel_type='dm'`, `visibility='private'`, with the
 * participants as its members — so the privacy boundary is the relay's ordinary
 * private-channel access filter, and the way to show it holds is to ask for a
 * conversation somebody else is having. An *empty* answer from a channel that
 * has messages is the evidence; an empty answer from an empty channel is not,
 * which is why this asks for both and reports them together.
 *
 *   cd ~/estiva-agent && set -a && . ~/.estiva-agent.env && set +a && cd -
 *   npx tsx scripts/dms4-live-check.ts --author <the sender's pubkey>
 *   npx tsx scripts/dms4-live-check.ts --mine <uuid> --theirs <uuid>
 *
 * `--author` is the discovery pass: every kind:9 by that person this identity
 * can read, with the channel each is in. A DM sent *to this identity* shows up
 * there and its `h` is the uuid for `--mine`. `--theirs` is a DM channel of
 * theirs with somebody else — the control.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
/**
 * The agent's own relay client, not a re-hand-rolled bridge: the NIP-98 nonce,
 * the bare-array `/query` and the token grant have each been mis-typed by a
 * probe before and each looked like a relay bug. Loaded at run time from the
 * sibling checkout because CI typechecks `scripts/` and has no sibling.
 */
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva-agent')
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

const KIND_MESSAGE = 9

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const tag = (event: SignedEvent, name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1]
const when = (event: SignedEvent) => new Date(event.created_at * 1000).toISOString().slice(0, 19)

async function main() {
  const { loadCredentials, clientCredentialsToken, estivaIdSigner, Relay } = await agentClient()
  const credentials = loadCredentials()
  const token = await clientCredentialsToken(credentials)
  const relay = new Relay(
    RELAY_URL,
    estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }),
  )
  const query = (filters: Record<string, unknown>[]) => relay.query(filters)
  console.log(`relay ${RELAY_URL}, reading as ${token.pubkey}\n`)

  const author = arg('author')
  if (author) {
    const events = await query([{ kinds: [KIND_MESSAGE], authors: [author], limit: 20 }])
    console.log(`kind:9 by ${author.slice(0, 8)}… this identity can read: ${events.length}`)
    for (const e of events) {
      console.log(`  ${when(e)}  h=${tag(e, 'h') ?? '(none)'}  ${JSON.stringify(e.content.slice(0, 60))}`)
    }
    console.log()
  }

  const mine = arg('mine')
  if (mine) {
    const events = await query([{ kinds: [KIND_MESSAGE], '#h': [mine], limit: 20 }])
    console.log(`a channel this identity is in — ${mine}: ${events.length} kind:9`)
    for (const e of events) {
      console.log(`  ${when(e)}  by ${e.pubkey.slice(0, 8)}…  ${JSON.stringify(e.content.slice(0, 60))}`)
    }
    console.log(
      events.length > 0
        ? '  ✅ the other participant reads the message back'
        : '  ❌ nothing — either it was never published, or this identity is not a participant',
    )
    console.log()
  }

  const theirs = arg('theirs')
  if (theirs) {
    const events = await query([{ kinds: [KIND_MESSAGE], '#h': [theirs], limit: 20 }])
    console.log(`a channel this identity is NOT in — ${theirs}: ${events.length} kind:9`)
    console.log(
      events.length === 0
        ? '  ✅ refused: a third identity sees nothing in somebody else’s DM'
        : `  ❌ LEAK — ${events.length} event(s) readable by a non-participant`,
    )
    console.log()
  }

  if (!author && !mine && !theirs) console.log('nothing asked for: pass --author, --mine or --theirs')
}

main().catch((error) => {
  console.error(`❌ ${(error as Error).message}`)
  process.exit(1)
})
