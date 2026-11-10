/**
 * Reconcile each team Folder's state with what is filed in it — PEE-31.
 *
 * A Folder with a `kind:30890` lists only what its state names, and two
 * writes of 2026-09-15 filed things into the teams without touching state:
 * the FOL-25 migration (a `kind:30840` per old topic, by `h`) and
 * `ship link-project` (a `kind:1851` on the project's `folder` field). Both
 * are visible by containment and invisible on the Folders page. This sends
 * one `kind:1852 add` per team carrying what is missing — and for a team with
 * no state yet, everything it holds by containment as well, because the first
 * command on a Folder emits state listing only what the command names.
 *
 * Two other things the same command fixes, because it is the same write:
 * a state with no `name` is given the channel's (`listFolders` reads the
 * state's name and stops, so a team named only on its `kind:39000` renders as
 * its uuid), and the containers PLACE names are placed under their team like
 * the nine placed by FOL-22.
 *
 *   cd ~/peek-fol25-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx -y tsx --tsconfig tsconfig.app.json scripts/fol25-reconcile-team-state.ts plan
 *   npx -y tsx --tsconfig tsconfig.app.json scripts/fol25-reconcile-team-state.ts apply
 *
 * `plan` is read-only. `apply` publishes, then re-resolves every team and
 * reports what the relay now lists.
 */
import { authorizationHeaderFor, buildEditChannelMetadata, buildUnsignedAuthEvent, toNostrSeconds } from '@estiva-app/protocol'
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

/**
 * Conversation containers that are nobody's file yet: a channel a project's
 * issues live in by `h`, listed at the top of the Folders page beside the
 * teams until it is placed. `Folders` is the Folders project's own record
 * channel, renamed by hand; it goes where the project went.
 */
const PLACE: Record<string, { into: string; name: string }> = {
  '85db5b59-9e49-4ea1-8e93-3d2a2d78c048': { into: 'Estiva HQ', name: 'Folders' },
}

const KIND_BARE_FILE = 30840
const KIND_PROJECT = 30850
const KIND_CHANGE = 1851
const KIND_CHANNEL = 39000
const KIND_FOLDER_COMMAND = 1852
const KIND_FOLDER_STATE = 30890

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
const addressOf = (e: SignedEvent) => `${e.kind}:${e.pubkey}:${tag(e, 'd') ?? ''}`

type Plan = {
  team: string
  id: string
  hasState: boolean
  stateName?: string
  channelName?: string
  /** What the Folder lists today — its state, or containment when it has none. */
  listed: string[]
  /** Files and projects filed here that the listing does not carry. */
  missing: { address: string; why: string }[]
  /** Containers placed here whose channel still wears a record name: `kind:40003` first. */
  renames: { id: string; from?: string; to: string }[]
}

async function plan(query: QueryFn): Promise<Plan[]> {
  const people = createPeopleCache().viaRelay(query)
  const cache = createProjectionCache()
  const ids = [...Object.values(TEAMS), ...Object.keys(PLACE)]
  const identity = await query([
    { kinds: [KIND_CHANNEL], '#d': ids, limit: 50 },
    { kinds: [KIND_FOLDER_STATE], '#d': ids, limit: 50 },
  ])
  const channelOf = new Map(identity.filter((e) => e.kind === KIND_CHANNEL).map((e) => [tag(e, 'd')!, e]))
  const stateOf = new Map(identity.filter((e) => e.kind === KIND_FOLDER_STATE).map((e) => [tag(e, 'd')!, e]))
  const out: Plan[] = []
  for (const [team, id] of Object.entries(TEAMS)) {
    const contents = await resolveFolderContents(id, query, people, cache)
    const listed = contents.files.map((f) => f.address).filter((a): a is string => !!a)
    const listedSet = new Set(listed)
    const filed = await query([
      { '#h': [id], kinds: [KIND_BARE_FILE, KIND_PROJECT], limit: 500 },
      { '#h': [id], kinds: [KIND_CHANGE], limit: 500 },
    ])
    const missing: Plan['missing'] = []
    const seen = new Set<string>()
    const consider = (address: string, why: string) => {
      if (listedSet.has(address) || seen.has(address)) return
      seen.add(address)
      missing.push({ address, why })
    }
    for (const e of filed) {
      if (e.kind !== KIND_BARE_FILE && e.kind !== KIND_PROJECT) continue
      if ((tag(e, 'd') ?? id) === id) continue
      consider(addressOf(e), `${e.kind} by h`)
    }
    /*
      A project linked here names this Folder on its `folder` field, and the
      link is published into this Folder too (`ship link-project`). Only the
      newest `folder` change per project counts — a project linked here and
      then elsewhere left its older change behind.
    */
    const targets = [...new Set(filed.filter((e) => e.kind === KIND_CHANGE && tag(e, 'field') === 'folder').map((e) => tag(e, 'a')).filter((a): a is string => !!a))]
    if (targets.length) {
      const changes = await query([{ kinds: [KIND_CHANGE], '#a': targets, limit: 500 }])
      const newest = new Map<string, SignedEvent>()
      for (const e of changes) {
        if (tag(e, 'field') !== 'folder') continue
        const target = tag(e, 'a')!
        if ((newest.get(target)?.created_at ?? 0) < e.created_at) newest.set(target, e)
      }
      for (const [target, e] of newest) if (tag(e, 'value') === id) consider(target, 'project linked here')
    }
    const renames: Plan['renames'] = []
    for (const [container, { into, name }] of Object.entries(PLACE)) {
      if (into !== team) continue
      const channel = channelOf.get(container)
      if (!channel) throw new Error(`${container}: no kind:39000 on the relay`)
      consider(`${KIND_CHANNEL}:${channel.pubkey}:${container}`, `container placed here (${tag(channel, 'name')})`)
      if (tag(channel, 'name') !== name) renames.push({ id: container, from: tag(channel, 'name'), to: name })
    }
    out.push({
      team,
      id,
      hasState: contents.hasState,
      stateName: stateOf.get(id) ? tag(stateOf.get(id)!, 'name') : undefined,
      channelName: channelOf.get(id) ? tag(channelOf.get(id)!, 'name') : undefined,
      listed,
      missing,
      renames,
    })
  }
  return out
}

function print(p: Plan[]) {
  for (const t of p) {
    const name = t.hasState ? `state name ${t.stateName ? `"${t.stateName}"` : 'NONE → will set "' + t.channelName + '"'}` : `no state → first command carries ${t.listed.length} listed + name "${t.channelName}"`
    console.log(`\n${t.team} ${t.id.slice(0, 8)}: lists ${t.listed.length}; ${name}; missing ${t.missing.length}`)
    for (const m of t.missing) console.log(`    + ${m.address.slice(0, 5)}…${m.address.slice(-8)}  ${m.why}`)
    for (const r of t.renames) console.log(`    ~ channel ${r.id.slice(0, 8)} "${r.from}" → "${r.to}" (40003)`)
  }
}

async function apply(p: Plan[], query: QueryFn, t: Token) {
  const people = createPeopleCache().viaRelay(query)
  for (const team of p) {
    const needsName = !team.hasState || !team.stateName
    if (team.missing.length === 0 && !needsName && team.renames.length === 0) {
      console.log(`${team.team}: nothing to do`)
      continue
    }
    for (const r of team.renames) {
      const renamed = await publish(buildEditChannelMetadata(t.pubkey, Date.now(), { channelUuid: r.id, name: r.to }), t)
      console.log(`${team.team}: 40003 rename ${r.id.slice(0, 8)} → "${r.to}" → ${renamed.ok ? 'accepted' : `REFUSED ${renamed.reason}`}`)
      await sleep(WRITE_GAP_MS)
    }
    const name = needsName ? team.channelName : undefined
    if (needsName && !name) throw new Error(`${team.team}: no name on the channel to carry into the state`)
    // The first command on a stateless Folder must carry what it holds — add is additive after that.
    const addresses = team.hasState ? team.missing.map((m) => m.address) : [...team.listed, ...team.missing.map((m) => m.address)]
    const unsigned: UnsignedEvent = {
      pubkey: t.pubkey,
      created_at: toNostrSeconds(Date.now()),
      kind: KIND_FOLDER_COMMAND,
      tags: [['h', team.id], ['op', 'add'], ...addresses.map((a) => ['a', a]), ...(name ? [['name', name]] : [])],
      content: '',
    }
    const result = await publish(unsigned, t)
    console.log(`${team.team}: 1852 add ${addresses.length}${name ? ` name "${name}"` : ''} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`} (${result.id.slice(0, 8)})`)
    await sleep(WRITE_GAP_MS)
    const after = await resolveFolderContents(team.id, query, people, createProjectionCache())
    const listed = new Set(after.files.map((f) => f.address))
    const expected = [...team.listed, ...team.missing.map((m) => m.address)]
    const lost = expected.filter((a) => !listed.has(a))
    console.log(`    relay now lists ${after.files.length} (expected ${expected.length}), name "${after.name}", source ${after.source}${lost.length ? `; NOT LISTED: ${lost.map((a) => a.slice(0, 5) + '…' + a.slice(-8)).join(', ')}` : ''}`)
  }
}

async function main() {
  const mode = process.argv[2]
  if (mode !== 'plan' && mode !== 'apply') throw new Error('mode: plan | apply')
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}`)
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
