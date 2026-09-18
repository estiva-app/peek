/**
 * DMS-5: a DM message that exists **only** on the relay reaches Peek.
 *
 * ## The false positive this script exists to rule out
 *
 * The ticket's done-when is *"a DM sent from one identity appears in the other's
 * Peek without a reload"*, and taken at face value that is satisfiable with this
 * change reverted. Both participants read the same Convex rows, so a DM sent
 * from one Peek tab already appears in the other's by Convex reactivity alone —
 * the relay copy is written, ignored, and nothing notices. `watchableChannels`
 * in `convex/nostr/sync.ts` used to say exactly that, as the reason DMs were
 * *not* subscribed.
 *
 * So the only honest check is a DM message with **no Convex row anywhere**:
 * a `kind:9` published straight into the DM channel by something that is not
 * Peek. That is what this script sends. If it renders in Peek, it can only have
 * arrived through the projection DMS-5 wired up, because there was no other
 * copy of it to render.
 *
 * ## Why a person still has to finish it
 *
 * No agent can be a signed-in Peek viewer, so this proves the relay half and
 * hands over the half that needs a browser. It also means the agent's identity
 * has to be one of the DM's participants — a DM channel's membership is the
 * relay's ordinary private-channel access filter, and a non-participant is
 * refused with `403 relay_membership_required`, which is also this script's
 * control.
 *
 * ## The order, because the channel is minted by the relay
 *
 * A DM channel's uuid is `Uuid::new_v4()` keyed by a hash of the participant
 * set (`buzz-db/src/dm.rs`), so it cannot be computed and the publish's answer
 * is the only place it appears. Peek reads it with `commandPayload`; the agent's
 * `Relay.publish()` drops the accepted branch's payload, so this script does not
 * try to open a DM at all. The person opens it, which is the realistic direction
 * anyway:
 *
 *   1. In Peek, send one DM to the agent's identity. That creates the
 *      `dmConversations` row, publishes the `kind:41010`, and records the
 *      channel uuid — and that message *is* the Convex-reactivity case, so it
 *      proves nothing on its own.
 *   2. Read the channel uuid back (`npx convex run nostr/data:listChannels`
 *      lists topics only, so take it from the `dmConversations` row in the
 *      dashboard) and pass it here.
 *   3. Leave the DM open in Peek. Run this with `--say`.
 *   4. Watch. The message must appear **without a reload**, attributed to the
 *      agent, within the flush window.
 *
 *   npx tsx scripts/dms5-live-check.ts --dm <uuid>                  # read it as the agent
 *   npx tsx scripts/dms5-live-check.ts --dm <uuid> --as token.json  # read it as the person
 *   npx tsx scripts/dms5-live-check.ts --dm <uuid> --say "hello from outside Peek"
 *   npx tsx scripts/dms5-live-check.ts                              # every channel this identity can read
 *
 * `--say` is the only leg that writes, and it writes a real message into a real
 * conversation. Everything else is read-only.
 *
 * `--as <file>` is the token JSON out of a signed-in Peek tab —
 * `sessionStorage.getItem('peek.estivaId.token')`, which carries `pubkey` and
 * `accessToken`. No secret key is involved and none may be put here.
 *
 *   cd ~/estiva-agent && set -a && . ~/.estiva-agent.env && set +a && cd -
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildMessage } from '@estiva-app/protocol'
import type { SignedEvent, Signer, UnsignedEvent } from '@estiva-app/protocol'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')

/**
 * The agent's own relay client, not a re-hand-rolled bridge: the NIP-98 nonce,
 * the bare-array `/query` and the token grant have each been mis-typed by a
 * probe before and each looked like a relay bug. Loaded at run time from the
 * sibling checkout because CI typechecks `scripts/` and has no sibling.
 */
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva-agent')
interface RelayClient {
  query(filters: Record<string, unknown>[]): Promise<SignedEvent[]>
  publish(event: SignedEvent): Promise<{ ok: boolean; reason?: string; duplicate?: boolean }>
}
interface AgentClient {
  loadCredentials(): { base: string; clientId: string }
  serviceIdentitySigner(credentials: unknown): Promise<{ signer: Signer; allowedKinds?: number[] }>
  estivaIdSigner(options: { base: string; pubkey: string; token: string }): Signer
  Relay: new (url: string, signer: Signer) => RelayClient
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
const has = (name: string) => process.argv.includes(`--${name}`)
const tag = (event: SignedEvent, name: string) => event.tags.find((t: string[]) => t[0] === name)?.[1]
const when = (event: SignedEvent) => new Date(event.created_at * 1000).toISOString().slice(0, 19)

/** The token JSON a signed-in Peek tab keeps, as this script needs it. */
function personToken(path: string): { pubkey: string; accessToken: string } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { pubkey?: string; accessToken?: string }
  if (!raw.pubkey || !raw.accessToken) {
    throw new Error(`${path} is not a Peek token: expected {"pubkey":…,"accessToken":…}`)
  }
  return { pubkey: raw.pubkey, accessToken: raw.accessToken }
}

async function main() {
  const client = await agentClient()
  const credentials = client.loadCredentials()
  const asFile = arg('as')

  let signer: Signer
  let who: string
  if (asFile) {
    const token = personToken(asFile)
    signer = client.estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.accessToken })
    who = `the person ${token.pubkey.slice(0, 8)}…`
  } else {
    const service = await client.serviceIdentitySigner(credentials)
    signer = service.signer
    who = `the agent ${service.signer.pubkey.slice(0, 8)}…`
  }

  const relay = new client.Relay(RELAY_URL, signer)
  const dm = arg('dm')
  console.log(`relay ${RELAY_URL}, reading as ${who}\n`)

  if (!dm) {
    // Discovery. On an identity that is in few channels this is a short list and
    // the DM is in it, which finds the uuid without touching the database.
    const events = await relay.query([{ kinds: [KIND_MESSAGE], limit: 200 }])
    const byChannel = new Map<string, number>()
    for (const e of events) {
      const h = tag(e, 'h') ?? '(no h)'
      byChannel.set(h, (byChannel.get(h) ?? 0) + 1)
    }
    if (byChannel.size === 0) {
      console.log('no kind:9 is readable by this identity in any channel.')
      return
    }
    console.log('channels this identity can read a kind:9 in:')
    for (const [h, n] of [...byChannel].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${h}  ${n} message${n === 1 ? '' : 's'}`)
    }
    console.log('\nPass one as --dm to look inside it.')
    return
  }

  const say = arg('say')
  if (has('say')) {
    if (!say) throw new Error('--say needs the message text')
    if (asFile) throw new Error('--say publishes as the agent; drop --as')
    /*
      The whole point of the check: this event has no Convex row and never will
      until the projection makes one. A message sent from a second Peek tab
      would arrive by Convex reactivity and prove nothing.
    */
    const unsigned: UnsignedEvent = buildMessage(signer.pubkey, Date.now(), {
      channelUuid: dm,
      content: say,
    })
    const signed = await signer.sign(unsigned)
    const result = await relay.publish(signed)
    console.log(result.ok ? `published ${signed.id}` : `REFUSED: ${result.reason}`)
    if (!result.ok) {
      console.log(
        '\n`relay_membership_required` here means this identity is not a participant —\n' +
          'the DM has to be one the person opened *with the agent*, not with somebody else.',
      )
      process.exitCode = 1
      return
    }
    console.log(
      '\nNow look at that DM in Peek, already open, without reloading.\n' +
        `  - the message "${say}" must appear, attributed to the agent\n` +
        '  - it has no Convex row of its own, so the projection is the only way it could\n' +
        '  - if it needs a reload, the live subscription is not covering DMs\n',
    )
  }

  const events = await relay.query([{ kinds: [KIND_MESSAGE], '#h': [dm], limit: 100 }])
  if (events.length === 0) {
    console.log(
      `nothing readable in ${dm}.\n\n` +
        'For the agent with no --as that is the **control**, and it is only evidence\n' +
        'if the same channel provably has messages when read as a participant:\n' +
        'an empty answer from an empty channel says nothing.',
    )
    return
  }
  console.log(`${events.length} kind:9 in ${dm}:`)
  for (const e of events.sort((a, b) => a.created_at - b.created_at)) {
    console.log(`  ${when(e)}  ${e.pubkey.slice(0, 8)}…  ${JSON.stringify(e.content.slice(0, 60))}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
