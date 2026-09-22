/**
 * CON-4: give every topic the migration will write into a `30840` file, and
 * record *For testing* as discarded — run as the agent identity against
 * production.
 *
 *   cd ~/peek-con4-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/con4-topic-files.ts plan
 *   npx tsx --tsconfig tsconfig.app.json scripts/con4-topic-files.ts apply
 *
 * `plan` is read-only. `apply` publishes a `kind:30840` per missing file and
 * one `kind:1852 add` per team touched, then re-reads both — the file by its
 * `d`, and the team Folder's listing — because filing by `h` never updates a
 * Folder's `30890` state and a file that is only readable by containment is
 * invisible on the Folders page (PEE-31).
 *
 * **Why this is all that is left of CON-4.** The ticket was written to settle
 * whether the 17 recorded-but-unreadable messages sat behind a soft-deleted
 * channel, and to un-delete it. Both legs collapsed on 2026-09-22: a migrated
 * message lands as `kind:1111` on the topic's file, whose `h` is the *team*
 * channel, so republishing into a dead topic channel cannot happen by
 * construction; and *For testing* — the only one of the seven dead channels
 * holding anything at all — is discarded rather than recovered. What remains
 * is the file the discard leaves missing, and writing the discard down where
 * the census reads it.
 *
 * `DISCARDED` is consumed by `scripts/probe-shr8-census.ts`, which is what
 * makes the exclusion a measured number rather than a note in a ticket.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, buildBareFile, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, createProjectionCache, resolveFolderContents, type QueryFn } from '@estiva-app/interop'
import { randomUUID } from 'node:crypto'
import { DISCARDED, NO_FILE_TARGET, TEAMS } from './con4-discarded.js'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
/** Between writes: the relay's quota trips after a handful in a row (FOL-25). */
const WRITE_GAP_MS = 6_000

const KIND_BARE_FILE = 30840
const KIND_CHANNEL = 39000
const KIND_FOLDER_COMMAND = 1852

/**
 * Which team each topic that still needs a file belongs to.
 *
 * The title is the Convex title **verbatim**, including *Renamed 4*, because
 * every reader that asks "does this topic have a file?" —
 * `probe-con16-channel-vs-file.ts`, `fol25-topics-to-files.ts` and the
 * migration itself — matches the `30840`'s `title` tag against it. A prettier
 * title here would read as a missing file to all three.
 *
 * The team is FOL-25's triage (`fol25-topics-to-files.ts` `TRIAGE`), which
 * sorted this topic into Steer and then marked it `delete`, which is why the
 * file was never made.
 */
const WANT_FILE: Array<[title: string, team: keyof typeof TEAMS]> = [
  ['Interesting Claude-generated docs - Renamed 4', 'Steer'],
]

type Token = { accessToken: string; pubkey: string }

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

/** Publish one event; the relay refuses as `200` with `accepted: false`. */
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
const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]
const addressOf = (e: SignedEvent) => `${e.kind}:${e.pubkey}:${tag(e, 'd') ?? ''}`

async function convexTopics(): Promise<Array<{ title: string; id: string; channelUuid: string | null }>> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'topics:list', args: {}, format: 'json' }),
  })
  if (!res.ok) throw new Error(`convex topics:list: ${res.status}`)
  const body = (await res.json()) as { value?: Array<{ title: string; id: string; channelUuid: string | null }> }
  return body.value ?? (body as unknown as Array<{ title: string; id: string; channelUuid: string | null }>)
}

type Row = {
  title: string
  channelUuid: string | null
  /** Whether the topic channel still answers a read — not whether a `9008` is in its history. */
  live: boolean
  /** The `30840` carrying this title, filed in a team. */
  file?: SignedEvent
  team?: keyof typeof TEAMS
  discarded?: string
  /** Set when the topic is migrated somewhere that is not a file. */
  noFileTarget?: string
}

async function survey(query: QueryFn, t: Token): Promise<Row[]> {
  const topics = await convexTopics()
  const uuids = topics.map((x) => x.channelUuid).filter((x): x is string => !!x)
  const metas = await query([{ kinds: [KIND_CHANNEL], '#d': uuids, limit: uuids.length }])
  const live = new Set(metas.map((e) => tag(e, 'd')).filter((x): x is string => !!x))

  // Every file the agent has filed in a team, by title. The migration matches
  // a topic to its file the same way.
  const fileOf = new Map<string, { file: SignedEvent; team: keyof typeof TEAMS }>()
  for (const [team, id] of Object.entries(TEAMS) as Array<[keyof typeof TEAMS, string]>) {
    for (const f of await query([{ kinds: [KIND_BARE_FILE], '#h': [id], authors: [t.pubkey], limit: 500 }])) {
      const title = tag(f, 'title')
      if (title) fileOf.set(title, { file: f, team })
    }
  }

  return topics.map((tp) => {
    const hit = fileOf.get(tp.title)
    return {
      title: tp.title,
      channelUuid: tp.channelUuid,
      live: !!tp.channelUuid && live.has(tp.channelUuid),
      file: hit?.file,
      team: hit?.team ?? WANT_FILE.find(([title]) => title === tp.title)?.[1],
      discarded: DISCARDED[tp.title],
      noFileTarget: NO_FILE_TARGET[tp.title],
    }
  })
}

/** A topic with no file that this run is meant to give one. */
const toCreate = (rows: Row[]) => rows.filter((r) => !r.file && !r.discarded && !r.noFileTarget && WANT_FILE.some(([title]) => title === r.title))

function print(rows: Row[]) {
  console.log('\ntopic'.padEnd(48) + 'channel  file                 team')
  for (const r of rows.slice().sort((a, b) => a.title.localeCompare(b.title))) {
    const file = r.discarded ? 'DISCARDED' : r.noFileTarget ? 'in place' : r.file ? tag(r.file, 'd')!.slice(0, 8) : 'none'
    console.log(
      r.title.slice(0, 46).padEnd(48) +
        (r.live ? 'live' : 'gone').padEnd(9) +
        file.padEnd(21) +
        (r.team ?? '—'),
    )
  }
  const create = toCreate(rows)
  console.log(
    `\n${rows.length} topics · ${rows.filter((r) => r.file).length} with a file · ${rows.filter((r) => r.discarded).length} discarded · ` +
      `${rows.filter((r) => r.noFileTarget).length} migrated in place · ${create.length} to create`,
  )
  for (const r of create) console.log(`  CREATE    ${r.title} → ${r.team}`)
  for (const [title, why] of Object.entries(DISCARDED)) console.log(`  DISCARDED ${title}: ${why}`)
  for (const [title, why] of Object.entries(NO_FILE_TARGET)) console.log(`  IN PLACE  ${title}: ${why}`)
  /*
    Everything else with no file is a topic the census scores 0: its
    conversation is entirely on the relay already, so the migration never
    writes into it and it needs no target. `probe-shr8-census.ts` is the
    authority on that — it prints a target per gap-bearing surface and counts
    the ones with none.
  */
}

async function apply(rows: Row[], query: QueryFn, t: Token) {
  const people = createPeopleCache().viaRelay(query)
  const todo = toCreate(rows)
  if (!todo.length) {
    console.log('\nnothing to create')
    return
  }
  for (const r of todo) {
    const team = r.team
    if (!team) {
      console.log(`${r.title}: no team in WANT_FILE, skipped`)
      continue
    }
    const teamId = TEAMS[team]
    const fileId = randomUUID()
    const created = await publish(buildBareFile(t.pubkey, Date.now(), { fileId, title: r.title, channelUuid: teamId }), t)
    console.log(`${r.title}: 30840 ${fileId} in ${team} → ${created.ok ? 'accepted' : `REFUSED ${created.reason}`}`)
    if (!created.ok) continue
    await sleep(WRITE_GAP_MS)

    // Filing by `h` does not touch the team's `30890`, and a Folder with state
    // lists only what its state names. The first command on a *stateless*
    // Folder emits state listing only what the command names, so it has to
    // carry everything the Folder holds today as well.
    const address = `${KIND_BARE_FILE}:${t.pubkey}:${fileId}`
    const before = await resolveFolderContents(teamId, query, people, createProjectionCache())
    const listed = before.files.map((f) => f.address).filter((a): a is string => !!a)
    if (listed.includes(address)) {
      console.log(`    ${team} already lists it`)
      continue
    }
    const addresses = before.hasState ? [address] : [...listed, address]
    const name = before.hasState ? undefined : before.name
    const cmd: UnsignedEvent = {
      pubkey: t.pubkey,
      created_at: toNostrSeconds(Date.now()),
      kind: KIND_FOLDER_COMMAND,
      tags: [['h', teamId], ['op', 'add'], ...addresses.map((a) => ['a', a]), ...(name ? [['name', name]] : [])],
      content: '',
    }
    const added = await publish(cmd, t)
    console.log(`    1852 add ${addresses.length}${name ? ` name "${name}"` : ''} → ${added.ok ? 'accepted' : `REFUSED ${added.reason}`}`)
    await sleep(WRITE_GAP_MS)
  }
  await verify(query, t)
}

/** The done-when, read back from the relay: the file answers, and the Folder lists it. */
async function verify(query: QueryFn, t: Token) {
  console.log('\n— read back ———————————————————————————————')
  const people = createPeopleCache().viaRelay(query)
  const after = await survey(query, t)
  for (const r of after) {
    if (!WANT_FILE.some(([title]) => title === r.title)) continue
    if (!r.file) continue
    const fileId = tag(r.file, 'd')!
    const direct = await query([{ kinds: [KIND_BARE_FILE], '#d': [fileId], limit: 1 }])
    const teamId = TEAMS[r.team!]
    const contents = await resolveFolderContents(teamId, query, people, createProjectionCache())
    const address = `${KIND_BARE_FILE}:${t.pubkey}:${fileId}`
    const isListed = contents.files.some((f) => f.address === address)
    console.log(
      `${r.title}\n    kind:30840 #d read → ${direct.length ? `${direct.length} event, title "${tag(direct[0]!, 'title')}", h ${tag(direct[0]!, 'h')?.slice(0, 8)}` : 'NOTHING'}\n` +
        `    ${r.team} Folder lists ${contents.files.length} (source ${contents.source}) → this file ${isListed ? 'LISTED' : 'NOT LISTED'}`,
    )
  }
  const missing = toCreate(after)
  console.log(`\ntopics still wanting a file: ${missing.length}${missing.length ? ` — ${missing.map((r) => r.title).join(', ')}` : ''}`)
}

async function main() {
  const mode = process.argv[2]
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'verify') throw new Error('mode: plan | apply | verify')
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}`)
  const rows = await survey(query, t)
  print(rows)
  if (mode === 'apply') await apply(rows, query, t)
  if (mode === 'verify') await verify(query, t)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
