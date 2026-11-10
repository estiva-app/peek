/**
 * DMS-4: a message sent in a Peek DM is on the relay, and only its
 * participants can read it.
 *
 * Read-only, against **production**. It publishes nothing: the message it looks
 * for is one a person sent from Peek, because no agent can be a signed-in Peek
 * viewer and a message written by this script would prove that the relay
 * accepts a kind:9, not that Peek sends one.
 *
 * ## Two identities, because one cannot show both halves
 *
 * A DM channel is `channel_type='dm'`, `visibility='private'`, with the
 * participants as its members, so the privacy boundary is the relay's ordinary
 * private-channel access filter. Showing it holds therefore takes two readers:
 * a **participant**, who must see the message, and somebody **else**, who must
 * see nothing *in a channel that provably has messages*. An empty answer from
 * an empty channel is not evidence of anything.
 *
 * `--as <file>` is the participant half. The file is the token JSON out of a
 * signed-in Peek tab — `sessionStorage.getItem('peek.estivaId.token')`, which
 * carries `pubkey` and `accessToken`. No secret key is involved and none may be
 * put here: the token is a bearer credential with an hour on it, `/sign` does
 * the signing, and this reads and publishes nothing either way.
 *
 * Without `--as` it reads as the agent's own service identity
 * (`~/.estiva-agent.env`), which is in neither DM — the control.
 *
 *   cd ~/estiva-agent && set -a && . ~/.estiva-agent.env && set +a && cd -
 *   npx tsx scripts/dms4-live-check.ts --as /path/to/token.json          # what a participant reads
 *   npx tsx scripts/dms4-live-check.ts --theirs <uuid>                   # what a third identity reads
 *
 * With no `--mine`/`--theirs`, it lists every kind:9 the identity can read and
 * the channel each is in. On a fresh account that is a short list and the DM is
 * in it, which is how the channel uuid is found without touching the database.
 */
import { readFileSync } from 'node:fs'
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

/** The token JSON a signed-in Peek tab keeps, as this script needs it. */
function personToken(path: string): { pubkey: string; access_token: string } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { pubkey?: string; accessToken?: string }
  if (!raw.pubkey || !raw.accessToken) {
    throw new Error(`${path} is not a Peek token: expected {"pubkey":…,"accessToken":…}`)
  }
  return { pubkey: raw.pubkey, access_token: raw.accessToken }
}

async function main() {
  const { loadCredentials, clientCredentialsToken, estivaIdSigner, Relay } = await agentClient()
  const credentials = loadCredentials()
  const as = arg('as')
  const token = as ? personToken(as) : await clientCredentialsToken(credentials)
  const relay = new Relay(
    RELAY_URL,
    estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }),
  )
  const query = (filters: Record<string, unknown>[]) => relay.query(filters)
  console.log(`relay ${RELAY_URL}, reading as ${token.pubkey}${as ? ' (a person’s token)' : ' (the agent)'}\n`)

  const author = arg('author')
  if (author || (!arg('mine') && !arg('theirs'))) {
    const filter = author
      ? { kinds: [KIND_MESSAGE], authors: [author], limit: 20 }
      : { kinds: [KIND_MESSAGE], limit: 20 }
    const events = await query([filter])
    console.log(`kind:9 this identity can read${author ? ` by ${author.slice(0, 8)}…` : ''}: ${events.length}`)
    for (const e of events) {
      console.log(
        `  ${when(e)}  h=${tag(e, 'h') ?? '(none)'}  by ${e.pubkey.slice(0, 8)}…  ${JSON.stringify(e.content.slice(0, 60))}`,
      )
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
}

main().catch((error) => {
  console.error(`❌ ${(error as Error).message}`)
  process.exit(1)
})
