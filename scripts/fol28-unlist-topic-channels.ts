/**
 * Unlist the topic channels placed beside their projects and files — FOL-28.
 *
 * FOL-22 placed every topic channel in its team by `39000` address. FOL-25 then
 * turned the topics into files but could not delete the nine channels that hold
 * a project's issues (the record channels), and restored the nine that files
 * still draw their conversation from. So under a team, *Peek: Feedback & Bugs*
 * draws twice: the project row and the row of the channel that is its
 * conversation. A project's `h` is immutable, so nothing moves; the channel
 * simply stops being a row. One `kind:1852 remove` per team takes every
 * `39000:` address out of the team's state, and nothing is deleted.
 *
 *   cd ~/peek-fol28-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx -y tsx --tsconfig tsconfig.app.json scripts/fol28-unlist-topic-channels.ts plan
 *   npx -y tsx --tsconfig tsconfig.app.json scripts/fol28-unlist-topic-channels.ts apply
 *
 * `plan` is read-only: it reads each team's live `kind:30890` (never a
 * remembered list), names every `39000:` address it carries and says what hangs
 * off it. `apply` publishes one `remove` per team carrying exactly those
 * addresses, then re-reads the five states from the relay and reports whether a
 * `39000:` address is left and whether the project and file rows survived.
 */
import { authorizationHeaderFor, buildUnsignedAuthEvent, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, createProjectionCache, resolveFolderContents, type QueryFn } from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const WRITE_GAP_MS = 6_000

/** The five, by id — FOL-20, 2026-09-14. */
const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
}

const KIND_BARE_FILE = 30840
const KIND_PROJECT = 30850
const KIND_ISSUE = 30851
const KIND_CHANNEL = 39000
const KIND_FOLDER_COMMAND = 1852
const KIND_FOLDER_STATE = 30890

type Token = { accessToken: string; pubkey: string }

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
  // Hop 0: the ceiling moves and is never to be recalled.
  if (body.allowed_kinds && !body.allowed_kinds.includes(KIND_FOLDER_COMMAND)) {
    throw new Error(`this credential cannot sign kind:${KIND_FOLDER_COMMAND}; allowed_kinds ${JSON.stringify(body.allowed_kinds)}`)
  }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, t: Token, retried = false): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (res.status === 401 && !retried) {
    t.accessToken = (await token()).accessToken
    return sign(unsigned, t, true)
  }
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function bridge(path: '/query' | '/events', payload: unknown, t: Token): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

function queryFn(t: Token): QueryFn {
  return async (filters) => {
    const { status, text } = await bridge('/query', filters, t)
    if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

/** Publish one signed event; the relay refuses as 200 with `accepted: false`. */
async function publish(unsigned: UnsignedEvent, t: Token): Promise<{ ok: boolean; reason?: string; id: string }> {
  const signed = await sign(unsigned, t)
  const { status, text } = await bridge('/events', signed, t)
  let parsed: { accepted?: boolean; reason?: string; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  const ok = status === 200 && parsed.accepted !== false
  return { ok, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 120)}`), id: signed.id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const tags = (e: SignedEvent, name: string) => e.tags.filter((t) => t[0] === name).map((t) => t[1])
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-8)}`

type Channel = {
  address: string
  uuid: string
  name?: string
  /** What still draws its conversation from this channel — why it must not be deleted, and why it need not be a row. */
  issues: number
  /** `30840` files whose `a` tag names this channel. */
  files: string[]
}

type Plan = {
  team: string
  id: string
  hasState: boolean
  /** Every `a` on the live state, in the relay's order. */
  state: string[]
  /** The `39000:` addresses among them — what the `remove` carries. */
  channels: Channel[]
  /** What stays: `30850` projects and `30840` files. */
  keep: string[]
  /** An address that is none of the three — a shape this ticket did not expect. */
  other: string[]
}

/** The five live states, straight from the relay — never through a cache. */
async function readStates(query: QueryFn): Promise<Map<string, SignedEvent>> {
  const states = await query([{ kinds: [KIND_FOLDER_STATE], '#d': Object.values(TEAMS), limit: 50 }])
  return new Map(states.map((e) => [tag(e, 'd')!, e]))
}

async function plan(query: QueryFn): Promise<Plan[]> {
  const stateOf = await readStates(query)
  // The exact pre-state, on disk: a `remove` is reversed by an `add` of the same addresses.
  if (process.env.FOL28_DUMP) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.FOL28_DUMP, JSON.stringify([...stateOf.values()], null, 1))
    console.log(`pre-state written to ${process.env.FOL28_DUMP}`)
  }
  const out: Plan[] = []
  for (const [team, id] of Object.entries(TEAMS)) {
    const state = stateOf.get(id)
    const addresses = state ? tags(state, 'a') : []
    const channelAddresses = addresses.filter((a) => a.startsWith(`${KIND_CHANNEL}:`))
    const keep = addresses.filter((a) => a.startsWith(`${KIND_PROJECT}:`) || a.startsWith(`${KIND_BARE_FILE}:`))
    const other = addresses.filter((a) => !channelAddresses.includes(a) && !keep.includes(a))
    const channels: Channel[] = []
    if (channelAddresses.length) {
      const uuids = channelAddresses.map((a) => a.split(':')[2])
      const [meta, issues, files] = await Promise.all([
        query([{ kinds: [KIND_CHANNEL], '#d': uuids, limit: 100 }]),
        query([{ kinds: [KIND_ISSUE], '#h': uuids, limit: 500 }]),
        query([{ kinds: [KIND_BARE_FILE], '#a': channelAddresses, limit: 100 }]),
      ])
      // Newest kind:39000 per uuid — a rename (40003) is folded into a fresh one.
      const nameOf = new Map<string, string | undefined>()
      for (const e of [...meta].sort((x, y) => x.created_at - y.created_at)) nameOf.set(tag(e, 'd')!, tag(e, 'name'))
      for (const address of channelAddresses) {
        const uuid = address.split(':')[2]
        channels.push({
          address,
          uuid,
          name: nameOf.get(uuid),
          issues: issues.filter((e) => tag(e, 'h') === uuid).length,
          files: files.filter((e) => tags(e, 'a').includes(address)).map((e) => `${e.kind}:${e.pubkey}:${tag(e, 'd')}`),
        })
      }
    }
    out.push({ team, id, hasState: !!state, state: addresses, channels, keep, other })
  }
  return out
}

function print(p: Plan[]) {
  let total = 0
  for (const t of p) {
    total += t.channels.length
    console.log(`\n${t.team} ${t.id.slice(0, 8)}: ${t.hasState ? `state lists ${t.state.length}` : 'NO STATE'} — keep ${t.keep.length}, remove ${t.channels.length}${t.other.length ? `, OTHER ${t.other.length}` : ''}`)
    for (const c of t.channels) {
      const why = c.issues ? `record channel, ${c.issues} issues by h` : c.files.length ? `conversation of file ${c.files.map(short).join(', ')}` : 'NOTHING hangs off it'
      console.log(`    - ${short(c.address)}  "${c.name ?? '?'}"  ${why}`)
    }
    for (const o of t.other) console.log(`    ? ${short(o)}  not a project, file or channel`)
  }
  console.log(`\n${total} channel placements to remove across ${p.filter((t) => t.channels.length).length} teams`)
}

async function apply(p: Plan[], query: QueryFn, t: Token) {
  for (const team of p) {
    if (!team.hasState || team.channels.length === 0) {
      console.log(`${team.team}: nothing to do`)
      continue
    }
    const addresses = team.channels.map((c) => c.address)
    const unsigned: UnsignedEvent = {
      pubkey: t.pubkey,
      created_at: toNostrSeconds(Date.now()),
      kind: KIND_FOLDER_COMMAND,
      tags: [['h', team.id], ['op', 'remove'], ...addresses.map((a) => ['a', a])],
      content: '',
    }
    const result = await publish(unsigned, t)
    console.log(`${team.team}: 1852 remove ${addresses.length} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`} (${result.id.slice(0, 8)})`)
    await sleep(WRITE_GAP_MS)
  }
  await verify(query)
}

/** The done-when, read back from the relay: the raw states, then what the tree draws. */
async function verify(query: QueryFn) {
  console.log('\nre-read from the relay:')
  const stateOf = await readStates(query)
  const people = createPeopleCache().viaRelay(query)
  for (const [team, id] of Object.entries(TEAMS)) {
    const state = stateOf.get(id)
    const addresses = state ? tags(state, 'a') : []
    const left = addresses.filter((a) => a.startsWith(`${KIND_CHANNEL}:`))
    const contents = await resolveFolderContents(id, query, people, createProjectionCache())
    const drawn = contents.files.map((f) => f.address ?? f.ref)
    const dup = drawn.filter((a, i) => drawn.indexOf(a) !== i)
    const notProjectOrFile = drawn.filter((a) => !a.startsWith(`${KIND_PROJECT}:`) && !a.startsWith(`${KIND_BARE_FILE}:`))
    console.log(
      `  ${team}: state lists ${addresses.length}, 39000: left ${left.length}; tree draws ${drawn.length} (source ${contents.source})` +
        (dup.length ? `; DRAWN TWICE ${dup.map(short).join(', ')}` : '') +
        (notProjectOrFile.length ? `; NOT PROJECT/FILE ${notProjectOrFile.map(short).join(', ')}` : ''),
    )
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'verify') throw new Error('mode: plan | apply | verify')
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}`)
  if (mode === 'verify') return verify(query)
  const p = await plan(query)
  print(p)
  if (mode === 'apply') {
    console.log('')
    await apply(p, query, t)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
