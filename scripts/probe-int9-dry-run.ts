/**
 * The event a Start-a-conversation submit would publish, built and inspected
 * rather than published (INT-9).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/probe-int9-dry-run.ts
 *
 * A green suite and a green typecheck are both compatible with this being
 * broken against the real relay, because every fixture in the suite is one we
 * wrote. This runs the **declaration Peek is about to publish** through the
 * **runtime a consumer would use** against a **topic that actually exists**,
 * and prints the event that comes out.
 *
 * Read-only. It signs nothing and publishes nothing — `buildActionEvent`
 * returns an unsigned event or a refusal string, and that is where this stops.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { actionProblems, buildActionEvent, folderOf } from '@estiva-app/interop'
import { manifestContent, TOPIC_KIND } from '../src/nostr/manifest'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, accessToken: string): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function query(
  filters: Record<string, unknown>[],
  t: { accessToken: string; pubkey: string },
): Promise<SignedEvent[]> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]

async function main() {
  console.log(`relay ${RELAY_URL}\n`)
  const manifest = manifestContent()

  // ── 1. The producer check, before anything is signed (PRO-16) ────────────
  const declared = manifest.actions ?? []
  const problems = declared.flatMap((a) => actionProblems(a))
  check(
    'every declared action is one a caller could pick',
    problems.length === 0,
    problems.length ? problems.join(' | ') : declared.map((a) => a.id).join(', '),
  )

  const t = await token()
  console.log(`identity ${t.pubkey.slice(0, 16)}…\n`)

  // ── 2. A topic that actually exists on production ────────────────────────
  const topics = await query([{ kinds: [TOPIC_KIND], limit: 10 }], t)
  const topic = topics.find((e) => tag(e, 'd'))
  check('there is a real topic to act on', !!topic, topic ? tag(topic, 'name') : 'none')
  if (!topic) process.exit(1)

  const identifier = tag(topic, 'd')!
  const address = `${TOPIC_KIND}:${topic.pubkey}:${identifier}`

  /*
    The measurement this whole ticket turned on, re-taken on the object in
    hand rather than quoted from the earlier probe.
  */
  check(
    'the topic carries neither `h` nor `buzz-channel`',
    !tag(topic, 'h') && !tag(topic, 'buzz-channel'),
    JSON.stringify(topic.tags),
  )
  const folder = folderOf(topic)
  check(
    'interop resolves its Folder anyway, to its own `d`',
    folder === identifier,
    folder ?? 'null — a write has nowhere to go',
  )
  if (!folder) process.exit(1)

  // ── 3. The event a submit would publish ──────────────────────────────────
  const BODY = 'Does this land as a root in the right channel?'
  const built = buildActionEvent({
    manifest,
    kind: TOPIC_KIND,
    address,
    objectAuthor: topic.pubkey,
    folder,
    actionId: 'start-a-conversation',
    value: { message: BODY },
    // Supplied the way the launcher supplies it. A kind:9 is not addressable,
    // so the runtime must ignore it — which is the check below.
    newId: crypto.randomUUID(),
    pubkey: t.pubkey,
    createdAtMs: Date.now(),
  })

  if (typeof built === 'string') {
    check('the runtime builds the event', false, built)
    process.exit(1)
  }
  console.log(`\n   built: ${JSON.stringify({ kind: built.kind, tags: built.tags, content: built.content })}\n`)

  check('it is a kind:9 — a message, not a record', built.kind === 9, String(built.kind))
  check('the body is in `content`, which is what makes it a message', built.content === BODY)
  check(
    'it carries `h` naming the topic, which is how Peek finds it',
    tag(built, 'h') === identifier,
    tag(built, 'h') ?? '(none)',
  )
  check(
    'no `d` — a kind:9 is not addressable, so the supplied newId was ignored',
    !tag(built, 'd'),
    tag(built, 'd') ?? 'absent, correctly',
  )
  check(
    'no `a` tag — `toAddressOf` without a `setTag` writes no parent pointer',
    !tag(built, 'a'),
    tag(built, 'a') ?? 'absent, correctly',
  )
  check(
    'the body is not also a tag, which is the failure PRO-18 named',
    !built.tags.some((x) => x[0] === 'message'),
  )

  // ── 4. The negative controls ─────────────────────────────────────────────
  const undeclaredField = buildActionEvent({
    manifest,
    kind: TOPIC_KIND,
    address,
    objectAuthor: topic.pubkey,
    folder,
    actionId: 'start-a-conversation',
    value: { message: BODY, title: 'not a field' },
    pubkey: t.pubkey,
    createdAtMs: Date.now(),
  })
  check(
    'a field the manifest did not declare is refused, with a sentence',
    typeof undeclaredField === 'string',
    typeof undeclaredField === 'string' ? undeclaredField : 'BUILT — junk would reach a shared record',
  )

  const createTopic = buildActionEvent({
    manifest,
    kind: TOPIC_KIND,
    address,
    objectAuthor: topic.pubkey,
    folder,
    actionId: 'create-topic',
    value: { title: 'Blocked on FOL-2' },
    newId: crypto.randomUUID(),
    pubkey: t.pubkey,
    createdAtMs: Date.now(),
  })
  check(
    'Create a topic is still not offered — it creates a container (FOL-2)',
    typeof createTopic === 'string',
    typeof createTopic === 'string' ? createTopic : 'BUILT — it should not be declarable yet',
  )

  console.log(
    failures === 0
      ? '\nThe declaration is satisfiable against production. Nothing was published.'
      : `\n${failures} check(s) FAILED.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
