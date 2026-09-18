/**
 * DMS-6: the hidden-DM set lives on the relay, and only its owner can read it.
 *
 * ## What is being checked, and why it needs a person
 *
 * Four things, and the ticket's done-when is all four: hiding a DM removes it
 * from the sidebar; the relay's `kind:30622` for that viewer lists the DM's
 * `h`; a second device agrees; and no other identity can read that snapshot.
 *
 * The first is checked by eye in Peek. The other three are relay facts, and
 * they can only be established as a **participant**: the agent is in no DM,
 * so it holds no hidden set and cannot hide anything. Its identity is the
 * *control* here and nothing more — the one that must be refused.
 *
 * So the person runs this as themselves, with the token out of a signed-in
 * Peek tab, exactly as `dms5-live-check.ts` does. No secret key is involved
 * and none may be put here.
 *
 * ## The legs
 *
 *   npx tsx scripts/dms6-live-check.ts --as token.json
 *       Read your snapshot: which DM channels the relay says you have hidden.
 *       Run it first, so the later legs have a before.
 *
 *   npx tsx scripts/dms6-live-check.ts --as token.json --hide <uuid>
 *       Publish a `41012` for that DM from *outside Peek*, then re-read the
 *       snapshot: the `h` must now be listed. Then look at Peek's People list
 *       on a second device or a fresh tab — the row must be gone there too,
 *       because the sidebar reads this snapshot and nothing else.
 *
 *   npx tsx scripts/dms6-live-check.ts --as token.json --reopen <partner-pubkey>
 *       Publish the `41010` again for that person — the relay's only unhide —
 *       then re-read: the `h` must be gone. This is what Peek does when you
 *       open a hidden DM.
 *
 *   npx tsx scripts/dms6-live-check.ts --peek-at <your-pubkey> [--snapshot <id>]
 *       The control, as the AGENT: ask for your snapshot three ways — by `#p`,
 *       by `ids` with the kind, and by `ids` with no kind at all. Every one
 *       must come back refused or empty. Pass the snapshot id the first leg
 *       printed, or only the `#p` leg runs.
 *
 * Hiding in Peek and running the first leg again is the fourth reading: the
 * `h` Peek hid must be the one the relay lists.
 *
 * `--hide` and `--reopen` write to your real hidden set. Everything else is
 * read-only.
 *
 * `--as <file>` is the token JSON out of a signed-in Peek tab —
 * `sessionStorage.getItem('peek.estivaId.token')`, which carries `pubkey` and
 * `accessToken`. Keep the file outside this repository.
 *
 *   cd ~/estiva-agent && set -a && . ~/.estiva-agent.env && set +a && cd -
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildDmHide, buildDmOpen, KIND } from '@estiva-app/protocol'
import type { SignedEvent, Signer } from '@estiva-app/protocol'

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

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const when = (event: SignedEvent) => new Date(event.created_at * 1000).toISOString().slice(0, 19)
const hs = (event: SignedEvent) => event.tags.filter((t) => t[0] === 'h').map((t) => t[1])

/** The token JSON a signed-in Peek tab keeps, as this script needs it. */
function personToken(path: string): { pubkey: string; accessToken: string } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { pubkey?: string; accessToken?: string }
  if (!raw.pubkey || !raw.accessToken) {
    throw new Error(`${path} is not a Peek token: expected {"pubkey":…,"accessToken":…}`)
  }
  return { pubkey: raw.pubkey, accessToken: raw.accessToken }
}

/** The one authorised read, exactly as `src/nostr/dmVisibility.ts` sends it. */
async function readSnapshot(relay: RelayClient, pubkey: string): Promise<SignedEvent | undefined> {
  const events = await relay.query([{ kinds: [KIND.DM_VISIBILITY], '#p': [pubkey], limit: 1 }])
  return events.sort((a, b) => b.created_at - a.created_at)[0]
}

function printSnapshot(label: string, snapshot: SignedEvent | undefined) {
  if (!snapshot) {
    console.log(`${label}: no snapshot — the relay has never written one for this viewer, so nothing is hidden.`)
    return
  }
  const hidden = hs(snapshot)
  console.log(`${label}: snapshot ${snapshot.id} at ${when(snapshot)}, signed by ${snapshot.pubkey.slice(0, 8)}… (the relay)`)
  if (hidden.length === 0) console.log('  hidden: nothing')
  for (const h of hidden) console.log(`  hidden: ${h}`)
}

/** A read that must not succeed. Refused and empty are both a pass; events are a fail. */
async function mustNotRead(relay: RelayClient, label: string, filter: Record<string, unknown>): Promise<boolean> {
  try {
    const events = await relay.query([filter])
    if (events.length === 0) {
      console.log(`  ${label}: empty — pass`)
      return true
    }
    console.log(`  ${label}: ${events.length} event(s) came back — FAIL, a non-owner read the snapshot`)
    return false
  } catch (error) {
    console.log(`  ${label}: refused (${error instanceof Error ? error.message : String(error)}) — pass`)
    return true
  }
}

async function main() {
  const client = await agentClient()
  const credentials = client.loadCredentials()
  const asFile = arg('as')
  const peekAt = arg('peek-at')

  if (peekAt) {
    if (asFile) throw new Error('--peek-at is the control and runs as the agent; drop --as')
    const service = await client.serviceIdentitySigner(credentials)
    const relay = new client.Relay(RELAY_URL, service.signer)
    console.log(`relay ${RELAY_URL}, reading as the agent ${service.signer.pubkey.slice(0, 8)}…`)
    console.log(`\nasking for ${peekAt.slice(0, 8)}…'s hidden set, which is not the agent's to read:`)
    const results = [await mustNotRead(relay, 'by #p', { kinds: [KIND.DM_VISIBILITY], '#p': [peekAt], limit: 1 })]
    const snapshotId = arg('snapshot')
    if (snapshotId) {
      // The two ways round the `#p` gate a reader might try: naming the event,
      // and naming it with no kind so the kind gate is not consulted.
      results.push(await mustNotRead(relay, 'by ids, with the kind', { kinds: [KIND.DM_VISIBILITY], ids: [snapshotId] }))
      results.push(await mustNotRead(relay, 'by ids, kindless', { ids: [snapshotId] }))
    } else {
      console.log('  (pass --snapshot <id> from the owner\'s read to also try the two by-id routes)')
    }
    // A negative control is only evidence beside a positive one: prove this
    // identity can read *something*, or "empty" could mean the relay is down.
    const anything = await relay.query([{ kinds: [9], limit: 1 }])
    console.log(anything.length ? '\ncontrol: the agent can read a kind:9, so empty above is a refusal and not an outage' : '\nWARNING: the agent read nothing at all — the empties above prove nothing')
    if (!results.every(Boolean) || anything.length === 0) process.exitCode = 1
    return
  }

  if (!asFile) {
    throw new Error(
      'This check runs as a person: pass --as <token.json>. The agent is in no DM, so\n' +
        'it has no hidden set to read and nothing to hide; its only leg is --peek-at.',
    )
  }
  const token = personToken(asFile)
  const signer = client.estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.accessToken })
  const relay = new client.Relay(RELAY_URL, signer)
  console.log(`relay ${RELAY_URL}, acting as the person ${token.pubkey.slice(0, 8)}…\n`)

  const before = await readSnapshot(relay, token.pubkey)
  printSnapshot('before', before)

  const hide = arg('hide')
  const reopen = arg('reopen')
  if (!hide && !reopen) {
    console.log(
      '\nThat is the set Peek\'s People list hides. Hide a DM in Peek and run this again:\n' +
        'its channel uuid must appear above. Or pass --hide <uuid> to do it from here.\n' +
        `For the control: npx tsx scripts/dms6-live-check.ts --peek-at ${token.pubkey}` +
        (before ? ` --snapshot ${before.id}` : ''),
    )
    return
  }

  if (hide) {
    const signed = await signer.sign(buildDmHide(token.pubkey, Date.now(), { channelUuid: hide }))
    const result = await relay.publish(signed)
    console.log(`\n41012 for ${hide}: ${result.ok ? `accepted, id ${signed.id}` : `REFUSED: ${result.reason}`}`)
    if (!result.ok) {
      console.log('`forbidden: not a member of this DM` means that uuid is not one of your DMs; `invalid: channel is not a DM` means it is a topic.')
      process.exitCode = 1
      return
    }
  }
  if (reopen) {
    const signed = await signer.sign(buildDmOpen(token.pubkey, Date.now(), { otherPubkeys: [reopen] }))
    const result = await relay.publish(signed)
    console.log(`\n41010 with ${reopen.slice(0, 8)}…: ${result.ok ? `accepted, id ${signed.id}` : `REFUSED: ${result.reason}`}`)
    if (!result.ok) {
      process.exitCode = 1
      return
    }
  }

  // The snapshot is republished after the command is answered (post-commit,
  // best-effort), so give it a moment rather than reading the old one back.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const after = await readSnapshot(relay, token.pubkey)
  printSnapshot('after', after)
  const hidden = after ? hs(after) : []
  if (hide) {
    const listed = hidden.includes(hide)
    console.log(listed ? `\n${hide} is listed — the relay holds the hide.` : `\nFAIL: ${hide} is not in the snapshot.`)
    if (!listed) process.exitCode = 1
    else {
      console.log(
        'Now open Peek\'s People list in another tab or on another device: that row must be\n' +
          'gone, and it must come back when you open the conversation (from the launcher, say).',
      )
    }
  }
  if (reopen && after && before) {
    const gone = hs(before).filter((h) => !hidden.includes(h))
    console.log(gone.length ? `\nre-open cleared: ${gone.join(', ')}` : '\nre-open cleared nothing — was that DM hidden, and is that pubkey its other participant?')
  }
  if (after && before && after.id === before.id) {
    console.log('\nWARNING: the snapshot did not change — the relay did not republish, or did so late.')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
