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
 * ## Who publishes it, and why it is not the agent
 *
 * The obvious idea is for the agent to send the message. It cannot: a DM
 * channel's membership is the relay's ordinary private-channel access filter,
 * so the publisher has to be a participant — and **Peek only lets a person
 * start a DM with another person**, so the agent can never be one. The agent's
 * identity is therefore the *control* here and nothing else: a non-participant
 * must see nothing in a channel that provably has messages.
 *
 * So the participant publishes it, **as themselves, from here instead of from
 * Peek**. One person can do the whole check alone, and it is stronger than the
 * two-identity version rather than weaker:
 *
 *   - the message never touches Convex, because Peek is not in the path;
 *   - it arrives on the live subscription as a genuinely new event, which the
 *     delete-a-row variant cannot test;
 *   - it renders as the reader's own message appearing in a conversation they
 *     did not type it into, which is unmistakable.
 *
 * Word it so it cannot be confused with something typed in Peek — the time, and
 * "from outside Peek".
 *
 * ## The order, because the channel is minted by the relay
 *
 * A DM channel's uuid is `Uuid::new_v4()` keyed by a hash of the participant
 * set (`buzz-db/src/dm.rs`), so it cannot be computed and the publish's answer
 * is the only place it appears. This script never opens a DM — `Relay.publish()`
 * drops the accepted branch's payload, where the uuid is — so the uuid comes
 * from a DM that already exists:
 *
 *   1. Run with `--as` and no `--dm`. That lists every channel the identity can
 *      read a `kind:9` in; an existing DM with a colleague is one of them. (The
 *      `dmConversations` row in the Convex dashboard says the same thing.)
 *   2. Leave that DM open in Peek, on screen, and do not reload it.
 *   3. Run with `--as`, `--dm` and `--say`.
 *   4. Watch. The message must appear within the flush window, attributed to
 *      you, without a reload. Convex has no row for it, so the projection is
 *      the only thing that could have put it there.
 *   5. Then run with `--dm` and **no** `--as`: the agent must see nothing in
 *      the same channel. An empty answer from an empty channel is not evidence.
 *
 *   npx tsx scripts/dms5-live-check.ts --as token.json                       # find the uuid
 *   npx tsx scripts/dms5-live-check.ts --as token.json --dm <uuid>           # read it
 *   npx tsx scripts/dms5-live-check.ts --as token.json --dm <uuid> --say "…" # the check
 *   npx tsx scripts/dms5-live-check.ts --dm <uuid>                           # the control
 *
 * `--say` is the only leg that writes, and it writes a real message into a real
 * conversation. Everything else is read-only.
 *
 * `--as <file>` is the token JSON out of a signed-in Peek tab —
 * `sessionStorage.getItem('peek.estivaId.token')`, which carries `pubkey` and
 * `accessToken`. No secret key is involved and none may be put here: the token
 * is a bearer credential with an hour on it and `/sign` does the signing.
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
    const byChannel = new Map<string, { count: number; authors: Set<string> }>()
    for (const e of events) {
      const h = tag(e, 'h') ?? '(no h)'
      const row = byChannel.get(h) ?? { count: 0, authors: new Set<string>() }
      row.count += 1
      row.authors.add(e.pubkey)
      byChannel.set(h, row)
    }
    if (byChannel.size === 0) {
      console.log('no kind:9 is readable by this identity in any channel.')
      return
    }
    // The author count is a hint, not a test: nothing in a `kind:9` says which
    // kind of channel it is in, and a quiet topic has few authors too. It is
    // enough to narrow a list to the two or three worth checking against the
    // `dmConversations` rows.
    console.log('channels this identity can read a kind:9 in (authors is a hint at DMs):')
    for (const [h, row] of [...byChannel].sort((a, b) => b[1].count - a[1].count)) {
      console.log(
        `  ${h}  ${String(row.count).padStart(3)} message${row.count === 1 ? ' ' : 's'}  ${row.authors.size} author${row.authors.size === 1 ? '' : 's'}`,
      )
    }
    console.log('\nPass one as --dm to look inside it.')
    return
  }

  const say = arg('say')
  if (has('say')) {
    if (!say) throw new Error('--say needs the message text')
    if (!asFile) {
      throw new Error(
        '--say needs --as: only a participant may publish into a DM channel, and Peek\n' +
          'lets a person start a DM only with another person, so the agent can never be one.\n' +
          'Publish as yourself — the point is that the message bypasses Peek, not that\n' +
          'somebody else wrote it.',
      )
    }
    /*
      The whole point of the check: this event has no Convex row and never will
      until the projection makes one. The same words typed into Peek would write
      a Convex row first and arrive by reactivity, proving nothing.
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
        '\n`relay_membership_required` here means this token is not a participant in that\n' +
          'channel — check the uuid against the DMs this identity can read (no --dm).',
      )
      process.exitCode = 1
      return
    }
    console.log(
      '\nNow look at that DM in Peek, already open, without reloading.\n' +
        `  - "${say}" must appear, attributed to you, within a second or two\n` +
        '  - Convex has no row for it, so the projection is the only way it could\n' +
        '  - if it only appears after a reload, the live subscription is not covering DMs\n' +
        '  - if it never appears, the projection is not either\n',
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
