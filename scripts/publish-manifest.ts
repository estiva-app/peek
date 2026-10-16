/**
 * Publish Peek's NIP-89 manifest, then read it back and check it (PRO-6).
 *
 *   APP_URL=https://peek.estiva.app/ RELAY_URL=https://estiva.estiva.app \
 *     npx tsx --tsconfig tsconfig.app.json scripts/publish-manifest.ts
 *
 * `--tsconfig tsconfig.app.json` because the manifest imports through the
 * app's `@/` alias, which only that file declares; without it tsx stops at
 * `Cannot find package '@/lib'`.
 *
 * Modelled on Ship's script of the same name, and for the same reason: the
 * check worth having is not "did it publish" but **"can a consumer satisfy
 * what it declares"**. A manifest naming a tag no event carries is valid JSON,
 * publishes fine, and fails days later in somebody else's app as an empty
 * widget.
 *
 * ## The identity, and where it lives
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
 * like something else from the layer above.
 *
 * **This has since been granted and run.** The header used to end "which is why
 * this script exists complete and unrun", and that stopped being true once
 * Peek's manifest reached production — `31990:<pubkey>:estiva-peek` is live.
 * Corrected because the note reads as "do not bother running this", which is
 * the opposite of what somebody republishing a changed declaration needs to
 * know.
 *
 * ## It claims no kind (REC-1)
 *
 * It claimed a Folder (`39000`) and a chat message (`9`) by `k` tags, and a
 * consumer found it with a `#k` query. Both belong to the protocol now
 * (interop 0.58), so it has no `k` tag at all: a consumer finds Peek as the
 * app declaring the `conversation` aspect, by sweeping every manifest, and
 * that is what this checks after publishing. **Publish it only once Ship,
 * Leaf, Peek and the agent all run interop 0.58 or later**: an older runtime
 * finds a Folder and a message by the claims, and draws nothing once they go.
 *
 * ## A dry run
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/publish-manifest.ts --dry-run
 *
 * runs every check made before signing and prints the event it would publish
 * — unsigned, with the key's pubkey if `.manifest-key` exists — and stops. It
 * signs nothing, connects to no relay and writes no key.
 *
 * The key is a gitignored `.manifest-key` beside this script, generated on
 * first run and then registered as a relay member. **It is not in the
 * repository and not in any worktree but the one it was made in**, so a run
 * from a fresh clone or a `git worktree` will generate a *new* key, publish a
 * second manifest under a different pubkey, and leave two claiming Peek's
 * kinds — which SPEC §7.3 has no way to rank. Copy the existing key in, or run
 * from the checkout that holds it.
 *
 * It takes a signer rather than reading a key file so that whichever identity
 * is granted can be handed in without editing this.
 */
import { KIND, Relay, signEvent, publicKeyFromSecret, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { MANIFEST_D_TAG, MESSAGE_KIND, TOPIC_KIND, manifestContent } from '../src/nostr/manifest'
import {
  KIND_BARE_FILE,
  widgetChainProblem,
  actionProblems,
  resolveForeignEvent,
  resolveForeignObject,
  type QueryFn,
} from '@estiva-app/interop'

const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:3000'
const KEY_FILE = new URL('../.manifest-key', import.meta.url).pathname
const DRY_RUN = process.argv.includes('--dry-run')
/** The first interop with a Folder and a message built in — what every consumer must run before this publishes. */
const BUILT_INS_SINCE = [0, 58]
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
        `     APP_URL=https://peek.estiva.app/ RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/publish-manifest.ts\n`,
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

/** The pubkey a dry run prints: the key's, when there is one — and no key is ever made for it. */
function dryRunPubkey(): string {
  const secretKeyHex = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : ''
  return /^[0-9a-f]{64}$/.test(secretKeyHex) ? publicKeyFromSecret(secretKeyHex) : '0'.repeat(64)
}

/**
 * Whether this checkout's interop draws a Folder and a message itself (0.58+).
 *
 * Only this checkout's: Ship's, Leaf's and the agent's are not visible from
 * here, so the header's order still has to be kept by whoever runs this. It
 * catches the case nothing else would, a republish from a checkout that would
 * itself draw nothing afterwards.
 */
function interopHasBuiltIns(): { ok: boolean; version: string } {
  const path = new URL('../node_modules/@estiva-app/interop/package.json', import.meta.url).pathname
  const version = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version : '0.0.0'
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return { ok: major > BUILT_INS_SINCE[0] || (major === BUILT_INS_SINCE[0] && minor >= BUILT_INS_SINCE[1]), version }
}

function buildManifest(pubkey: string, createdAtMs: number, appUrl: string): UnsignedEvent {
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: 31990,
    tags: [
      ['d', MANIFEST_D_TAG],
      // No `k` tag: Peek claims no kind (REC-1). It is found by its aspect.
      // NIP-89's `web` tag. `<bech32>` is substituted by the consumer with the
      // entity it holds. A file or a Folder is addressable so an naddr
      // resolves; a message is not, which is recorded on the check below rather
      // than papered over.
      /*
        One `web` tag per NIP-19 entity type, because what Peek opens comes in
        two shapes and they are not interchangeable — and both stay now that
        Peek owns neither: they are where every app opens what the conversation
        aspect is for (SPEC §7.8 says the app declaring it MUST publish both).

        A file and a Folder are addressable — a Folder is the relay's
        `kind:39000`, whose `d` is the channel uuid — so `naddr` names them. A
        Message is a `kind:9` with no `d` at all, so **nothing but its event id
        can name it** and `nevent` is the only form that works. Declaring only
        the first is what PRO-11 found: a consumer rendering a message had no
        way to offer "open this in Peek", and `<bech32>` had nothing to
        substitute.

        Both point at the same route. It resolves the reference and then decides
        which surface to show, the way Ship's `#/o/` does — the entity type
        tells the *consumer* what it is holding, not the app what to do.
      */
      /*
        A path, not a hash. The hash form was published before Peek had any
        routing at all, so it advertised `#/o/<bech32>` to every consumer in the
        ecosystem while the app served nothing of the sort — the link opened
        Peek, the hash was ignored, and the person landed on their desk with
        nothing to say it had failed (PRO-11).

        `/o/:ref` exists now and resolves both entity types to the topic that
        holds them. Peek is served with an index.html fallback, so a deep path
        survives a cold load; Ship's manifest uses a hash for the opposite
        reason, its nginx has `try_files … =404` with no rewrite.
      */
      ['web', `${appUrl.replace(/\/+$/, '')}/o/<bech32>`, 'naddr'],
      ['web', `${appUrl.replace(/\/+$/, '')}/o/<bech32>`, 'nevent'],
      /*
        RFC 0.5 §7.5's `urls` — the inbound half, so a Peek link pasted into
        another app renders as the object rather than as a blue link.

        `web` is outbound and stays bech32: it is handed to NIP-19 machinery
        rather than pasted by a person. These are what a person copies, so they
        carry the identity unencoded — §7.3's objection to bech32 is about URLs.

        Two identities, and the placeholder says which: `<d>` is a topic's
        channel uuid, resolved with `#d`; `<id>` is a message's event id,
        resolved with `ids`, because a kind:9 has no `d` at all (§7.6).

        Since FOL-37 the short `/topic/` form is a bare file's — a topic in a
        Folder, `kind:30840` — and the Convex channel topics are at
        `/topic-old/`. Peek does not own `30840` (no `k` tag for it, and the
        consumer's `urls` reader needs none), but it is where such a file's
        conversation is read, so a pasted link to one resolves through this.

        A thread is the topic's URL with `?thread=<id>` — the root comment's
        event id — and the link is about the comment, not the topic (FOL-38).
        Declared as its own shape beside the topic's: `matchObjectUrl` prefers
        the pattern whose query the URL satisfies, so the same path with no
        `?thread=` still resolves to the file. Nobody owns `kind:1111` either;
        interop's built-in manifest draws a comment as it draws a message,
        which is why the kind is named here and not in `k`.

        The last two are the same case since REC-1: a shape names the kind a
        Peek URL points at, and claims nothing. A message (`/message/<id>`,
        which Peek writes into its own links) and an old topic's channel
        (`/topic-old/`) are no app's kinds any more, and a pasted Peek link to
        either still resolves only because these say which kind it names —
        drop them and it stays a plain link in every app.
      */
      ['urls', `${appUrl.replace(/\/+$/, '')}/topic/<slug>-<d>`, String(KIND_BARE_FILE)],
      ['urls', `${appUrl.replace(/\/+$/, '')}/topic/<slug>-<d>?thread=<id>`, String(KIND.COMMENT)],
      ['urls', `${appUrl.replace(/\/+$/, '')}/topic-old/<slug>-<d>`, String(TOPIC_KIND)],
      ['urls', `${appUrl.replace(/\/+$/, '')}/message/<id>`, String(MESSAGE_KIND)],
    ],
    content: JSON.stringify(manifestContent()),
  }
}

async function main() {
  console.log(`relay    ${RELAY_URL}${DRY_RUN ? '  (dry run: not contacted)' : ''}`)
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

  /*
    Every action is one a caller could actually pick — checked before signing,
    PRO-16, and INT-9's own watch list said nothing did this yet.

    Peek became a producer of actions in INT-9, and a producer's mistakes here
    are the ones no consumer can report at the moment they matter: a
    description that restates its label is accepted by `resolveManifest`,
    rendered by every consumer, and quietly never chosen by a caller matching
    on prose (INT-5). An absent `effect` reads as *unknown* in both directions,
    so a consumer offering only safe actions will not offer it and one avoiding
    destructive actions may.

    Refused rather than warned, for the same reason the widget check above is:
    `kind:31990` is replaceable, but every consumer that fetched the bad one
    holds it until it refetches. This is the one moment the mistake is cheap.
  */
  {
    const declared = manifestContent().actions ?? []
    const problems = declared.flatMap((action) =>
      actionProblems(action).map((problem) => `  ${problem}`),
    )
    if (problems.length > 0) {
      console.error(`\n✋ Refusing to publish. ${problems.length} problem(s) with the actions:\n`)
      console.error(problems.join('\n') + '\n')
      process.exit(1)
    }
    check(
      'every declared action is one a caller could pick',
      true,
      declared.length === 0 ? 'none declared' : declared.map((a) => a.id).join(', '),
    )
  }

  // Every consumer must draw a Folder and a message itself before this goes (REC-1); this checkout at least.
  const interop = interopHasBuiltIns()
  if (DRY_RUN) {
    check('this checkout’s interop draws a Folder and a message itself', interop.ok, `@estiva-app/interop ${interop.version}`)
    const event = buildManifest(dryRunPubkey(), Date.now(), APP_URL)
    console.log('\nThe event a publish would sign and send — unsigned, and not sent:\n')
    console.log(JSON.stringify(event, null, 2))
    console.log(failures === 0 ? '\nDry run: nothing signed, nothing sent.' : `\nDry run: ${failures} check(s) FAILED; nothing signed, nothing sent.`)
    process.exit(failures === 0 ? 0 : 1)
  }
  if (!interop.ok) {
    console.error(
      `\n✋ Refusing to publish. @estiva-app/interop ${interop.version} finds a Folder and a message by Peek's claims,\n` +
        `   which this manifest drops: run it from a checkout on 0.58 or later, once every app runs one.\n`,
    )
    process.exit(1)
  }

  const identity = manifestIdentity()
  const signer = { pubkey: identity.pubkey, sign: async (e: UnsignedEvent) => signEvent(e, identity.secretKeyHex) }
  const relay = new Relay(RELAY_URL, signer as never)
  console.log(`manifest ${identity.pubkey.slice(0, 16)}…  (31990:<pubkey>:${MANIFEST_D_TAG})\n`)

  const event = buildManifest(identity.pubkey, Date.now(), APP_URL)
  const published = await relay.publish(signEvent(event, identity.secretKeyHex))
  check('the relay accepts kind:31990', published.ok, published.reason ?? '')
  if (!published.ok) process.exit(1)

  // ── Discovery: the check PRO-6's done-when names ──────────────────────────
  /*
    A consumer will not know Peek's pubkey. It used to hold an object of one of
    Peek's kinds and ask "who handles this?" with a `#k` filter; Peek has no
    kind now (REC-1), so a consumer holding a file, a Folder or a message nobody
    owns asks "who opens conversations?" — every manifest, newest first, the
    first declaring the `conversation` aspect with somewhere to link to
    (interop's `resolveAspectApp`, 50 manifests). That one must be this one.
  */
  {
    const handlers = await relay.query([{ kinds: [31990], limit: 50 }])
    const opener = [...handlers]
      .sort((a: SignedEvent, b: SignedEvent) => b.created_at - a.created_at)
      .find((e: SignedEvent) => {
        try {
          return (JSON.parse(e.content) as { aspect?: string }).aspect === 'conversation' && e.tags.some((t) => t[0] === 'web')
        } catch {
          return false
        }
      })
    check(
      'a consumer looking for the app that opens conversations finds this one',
      opener?.pubkey === identity.pubkey,
      opener ? `31990:${opener.pubkey.slice(0, 16)}…:${opener.tags.find((t) => t[0] === 'd')?.[1] ?? ''}` : 'none found',
    )
  }

  const [stored] = await relay.query([
    { kinds: [31990], authors: [identity.pubkey], '#d': [MANIFEST_D_TAG], limit: 1 },
  ])
  check('the manifest reads back', !!stored)
  if (!stored) process.exit(1)

  const query = ((filters) => relay.query(filters as never)) as QueryFn

  // ── Do a Folder and a message, which Peek no longer draws, open here? ──────
  /*
    The projection checks that stood here went with the projections (REC-1): a
    Folder's name, one-liner and contents and a message's author and text are
    the runtime's to draw now (interop 0.58). What this manifest still decides
    is where they open, so that is what is checked, on a real one of each.
  */
  const [folder] = await relay.query([{ kinds: [TOPIC_KIND], limit: 1 }])
  check('there is a real Folder to open', !!folder)
  if (folder) {
    const address = `${TOPIC_KIND}:${folder.pubkey}:${folder.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? ''}`
    const resolved = await resolveForeignObject(address, query)
    check('  …it resolves through the built-in, as a folder', resolved?.noun === 'folder', resolved?.noun ?? 'null')
    check(
      '  …and opens here, from the naddr template',
      typeof resolved?.openUrl === 'string' && resolved.openUrl.includes('naddr1'),
      resolved?.openUrl ?? '(none)',
    )
  }

  const [message] = await relay.query([{ kinds: [MESSAGE_KIND], limit: 1 }])
  check('there is a real message to open', !!message)
  if (message) {
    check(
      '  a message carries no `d`, so it is NOT addressable — resolved by id instead',
      !message.tags.some((t: string[]) => t[0] === 'd'),
      'recorded, not a failure',
    )

    /*
      The message actually resolves by id, and opens here — PRO-11, REC-1.

      Peek no longer declares how a message draws: the runtime does (interop
      0.58, SPEC §7.8), and takes only where to open it from this manifest's
      `nevent` template. So the check is the resolve through the built-in, and
      its link — what a Ship issue's "Message" chip opens.
    */
    const resolved = await resolveForeignEvent(message.id, query)
    check(
      '  …and resolveForeignEvent reaches it from a bare event id',
      resolved !== null && resolved.eventId === message.id,
      resolved ? `ref ${resolved.ref.slice(0, 16)}…` : 'null',
    )
    check(
      '  …with no address and no naddr, which is the point',
      resolved?.address === undefined && resolved?.naddr === undefined,
    )
    // What a Ship issue's chip for it reads: "Message", from the built-in's noun.
    check('  …as a message', resolved?.noun === 'message', resolved?.noun ?? '(none)')
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

  {
    /*
      The aspect, read back the way a consumer reads it (FOL-17). Checked
      against the *stored* event and by name, because this is the field that
      makes a bare file's card a link in Ship, and interop 0.20.0 finds it by
      sweeping every manifest for `aspect: "conversation"` — a typo here is
      found by nobody until somebody clicks a card that is not one.
    */
    const content = JSON.parse(stored.content) as { aspect?: string; fileNoun?: string }
    check('the manifest declares the conversation aspect', content.aspect === 'conversation', content.aspect ?? '(none)')
    // PRO-24: what Ship's chip for a topic reads, so the same kind of typo is found here.
    check('the manifest calls a bare file a topic', content.fileNoun === 'topic', content.fileNoun ?? '(none)')
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
