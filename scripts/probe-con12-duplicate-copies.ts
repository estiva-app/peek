/**
 * CON-12: did the migration write the same Convex row twice?
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con12-duplicate-copies.ts
 *
 * Read-only. A second `migrate` run that should have been a no-op wrote 18 more
 * events, which means its `done` read did not see copies the first run had made.
 * `orig` names the Convex row a copy stands for, so a row with two marked copies
 * is a duplicate — the same message twice in one conversation.
 *
 * Counted by `#h` on the channel rather than through `fileConversation`, because
 * `fileConversation` is the thing under suspicion: it finds replies by `#e` on
 * the roots it already found, so a reply whose parent is an *original* `kind:9`
 * (not a copy) hangs off nothing it looked at and is invisible to it.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

const TEAMS = [
  '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  'fd03975a-eb00-49d6-a4b7-33ead1854672',
  '3167adea-877f-43c4-96fb-517a2b2d5d24',
  '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  '6f1b5cce-96ae-4817-bac2-89a1bd142576',
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

const tagOf = (e: SignedEvent, n: string) => e.tags.find((x) => x[0] === n)?.[1]
const marked = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === 'shr8-migrate')

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()

  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})
  const wheres = [...topics.map((x) => x.channelUuid).filter((x): x is string => !!x), ...TEAMS]

  const all: SignedEvent[] = []
  for (const h of wheres) all.push(...(await query([{ kinds: [1111], '#h': [h], limit: 2000 }], t)))

  const byId = new Map(all.map((e) => [e.id, e]))
  const copies = [...byId.values()].filter((e) => marked(e) && tagOf(e, 'orig'))

  const byOrig = new Map<string, SignedEvent[]>()
  for (const e of copies) {
    const o = tagOf(e, 'orig')!
    byOrig.set(o, [...(byOrig.get(o) ?? []), e])
  }

  const dupes = [...byOrig.entries()].filter(([, es]) => es.length > 1)
  console.log(`\nmarked copies on the relay: ${copies.length}`)
  console.log(`distinct Convex rows they stand for: ${byOrig.size}`)
  console.log(`rows carrying MORE THAN ONE copy: ${dupes.length}`)

  if (!dupes.length) {
    console.log('\nNo duplicates. The second run wrote rows the first genuinely had not.')
    return
  }
  console.log(`\nduplicated rows (orig → the copies standing for it):`)
  for (const [orig, es] of dupes.slice(0, 30)) {
    console.log(`  ${orig.slice(0, 14)}…  ${es.length} copies`)
    for (const e of es.sort((a, b) => a.created_at - b.created_at)) {
      const parent = tagOf(e, 'e')
      console.log(
        `      ${e.id.slice(0, 10)}… by ${e.pubkey.slice(0, 8)}… h=${(tagOf(e, 'h') ?? '').slice(0, 8)} ` +
          `parent=${parent ? parent.slice(0, 10) + '…' : 'root'} content="${e.content.slice(0, 40).replace(/\n/g, ' ')}"`,
      )
    }
  }
  console.log(`\n${dupes.reduce((n, [, es]) => n + es.length - 1, 0)} event(s) are surplus and want retracting (kind:5).`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
