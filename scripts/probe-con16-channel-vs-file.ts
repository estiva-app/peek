/**
 * Where is each topic's conversation actually readable — the channel, a file, or both?
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con16-channel-vs-file.ts
 *
 * Read-only. The migration project's brief sizes itself on the 202 messages
 * Convex holds alone. That is the gap *into Buzz*. It is not the gap *into the
 * product*: FOL-25 copied only some topics onto `30840` files, and FOL-26 +
 * FOL-25's delete mode retire the Topics view and then delete the channels the
 * rest still live in. This counts, per topic, how many published messages would
 * stop being readable anywhere a person can reach if its channel goes.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const FILTERS_PER_POST = 20

const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
}

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

async function sign(unsigned: UnsignedEvent, accessToken: string): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) {
    console.log(`⚠  /query ${res.status}: ${text.slice(0, 160)}`)
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

const tagOf = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)
const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()

  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})
  const uuids = topics.map((x) => x.channelUuid).filter((x): x is string => !!x)

  const metas = await query([{ kinds: [39000], '#d': uuids, limit: uuids.length }], t)
  const liveChannel = new Set(metas.map((e) => tagOf(e, 'd')?.[1]).filter((x): x is string => !!x))

  // Everything under the topic channels.
  const inChannels: SignedEvent[] = []
  for (const post of chunk(uuids.map((u) => ({ kinds: [9, 1111], '#h': [u], limit: 2000 })), FILTERS_PER_POST)) {
    inChannels.push(...(await query(post, t)))
  }
  const byChannel = new Map<string, SignedEvent[]>()
  for (const e of inChannels) {
    const h = tagOf(e, 'h')?.[1]
    if (!h) continue
    byChannel.set(h, [...(byChannel.get(h) ?? []), e])
  }

  // Everything on the five team Folders — where FOL-25 put the file copies.
  const onTeams: SignedEvent[] = []
  for (const [, id] of Object.entries(TEAMS)) {
    onTeams.push(...(await query([{ kinds: [9, 1111], '#h': [id], limit: 2000 }], t)))
  }
  // A copy names the event it copied in `orig`; map that back to a channel.
  const channelOfEvent = new Map<string, string>()
  for (const [h, es] of byChannel) for (const e of es) channelOfEvent.set(e.id, h)

  const copiesPerChannel = new Map<string, number>()
  let copiesUnmatched = 0
  for (const e of onTeams) {
    const orig = tagOf(e, 'orig')?.[1]
    if (!orig) continue
    const h = channelOfEvent.get(orig)
    if (!h) {
      copiesUnmatched += 1
      continue
    }
    copiesPerChannel.set(h, (copiesPerChannel.get(h) ?? 0) + 1)
  }

  // The bare files on the teams, so "has a file" is answerable per topic.
  const files = await query([{ kinds: [30840], limit: 500 }], t)
  const fileTitles = new Set(files.map((f) => (tagOf(f, 'title')?.[1] ?? '').trim().toLowerCase()))

  console.log(`\ntopics ${topics.length}, channels ${uuids.length}, live channels ${liveChannel.size}`)
  console.log(`relay: ${inChannels.length} events under channels, ${files.length} kind:30840 files\n`)
  console.log(
    'topic'.padEnd(46) + 'chan  onRelay  copies  file?  ORPHANED-IF-DELETED',
  )
  let orphanTotal = 0
  const rowsOut: Array<[string, number]> = []
  for (const tp of topics.slice().sort((a, b) => a.title.localeCompare(b.title))) {
    const h = tp.channelUuid
    const events = h ? (byChannel.get(h) ?? []) : []
    const copies = h ? (copiesPerChannel.get(h) ?? 0) : 0
    const hasFile = fileTitles.has(tp.title.trim().toLowerCase())
    const orphan = Math.max(0, events.length - copies)
    orphanTotal += orphan
    rowsOut.push([tp.title, orphan])
    console.log(
      tp.title.slice(0, 44).padEnd(46) +
        (h ? (liveChannel.has(h) ? 'live' : 'GONE') : '—').padEnd(6) +
        String(events.length).padStart(7) +
        String(copies).padStart(8) +
        (hasFile ? '  yes' : '   no').padStart(7) +
        String(orphan).padStart(21),
    )
  }
  console.log(`\ncopies whose orig is not under any topic channel: ${copiesUnmatched}`)
  console.log(
    `\nPublished messages readable ONLY under a topic channel (no file copy): ${orphanTotal}\n` +
      `These are already "in Buzz", so the census scores them 0 — but deleting the channel\n` +
      `(FOL-25 delete mode) or retiring the only view that reads them (FOL-26) loses them.\n`,
  )
  console.log('worst first:')
  for (const [title, n] of rowsOut.sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${title}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
