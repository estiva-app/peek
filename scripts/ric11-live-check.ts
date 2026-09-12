/**
 * RIC-11: a topic and a message, mentioned by pointer, resolve in a second
 * app with no shared fixture.
 *
 * This is the resolution leg, checked against **production** — the relay at
 * estiva.estiva.app, Peek's published manifest, real topics and real
 * messages — through the same runtime calls Ship's `resolveForeign` makes
 * (`@estiva-app/interop`, `resolveForeignObject` for an address and
 * `resolveForeignEvent` for an event). Nothing here is Peek's: no topic
 * list, no conversation snapshot, no bracket fixture. If a pointer resolves
 * here it resolves from the relay alone, which is what "no shared fixture"
 * means.
 *
 * It reads as the agent's service identity (`~/.estiva-agent.env`), because a
 * Peek session's token lives in a browser, and it publishes nothing — a test
 * message in somebody's topic is noise nobody asked for. So it proves that a
 * `nostr:naddr…` for a kind:39000 comes back as the topic's *current* name,
 * and a `nostr:nevent…` for a kind:9 comes back titled by its author's key
 * with the text as its body, marked `isPubkey` and drawn as a `message` — the
 * three facts both apps' `Reference` chips now draw from. What it does not
 * prove is the composer: that a person picking a topic in Peek's `[` menu
 * publishes exactly this pointer. That is unit-tested in
 * `textParsing.references.test.ts` and observed on production only once the
 * branch is deployed.
 *
 *   cd ~/estiva-agent && set -a && . ~/.estiva-agent.env && set +a && cd -
 *   npx tsx scripts/ric11-live-check.ts
 */
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { resolveForeignEvent, resolveForeignObject, createProjectionCache } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/interop'
// The agent's own client, not a re-hand-rolled bridge: the NIP-98 nonce, the
// bare-array `/query` and the token grant have each been mis-typed by a probe
// before and each looked like a relay bug.
import { clientCredentialsToken, loadCredentials } from '../../estiva-agent/lib/agent/credentials'
import { estivaIdSigner } from '../../estiva-agent/lib/nostr/signer'
import { Relay } from '../../estiva-agent/node_modules/@estiva-app/protocol/dist/index.js'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const KIND_TOPIC = 39000
const KIND_MESSAGE = 9
const KIND_MANIFEST = 31990

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const tag = (event: SignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

async function main() {
  const credentials = loadCredentials()
  const token = await clientCredentialsToken(credentials)
  const relay = new Relay(RELAY_URL, estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }))
  const query = (filters: Record<string, unknown>[]) => relay.query(filters) as Promise<SignedEvent[]>
  console.log(`relay ${RELAY_URL}, reading as ${token.pubkey.slice(0, 8)}…\n`)

  // Who draws these kinds. Discovery is the runtime's job; this only reports
  // what it will find, so a null below can be told from "no manifest".
  const manifests = await query([{ kinds: [KIND_MANIFEST], limit: 50 }])
  const claims = (kind: number) =>
    manifests.filter((m) => m.tags.some((t) => t[0] === 'k' && t[1] === String(kind))).map((m) => tag(m, 'd') ?? m.pubkey.slice(0, 8))
  check(`a manifest claims kind:${KIND_TOPIC}`, claims(KIND_TOPIC).length > 0, claims(KIND_TOPIC).join(', '))
  check(`a manifest claims kind:${KIND_MESSAGE}`, claims(KIND_MESSAGE).length > 0, claims(KIND_MESSAGE).join(', '))

  // A topic: the newest channel record the agent can read.
  const [topic] = await query([{ kinds: [KIND_TOPIC], limit: 1 }])
  check('the relay holds a kind:39000 the agent can read', !!topic)
  if (topic) {
    const address = `${KIND_TOPIC}:${topic.pubkey}:${tag(topic, 'd')}`
    const naddr = addrToNaddr(address, [])
    const cache = createProjectionCache()
    const object = await resolveForeignObject(`nostr:${naddr}`, query, undefined, 0, cache)
    check('nostr:naddr… for it resolves', !!object, object ? `kind ${object.kind}, app ${object.appName ?? '?'}` : 'null')
    check('its title is the channel’s current name', object?.slots.title?.value === tag(topic, 'name'), `"${object?.slots.title?.value}" vs name tag "${tag(topic, 'name')}"`)
    check('the title is text, not a key', !object?.slots.title?.isPubkey)
    console.log(`   ${address}`)
  }

  // A message: the newest kind:9 the agent can read. Whoever wrote it.
  const [message] = await query([{ kinds: [KIND_MESSAGE], limit: 1 }])
  check('the relay holds a kind:9 the agent can read', !!message)
  if (message) {
    const nevent = encodeNevent({ id: message.id, relays: [], kind: KIND_MESSAGE })
    const cache = createProjectionCache()
    const object = await resolveForeignEvent(`nostr:${nevent}`, query, undefined, cache)
    check('nostr:nevent… for it resolves', !!object, object ? `kind ${object.kind}, app ${object.appName ?? '?'}` : 'null')
    check('it is titled by its author, marked as a key', object?.slots.title?.isPubkey === true && object?.slots.title?.value === message.pubkey)
    check('the author has a name the runtime found', !!object?.people?.[message.pubkey]?.displayName, object?.people?.[message.pubkey]?.displayName ?? 'no profile')
    check('its body is the message text', object?.slots.body?.value === message.content, `${(object?.slots.body?.value ?? '').slice(0, 40)}…`)
    const widgets = Array.isArray(object?.widget) ? object?.widget : [object?.widget]
    check('it is drawn as a message', widgets.includes('message'), JSON.stringify(object?.widget))
    // The bare id — what an `e` tag gives you — must reach the same object.
    const bare = await resolveForeignEvent(message.id, query, undefined, cache)
    check('the bare id resolves to the same event', bare?.eventId === object?.eventId)
    console.log(`   ${message.id}`)
  }

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(`❌ ${(error as Error).message}`)
  process.exit(1)
})
