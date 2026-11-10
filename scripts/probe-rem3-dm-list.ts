/**
 * REM-3: what the relay answers for "my DM channels" and "who is in the
 * workspace" — the two reads that replace `dmConversations` and `people.list`.
 *
 * Read-only, against production. Without `--as` it reads as the agent's own
 * service identity, which is in no DM: the control. With `--as <file>` it reads
 * as a person — the file is a signed-in Peek tab's
 * `sessionStorage.getItem('peek.estivaId.token')`, kept outside every repository.
 *
 *   cd ~/estiva-agent-main && set -a && . ~/.estiva-agent.env && set +a && cd -
 *   node scripts/run-in-vite.mjs scripts/probe-rem3-dm-list.ts [--as /path/to/token.json] [--profiles]
 *
 * What to look at:
 * - `39000 #p=me` against `39000 #t=dm`: a DM whose `39000` predates the relay
 *   putting `p` tags on it is only in the second, and its partner then has to
 *   come from its `39002`.
 * - The roster (`13534`) against the profiles (`kind:0`): who People would list.
 * - With `--as`: the person's star and open-work blobs, and how many of their
 *   people move to a pubkey or are dropped when the app first republishes them.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { SignedEvent } from '@estiva-app/protocol'
import { STARS_D_TAG, parseStarsBlob } from '../src/nostr/stars'
import { OPEN_WORK_D_TAG, parseOpenWorkBlob } from '../src/nostr/openWork'
import { dmChannelsOf } from '../src/nostr/dms'
import { workspacePeopleOf } from '../src/nostr/workspacePeople'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
/** The agent's own relay client — see `dms4-live-check.ts` for why not a hand-rolled one. */
const AGENT_DIR = process.env.ESTIVA_AGENT_DIR ?? join(homedir(), 'estiva-agent-main')
interface AgentClient {
  loadCredentials(): { base: string; clientId: string }
  clientCredentialsToken(credentials: unknown): Promise<{ pubkey: string; access_token: string }>
  estivaIdSigner(options: { base: string; pubkey: string; token: string }): unknown
  Relay: new (url: string, signer: unknown) => { query(filters: Record<string, unknown>[]): Promise<SignedEvent[]> }
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
const tags = (event: SignedEvent, name: string) => event.tags.filter((t) => t[0] === name).map((t) => t[1])
const short = (key: string | undefined) => (key ? `${key.slice(0, 8)}…` : '(none)')

function personToken(path: string): { pubkey: string; access_token: string } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { pubkey?: string; accessToken?: string; expiresAt?: number }
  if (!raw.pubkey || !raw.accessToken) throw new Error(`${path} is not a Peek token`)
  if (raw.expiresAt && raw.expiresAt < Date.now()) throw new Error('the token has expired — copy a fresh one')
  return { pubkey: raw.pubkey, access_token: raw.accessToken }
}

async function main() {
  const { loadCredentials, clientCredentialsToken, estivaIdSigner, Relay } = await agentClient()
  const credentials = loadCredentials()
  const as = arg('as')
  const token = as ? personToken(as) : await clientCredentialsToken(credentials)
  const relay = new Relay(RELAY_URL, estivaIdSigner({ base: credentials.base, pubkey: token.pubkey, token: token.access_token }))
  const me = token.pubkey
  const query = async (label: string, filters: Record<string, unknown>[]) => {
    try {
      return await relay.query(filters)
    } catch (error) {
      console.log(`  ${label}: REFUSED — ${(error as Error).message.slice(0, 160)}`)
      return null
    }
  }
  console.log(`relay ${RELAY_URL}, as ${me}${as ? ' (a person)' : ' (the agent — the control)'}  ${new Date().toISOString()}\n`)

  const roster = await query('13534', [{ kinds: [13534], limit: 5 }])
  const newest = roster?.sort((a, b) => b.created_at - a.created_at)[0]
  const members = newest ? tags(newest, 'member').concat(tags(newest, 'p')) : []
  console.log(`13534 roster: ${roster?.length ?? '-'} events; newest ${newest ? new Date(newest.created_at * 1000).toISOString() : '-'} by ${short(newest?.pubkey)}, ${members.length} members`)
  if (newest) console.log(`  tag names: ${[...new Set(newest.tags.map((t) => t[0]))].join(',')}`)

  const profiles = (await query('kind:0', [{ kinds: [0], limit: 500 }])) ?? []
  const named = new Map(profiles.map((p) => [p.pubkey, (JSON.parse(p.content || '{}') as { display_name?: string; name?: string })]))
  console.log(`kind:0 profiles: ${profiles.length}; roster members with a profile: ${members.filter((m) => named.has(m)).length}`)
  for (const m of members) console.log(`  member ${short(m)}  ${named.get(m)?.display_name ?? named.get(m)?.name ?? '(no kind:0)'}${m === me ? '  ← me' : ''}`)
  // `--profiles`: every kind:0 verbatim, to see what marks an agent (NIP-24 `bot`?).
  if (process.argv.includes('--profiles')) {
    for (const p of profiles) console.log(`  kind:0 ${short(p.pubkey)} tags=${JSON.stringify(p.tags)} ${p.content.slice(0, 300)}`)
  }
  const off = profiles.filter((p) => !members.includes(p.pubkey))
  console.log(`  profiles NOT on the roster: ${off.length}${off.length ? ' — ' + off.slice(0, 12).map((p) => named.get(p.pubkey)?.display_name ?? named.get(p.pubkey)?.name ?? short(p.pubkey)).join(', ') : ''}`)

  console.log()
  const byP = (await query('39000 #p', [{ kinds: [39000], '#p': [me], limit: 500 }])) ?? []
  const byT = (await query('39000 #t=dm', [{ kinds: [39000], '#t': ['dm'], limit: 500 }])) ?? []
  const members39002 = (await query('39002 #p', [{ kinds: [39002], '#p': [me], limit: 1000 }])) ?? []
  console.log(`39000 #p=me: ${byP.length} (t=dm: ${byP.filter((e) => tags(e, 't').includes('dm')).length})   39000 #t=dm: ${byT.length}   39002 #p=me: ${members39002.length}`)
  const dms = new Map<string, SignedEvent>()
  for (const e of [...byP, ...byT]) if (tags(e, 't').includes('dm')) dms.set(tags(e, 'd')[0] ?? '', e)
  for (const [uuid, e] of dms) {
    const partners = tags(e, 'p').filter((p) => p !== me)
    const roster39002 = members39002.find((m) => tags(m, 'd')[0] === uuid)
    const partners39002 = roster39002 ? tags(roster39002, 'p').filter((p) => p !== me) : []
    console.log(
      `  dm ${uuid}  inByP=${byP.some((x) => x.id === e.id)} inByT=${byT.some((x) => x.id === e.id)}  39000 partners=[${partners.map(short).join(',')}]  39002 partners=[${partners39002.map(short).join(',')}]  archived=${e.tags.some((t) => t[0] === 'archived')}  ${new Date(e.created_at * 1000).toISOString()}`,
    )
  }

  // What the app itself makes of those answers — its own folds, not this file's.
  const appDms = dmChannelsOf([...byP, ...byT], me, members39002)
  const appPeople = workspacePeopleOf([...(roster ?? []), ...profiles], me, [...appDms.keys()])
  console.log(`\napp: dmChannelsOf → ${[...appDms].map(([p, c]) => `${short(p)}=${c.slice(0, 8)}`).join(', ') || '(none)'}`)
  console.log(`app: People would list ${appPeople.length}: ${appPeople.map((p) => p.name).join(', ')}`)

  /*
    The person's own blobs, which only they can decrypt: what REM-3's move to
    pubkey keys does to their starred and open-work people. Read-only — the
    app is what republishes. `moves` have a pubkey beside the old key; `drops`
    have none and are deleted on the app's next publish.
  */
  if (as) {
    console.log()
    const idOrigin = (process.env.ESTIVA_ID_URL ?? credentials.base).replace(/\/+$/, '')
    for (const [label, d, parse] of [
      ['stars', STARS_D_TAG, (text: string) => parseStarsBlob(text).people],
      ['open work', OPEN_WORK_D_TAG, (text: string) => parseOpenWorkBlob(text).entries.filter((e) => e.kind === 'dm')],
    ] as const) {
      const events = (await query(label, [{ kinds: [30078], authors: [me], '#d': [d] }])) ?? []
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
      if (!newest) {
        console.log(`${label}: no blob`)
        continue
      }
      const res = await fetch(`${idOrigin}/nip44/decrypt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token.access_token}` },
        body: JSON.stringify({ ciphertext: newest.content }),
      })
      if (!res.ok) {
        console.log(`${label}: decrypt refused ${res.status} ${(await res.text()).slice(0, 120)}`)
        continue
      }
      const people = parse(((await res.json()) as { plaintext: string }).plaintext) as { key: string; pubkey?: string }[]
      const isKey = (k: string | undefined) => !!k && /^[0-9a-f]{64}$/.test(k)
      const already = people.filter((p) => isKey(p.key)).length
      const moves = people.filter((p) => !isKey(p.key) && isKey(p.pubkey)).length
      const drops = people.filter((p) => !isKey(p.key) && !isKey(p.pubkey))
      console.log(`${label}: ${people.length} people — ${already} already pubkeys, ${moves} move, ${drops.length} drop${drops.length ? ` (${drops.map((p) => p.key).join(', ')})` : ''}`)
    }
  }
}

export default main
