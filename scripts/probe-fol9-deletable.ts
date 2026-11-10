/**
 * FOL-9: which Folders on production Peek would still offer Delete — read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol9-deletable.ts
 *
 * Runs the page's own check (`folderDeletableOf`) over every Folder the agent
 * can see, as the agent, and prints each answer. The page asks only about a
 * Folder with no state, so one with state is printed as a no without a read —
 * which is also what the check itself answers for it. Sends nothing.
 *
 * The agent is a relay steward, so "may the viewer send it" is a yes for it
 * wherever the rest is; for anybody else Delete appears on fewer Folders, never
 * more. The teams, QA and every Folder holding issues must be a no.
 */
import { authorizationHeaderFor, buildUnsignedAuthEvent } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { listFolders, type QueryFn } from '@estiva-app/interop'
import { folderDeletableOf } from '../src/nostr/folderDeletable'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** Reads between checks: the relay meters reads per minute. */
const READ_GAP_MS = 250

type Token = { accessToken: string; pubkey: string }

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
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

/** A refused read throws — a swallowed 403 would read as "0 events" and pass every check. */
function queryFn(t: Token): QueryFn {
  return async (filters) => {
    const url = `${RELAY_URL}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) }, body })
    const text = await res.text()
    if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const t = await token()
  const query = queryFn(t)
  const folders = await listFolders(query)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL}: ${folders.length} Folders\n`)
  const offered: string[] = []
  const reasons = new Map<string, number>()
  for (const f of folders) {
    let answer: { ok: true } | { ok: false; reason: string }
    if (f.hasState) answer = { ok: false, reason: 'has state (not asked)' }
    else {
      answer = await folderDeletableOf(query, f.id, t.pubkey)
      await sleep(READ_GAP_MS)
    }
    const why = answer.ok ? 'OFFERED' : answer.reason
    reasons.set(why, (reasons.get(why) ?? 0) + 1)
    if (answer.ok) offered.push(`${f.id} ${JSON.stringify(f.name ?? '')}`)
    if (process.argv.includes('--all') || answer.ok) console.log(`${answer.ok ? 'DELETE ' : 'no     '} ${f.id} ${JSON.stringify(f.name ?? '')}${answer.ok ? '' : ` — ${answer.reason}`}`)
  }
  console.log('\nby answer:')
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${why}`)
  console.log(`\n${offered.length} Folder(s) would offer Delete`)

  /*
    The control for the placement read: the check's `#a` filter must find the
    parent of a Folder `listFolders` says is placed, or its silence above means
    nothing — an unsupported filter answers exactly like "placed nowhere".
    Taken from a state's own `a` tag, not from `listedIn`, which also counts a
    record channel placed through its project.
  */
  const states = await query([{ kinds: [30890], limit: 500 }])
  const direct = states
    .flatMap((s) => s.tags.filter((t) => t[0] === 'a' && t[1]?.startsWith('39000:')).map((t) => ({ parent: s, address: t[1]! })))
    .find(({ parent, address }) => address.split(':')[2] !== parent.tags.find((t) => t[0] === 'd')?.[1])
  if (!direct) return console.log('control: no state lists a channel directly — nothing to test the placement read against')
  const parents = await query([{ kinds: [30890], authors: [direct.parent.pubkey], '#a': [direct.address], limit: 5 }])
  const good = parents.some((e) => e.id === direct.parent.id)
  console.log(`control: ${direct.address.slice(0, 24)}… is listed by one state — the #a read found ${parents.length} ${good ? '✓' : '✗ PLACEMENT READ IS BLIND'}`)
}

void main()
