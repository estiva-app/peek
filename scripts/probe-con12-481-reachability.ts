/**
 * CON-12: are the 481 reachable from anything but the Topics view?
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con12-481-reachability.ts
 *
 * Read-only. The ticket says the 481 need "one signed-in click" because the
 * argument could go either way: an issue's comments render inside its project's
 * conversation and the project's Folder *is* one of these channels, so maybe
 * the old `kind:9` render there too.
 *
 * A click is the right test of *rendering*. It is not the right test of
 * *retrievability*, and retrievability is decidable from here: a view can only
 * draw what a filter returns. So this asks the relay the two questions the
 * product asks, per channel, and reports what each returns.
 *
 *  1. **The typed-object conversation.** `resolveForeignObject` reads a Ship
 *     project's conversation as `{ kinds: commentKindsOf(manifest), '#a':
 *     [address] }` (interop `projection.js:1719`) — by the *address*, never by
 *     the Folder. A `kind:9` written into the channel by Peek's topic view
 *     carries `h` and, per CON-14, may or may not carry an `a`. Whether it
 *     carries one naming *this project* is the whole question.
 *
 *  2. **The channel read.** `src/nostr/sync.ts` reads `{ kinds: [9, 1111, …],
 *     '#h': [channelUuid] }` — which does find them, and is exactly the reader
 *     FOL-26 retires. It is here as the positive control: if this returns 0 too
 *     the probe is broken, not the product.
 *
 * Between them: if (1) returns ~0 where (2) returns ~88, no click is needed —
 * nothing renders what a query never returns, and the 481 need a copy on a
 * `30840` for the same reason the 26 do.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

/** The nine the ticket names, by the Convex topic title that owns the channel. */
const RECORD_CHANNELS = [
  'Feedback on Peek',
  'Claude on Estiva / Estiva Steer',
  'Project: Shared foundation packages',
  'Project: Cross-app read state',
  'Project: Rewrite Ship with shared foundation',
  "Project: Peek's Intelligence",
  'Project: Catch up the Buzz fork',
  'Project: DMs on Nostr (DM channels)',
  'Feedback on Ship',
]

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) {
    console.log(`⚠  /query ${res.status}: ${text.slice(0, 200)}`)
    return []
  }
  try {
    return JSON.parse(text) as SignedEvent[]
  } catch {
    return []
  }
}

async function convex<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (body.status === 'error') throw new Error(`${path}: ${body.errorMessage}`)
  return (body.value ?? body) as T
}

const tagsNamed = (e: SignedEvent, name: string) => e.tags.filter((x) => x[0] === name).map((x) => x[1])

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()

  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})
  const byTitle = new Map(topics.map((x) => [x.title, x]))

  // Every Ship project, so a channel can be matched to the record that lives in
  // it. A project's own Folder is its `contentFolder`; what the relay can be
  // asked directly is which 30850 carries which `h`.
  const projects = await query([{ kinds: [30850], limit: 500 }], t)
  const projectByFolder = new Map<string, SignedEvent>()
  for (const p of projects) {
    // Two generations of the kind, and they name their channel differently:
    // the older records carry `[d, name, description, buzz-channel]` and the
    // newer ones `[d, title, h]`. Reading only `h` finds five of the nine and
    // makes the other four look like channels no project claims.
    const h = tagsNamed(p, 'h')[0] ?? tagsNamed(p, 'buzz-channel')[0]
    if (h) projectByFolder.set(h, p)
  }
  const titleOf = (p: SignedEvent) => tagsNamed(p, 'title')[0] ?? tagsNamed(p, 'name')[0] ?? '?'

  console.log(`\n${projects.length} kind:30850 projects on ${RELAY_URL}\n`)
  console.log(
    'topic'.padEnd(46) + 'chan'.padEnd(10) + 'by #h'.padStart(7) + 'k9'.padStart(5) + 'ORPHAN'.padStart(8) + "  by the project's #a",
  )

  const perChannelOrphans = new Map<string, number>()
  let totalChannel = 0
  let totalByAddress = 0
  let totalWithMatchingA = 0

  for (const title of RECORD_CHANNELS) {
    const topic = byTitle.get(title)
    if (!topic?.channelUuid) {
      console.log(`${title.slice(0, 44).padEnd(46)}— no channel in Convex`)
      continue
    }
    const h = topic.channelUuid

    // (2) the positive control — the reader FOL-26 retires.
    const inChannel = await query([{ kinds: [9, 1111], '#h': [h], limit: 2000 }], t)
    const k9 = inChannel.filter((e) => e.kind === 9)
    totalChannel += inChannel.length

    const noAddr = inChannel.filter((e) => !tagsNamed(e, 'a').length && !tagsNamed(e, 'A').length).length
    const project = projectByFolder.get(h)
    if (!project) {
      perChannelOrphans.set(title, noAddr)
      console.log(
        `${title.slice(0, 44).padEnd(46)}${h.slice(0, 8).padEnd(10)}${String(inChannel.length).padStart(7)}${String(k9.length).padStart(5)}${String(noAddr).padStart(8)}  no 30850 names this Folder`,
      )
      continue
    }
    const address = `30850:${project.pubkey}:${tagsNamed(project, 'd')[0]}`

    // (1) the question the product asks of a typed object.
    const byAddress = await query([{ kinds: [9, 1111], '#a': [address], limit: 2000 }], t)
    totalByAddress += byAddress.length
    // Of the channel's own kind:9, how many even carry an `a` naming it?
    const withMatchingA = k9.filter((e) => tagsNamed(e, 'a').includes(address)).length
    totalWithMatchingA += withMatchingA

    const orphans = inChannel.filter((e) => !tagsNamed(e, 'a').length && !tagsNamed(e, 'A').length)
    perChannelOrphans.set(title, orphans.length)
    console.log(
      `${title.slice(0, 44).padEnd(46)}${h.slice(0, 8).padEnd(10)}${String(inChannel.length).padStart(7)}${String(k9.length).padStart(5)}${String(orphans.length).padStart(8)}` +
        `  ${String(byAddress.length).padStart(4)} by #a on 30850:…:${(tagsNamed(project, 'd')[0] ?? '').slice(0, 8)} "${titleOf(project).slice(0, 28)}"`,
    )
  }

  // Five of the nine channels are named by no `30850`'s `h`, so the per-project
  // question cannot be asked of them. The general one can: **every** reader
  // that survives FOL-26 addresses a conversation by `a`/`A` — the typed-object
  // read above and the `30840` file read (`shr8-migrate.ts` fileConversation)
  // both do. So an event carrying no addressable tag at all is unreachable by
  // all of them, whatever object it might have belonged to.
  console.log(`\n— what the 481 are tagged with ——————————————`)
  const addressed = new Map<string, number>()
  let noAddress = 0
  const byKind = new Map<number, number>()
  for (const title of RECORD_CHANNELS) {
    const h = byTitle.get(title)?.channelUuid
    if (!h) continue
    for (const e of await query([{ kinds: [9, 1111], '#h': [h], limit: 2000 }], t)) {
      byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)
      const addrs = [...tagsNamed(e, 'a'), ...tagsNamed(e, 'A')]
      if (!addrs.length) {
        noAddress += 1
        continue
      }
      for (const a of addrs) addressed.set(a.split(':')[0]!, (addressed.get(a.split(':')[0]!) ?? 0) + 1)
    }
  }
  console.log(`by kind: ${[...byKind].map(([k, n]) => `kind:${k} ${n}`).join(', ')}`)
  console.log(`carrying no \`a\` and no \`A\` at all: ${noAddress}`)
  for (const [kind, n] of [...addressed].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  address of a kind:${kind}`)
  }
  console.log(`\nunaddressed, per channel — this, not 481, is what CON-12 owes:`)
  for (const [title, n] of [...perChannelOrphans].sort((a, b) => b[1] - a[1])) {
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${title}`)
  }

  console.log(`\n— totals ————————————————————————————————`)
  console.log(`under the channels, by #h (the reader FOL-26 retires): ${totalChannel}`)
  console.log(`under the projects, by #a (the reader that stays):     ${totalByAddress}`)
  console.log(`old kind:9 carrying an \`a\` that names their project:  ${totalWithMatchingA}`)
  const orphanTotal = [...perChannelOrphans.values()].reduce((a, b) => a + b, 0)
  console.log(
    `\nOf the ${totalChannel}, ${totalChannel - orphanTotal} carry an address — almost all of them a\n` +
      `kind:30851, i.e. they are Ship issue comments, which render in their issue's\n` +
      `conversation and are untouched by FOL-26. **${orphanTotal} carry no \`a\` and no \`A\`.**\n` +
      `Every reader that survives FOL-26 addresses a conversation by \`a\`/\`A\`, so no\n` +
      `filter any of them issues can return those ${orphanTotal} — which is decidable from here,\n` +
      `and is why the ticket's signed-in click can only confirm it, never overturn it.\n` +
      `\nSo CON-12 owes ${orphanTotal}, not ${totalChannel}, and the shape is the open question: a copy on a\n` +
      `new 30840 (splits the conversation — CON-4 NO_FILE_TARGET), or a 1111 addressed\n` +
      `to the channel's own Ship project, which every one of these channels has.`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
