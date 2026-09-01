/**
 * Publish Peek's NIP-89 manifest, then read it back and check it (PRO-6).
 *
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/publish-manifest.ts
 *
 * Modelled on Ship's script of the same name, and for the same reason: the
 * check worth having is not "did it publish" but **"can a consumer satisfy
 * what it declares"**. A manifest naming a tag no event carries is valid JSON,
 * publishes fine, and fails days later in somebody else's app as an empty
 * widget.
 *
 * ## The identity, and why this cannot run yet
 *
 * Publishing a `kind:31990` needs an identity the relay knows. Measured
 * 2026-08-31, both against production:
 *
 *   - a freshly generated key is refused at ingest with
 *     `relay_membership_required`
 *   - the agent's service identity is refused *before* ingest, by Estiva ID:
 *     `App claude-agent may not sign kind 31990`
 *
 * Those are gates 1 and 2 of SPEC §8's three, each refusing in a way that looks
 * like something else from the layer above. Ship publishes from a dedicated
 * `.manifest-key` that is a registered relay member; Peek has no equivalent.
 * Granting one is a seed change in Estiva ID plus a hand re-seed on the box
 * (operations/PRODUCTION.md), which is why this script exists complete and
 * unrun.
 *
 * It takes a signer rather than reading a key file so that whichever identity
 * is granted can be handed in without editing this.
 */
import { Relay, signEvent, publicKeyFromSecret, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { HANDLED_KINDS, MANIFEST_D_TAG, MESSAGE_KIND, TOPIC_KIND, manifestContent } from '../src/nostr/manifest'
import { widgetChainProblem, resolveForeignEvent, type QueryFn } from '@estiva-app/interop'

const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:3000'
const KEY_FILE = new URL('../.manifest-key', import.meta.url).pathname
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/'
const CLOSED_LIST = 'card, row, table, stat'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * Refuse to publish a production manifest pointing at a laptop.
 *
 * Ship's script learned this the expensive way on 2026-08-25: two green
 * republishes whose every "open in Peek" link was `http://localhost`. From the
 * script's point of view a localhost URL is a perfectly valid string, so there
 * is no failing check to notice — the assertion has to be made before signing.
 */
function assertUrlsAgree(relayUrl: string, appUrl: string): void {
  const local = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1)/.test(u)
  if (!local(relayUrl) && local(appUrl)) {
    console.error(
      `\n✋ Refusing to publish.\n` +
        `   relay is ${relayUrl} but the app URL is ${appUrl}.\n` +
        `   Every "open in Peek" link would point at localhost.\n` +
        `     APP_URL=https://peek.estiva.app/ RELAY_URL=https://estiva.estiva.app npx tsx scripts/publish-manifest.ts\n`,
    )
    process.exit(1)
  }
}

function manifestIdentity() {
  let secretKeyHex = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : ''
  if (!/^[0-9a-f]{64}$/.test(secretKeyHex)) {
    secretKeyHex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    writeFileSync(KEY_FILE, `${secretKeyHex}\n`, { mode: 0o600 })
    console.log('generated a new manifest key → .manifest-key (gitignored)')
    console.log('NOTE: a fresh key is NOT a relay member and will be refused at ingest.')
  }
  return { secretKeyHex, pubkey: publicKeyFromSecret(secretKeyHex) }
}

function buildManifest(pubkey: string, createdAtMs: number, appUrl: string): UnsignedEvent {
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: 31990,
    tags: [
      ['d', MANIFEST_D_TAG],
      ...HANDLED_KINDS.map((k) => ['k', String(k)]),
      // NIP-89's `web` tag. `<bech32>` is substituted by the consumer with the
      // entity it holds. A topic is addressable so an naddr resolves; a message
      // is not, which is recorded on the check below rather than papered over.
      /*
        One `web` tag per NIP-19 entity type, because Peek owns two shapes of
        object and they are not interchangeable.

        A Topic is addressable — the relay's `kind:39000`, whose `d` is the
        channel uuid — so `naddr` names it. A Message is a `kind:9` with no `d`
        at all, so **nothing but its event id can name it** and `nevent` is the
        only form that works. Declaring only the first is what PRO-11 found:
        a consumer rendering a message had no way to offer "open this in Peek",
        and `<bech32>` had nothing to substitute.

        Both point at the same route. It resolves the reference and then decides
        which surface to show, the way Ship's `#/o/` does — the entity type
        tells the *consumer* what it is holding, not the app what to do.
      */
      ['web', `${appUrl.replace(/\/+$/, '')}/#/o/<bech32>`, 'naddr'],
      ['web', `${appUrl.replace(/\/+$/, '')}/#/o/<bech32>`, 'nevent'],
    ],
    content: JSON.stringify(manifestContent()),
  }
}

async function main() {
  const identity = manifestIdentity()
  const signer = { pubkey: identity.pubkey, sign: async (e: UnsignedEvent) => signEvent(e, identity.secretKeyHex) }
  const relay = new Relay(RELAY_URL, signer as never)

  console.log(`relay    ${RELAY_URL}`)
  console.log(`manifest ${identity.pubkey.slice(0, 16)}…  (31990:<pubkey>:${MANIFEST_D_TAG})\n`)
  assertUrlsAgree(RELAY_URL, APP_URL)

  /*
    Every widget declaration is publishable — checked before signing, PRO-3.

    A chain that does not terminate in a type RFC 0.4 §13.3 closes is valid
    JSON, publishes fine, and renders as *nothing* in every consumer that has
    not heard of its first entry — which is the PEE-10 failure arriving in
    somebody else's app, caused by us, with no error anywhere.

    Refused rather than warned. A manifest is read by apps that cannot ask what
    was meant, and this is the one moment where the mistake is still cheap:
    `kind:31990` is replaceable, but every consumer that fetched the bad one
    holds it until it refetches.
  */
  for (const [kind, projection] of Object.entries(manifestContent().projections)) {
    const problem = widgetChainProblem((projection as { widget: unknown }).widget)
    if (problem) {
      console.error(`\n✋ Refusing to publish. kind:${kind} — ${problem}\n`)
      process.exit(1)
    }
  }
  check('every widget chain terminates in a closed type', true, CLOSED_LIST)

  const event = buildManifest(identity.pubkey, Date.now(), APP_URL)
  const published = await relay.publish(signEvent(event, identity.secretKeyHex))
  check('the relay accepts kind:31990', published.ok, published.reason ?? '')
  if (!published.ok) process.exit(1)

  // ── Discovery: the check PRO-6's done-when names ──────────────────────────
  // A consumer will not know Peek's pubkey. It holds an object of some kind and
  // asks "who handles this?", which is a `#k` filter.
  for (const kind of HANDLED_KINDS) {
    const found = await relay.query([{ kinds: [31990], '#k': [String(kind)], limit: 20 }])
    check(
      `a consumer holding a kind:${kind} finds a handler by #k`,
      found.some((e: SignedEvent) => e.pubkey === identity.pubkey),
      `${found.length} manifest(s) declare kind ${kind}`,
    )
  }

  const [stored] = await relay.query([
    { kinds: [31990], authors: [identity.pubkey], '#d': [MANIFEST_D_TAG], limit: 1 },
  ])
  check('the manifest reads back', !!stored)
  if (!stored) process.exit(1)

  const manifest = JSON.parse(stored.content)

  // ── Can the projections be satisfied by objects that actually exist? ──────
  /*
    Sample several topics, not the first one.

    The first version asked `limit: 1` and asserted that topic had messages.
    **19 of production's 30 topics are empty**, so a correct manifest failed
    roughly two runs in three depending on which one sorted first — and the
    failure said "list resolves 0 children", which is indistinguishable from
    the declaration being wrong. That is the same confusion between *empty* and
    *broken* this script exists to catch, turned on itself.

    What "the declaration is satisfiable" actually means is that the query shape
    finds children **where children exist**, so the check has to find such a
    topic before it can assert anything.
  */
  const topics = await relay.query([{ kinds: [TOPIC_KIND], limit: 30 }])
  check('there are real topics to project', topics.length > 0, `${topics.length} topic(s)`)
  let topic = topics[0]
  let children: Awaited<ReturnType<typeof relay.query>> = []
  const listSpec = manifest.projections[String(TOPIC_KIND)].slots.list.children
  let empties = 0
  for (const candidate of topics) {
    const cd = candidate.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? ''
    const found = await relay.query([{ kinds: [listSpec.kind], [`#${listSpec.via}`]: [cd], limit: listSpec.limit }])
    if (found.length > 0) { topic = candidate; children = found; break }
    empties++
  }
  if (topic) {
    const slots = manifest.projections[String(TOPIC_KIND)].slots
    const name = topic.tags.find((t: string[]) => t[0] === slots.title.tag)?.[1]
    check(`  topic slot "title" (tag:${slots.title.tag}) resolves`, !!name, name)

    const d = topic.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? ''
    const { via, match } = slots.list.children
    check(
      `  topic slot "list" resolves children by #${via} (match:${match})`,
      children.length > 0,
      `${children.length} message(s) in ${d}${empties ? `, after ${empties} empty topic(s)` : ''}`,
    )
    /*
      The whole reason `match` exists — and this control is only worth anything
      against a topic that HAS children.

      Its first version ran against whatever topic came first and reported
      "0 by address vs 0 by identifier" as a pass. Both arms were zero because
      the topic was empty, so it would have passed just as happily if `match`
      did nothing at all. A control that cannot fail is not a control; the loop
      above is what gives this one something to distinguish.
    */
    const asAddress = await relay.query([
      { kinds: [listSpec.kind], [`#${via}`]: [`${TOPIC_KIND}:${topic.pubkey}:${d}`], limit: 5 },
    ])
    check(
      '  …and the same query by address finds nothing, which is why match exists',
      children.length > 0 && asAddress.length === 0,
      `${asAddress.length} by address vs ${children.length} by identifier`,
    )
  }

  const [message] = await relay.query([{ kinds: [MESSAGE_KIND], limit: 1 }])
  check('there is a real message to project', !!message)
  if (message) {
    const slots = manifest.projections[String(MESSAGE_KIND)].slots
    check('  message slot "title" (field:pubkey) resolves', !!message.pubkey, message.pubkey.slice(0, 16) + '…')
    check('  message slot "body" (field:content) resolves', !!message.content, `${message.content.length} chars`)
    check(
      '  the widget declares a chain terminating in a closed type',
      Array.isArray(slots ? manifest.projections[String(MESSAGE_KIND)].widget : null) &&
        ['card', 'row', 'table', 'stat'].includes(
          manifest.projections[String(MESSAGE_KIND)].widget.at(-1),
        ),
      JSON.stringify(manifest.projections[String(MESSAGE_KIND)].widget),
    )
    check(
      '  a message carries no `d`, so it is NOT addressable — resolved by id instead',
      !message.tags.some((t: string[]) => t[0] === 'd'),
      'recorded, not a failure',
    )

    /*
      The message actually resolves by id — PRO-11.

      This was recorded as a known gap for two tickets: a projection could be
      declared for kind:9 and nothing could look one up. Now it can, and the
      check is the resolve rather than the declaration, because a manifest that
      declares a Message projection nothing can reach is exactly what the gap
      was.
    */
    const resolved = await resolveForeignEvent(message.id, ((filters) => relay.query(filters as never)) as QueryFn)
    check(
      '  …and resolveForeignEvent reaches it from a bare event id',
      resolved !== null && resolved.eventId === message.id,
      resolved ? `ref ${resolved.ref.slice(0, 16)}…` : 'null',
    )
    check(
      '  …with no address and no naddr, which is the point',
      resolved?.address === undefined && resolved?.naddr === undefined,
    )
    check(
      '  …and a web link that opens it, from the nevent template',
      typeof resolved?.openUrl === 'string' && resolved.openUrl.includes('nevent1'),
      resolved?.openUrl ?? '(none)',
    )
  }

  {
    // Both entity types are declared. One `web` tag cannot serve both: a Topic
    // is addressable and a Message is not, so a consumer holding a message and
    // finding only an `naddr` template has nothing to substitute.
    const types = stored.tags.filter((t: string[]) => t[0] === 'web').map((t: string[]) => t[2])
    check('the manifest declares a web template per entity type', types.includes('naddr') && types.includes('nevent'), types.join(', '))
  }

  console.log(
    failures === 0
      ? `\nManifest published and satisfiable. Address: 31990:${identity.pubkey}:${MANIFEST_D_TAG}`
      : `\n${failures} check(s) FAILED.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
