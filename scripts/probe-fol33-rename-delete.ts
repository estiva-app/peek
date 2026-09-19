/**
 * FOL-33 on production, the protocol half: a bare-file topic is renamed by its
 * manifest's `rename` action and deleted by its `delete` action, and every
 * reader — the file's own resolve, the team Folder's listing (what the tree
 * and Ship both draw), the team's `kind:30890` — agrees at each step.
 *
 * Runs as the agent, against a **throwaway it creates**: a `30840` in the
 * named team, added to the team's state so the listing half is real, then
 * renamed, then deleted and unlisted. Nothing it touches existed before it
 * ran, and nothing is left when it ends — the control is safe if the code is
 * wrong (a wrong `a` on the deletion could hit nothing but the throwaway).
 *
 * It builds the write events exactly as Peek does — `buildActionEvent` against
 * the manifest `resolveManifest` answers for the address — so what is measured
 * is the shape the page will publish, not a hand-rolled copy of it.
 *
 * What it cannot do: a non-author's refused delete needs a second identity, and
 * the agent is the only one here. That leg is the person's, in the browser.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx scripts/probe-fol33-rename-delete.ts [--team <folder uuid>]
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, buildBareFile, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  buildActionEvent,
  createPeopleCache,
  createProjectionCache,
  KIND_BARE_FILE,
  resolveFolderContents,
  resolveForeignObject,
  resolveManifest,
  type QueryFn,
} from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** The Peek team by default — where "For testing" already lives. */
const TEAM = process.argv.includes('--team')
  ? process.argv[process.argv.indexOf('--team') + 1]
  : 'fd03975a-eb00-49d6-a4b7-33ead1854672'
const KIND_FOLDER_COMMAND = 1852
const KIND_FOLDER_STATE = 30890
/** The relay's write meter is per minute; a probe that races it reads its own 429s. */
const WRITE_GAP_MS = 4_000

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

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
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

async function publish(unsigned: UnsignedEvent, t: Token): Promise<{ ok: boolean; reason?: string; id: string }> {
  const signed = await sign(unsigned, t)
  const { status, text } = await bridge('/events', signed, t)
  let parsed: { accepted?: boolean; reason?: string; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    // Not JSON: reported through `reason` below.
  }
  const ok = status === 200 && parsed.accepted !== false
  return { ok, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 160)}`), id: signed.id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are not set')
  const t = await token()
  const query = queryFn(t)
  const people = createPeopleCache().viaRelay(query)
  const cache = createProjectionCache()
  const stamp = new Date().toISOString().slice(0, 16)
  const fileId = crypto.randomUUID()
  const address = `${KIND_BARE_FILE}:${t.pubkey}:${fileId}`
  const pointer = { kind: KIND_BARE_FILE, pubkey: t.pubkey, identifier: fileId, relays: [] as string[] }
  console.log(`agent ${t.pubkey.slice(0, 8)}… team ${TEAM} file ${address}`)

  // The team must have state, or the listing half means nothing here.
  const before = await resolveFolderContents(TEAM, query, people, cache)
  step('team Folder has state', before.hasState, `${before.files.length} files listed, source ${before.source}`)
  if (!before.hasState) return

  // 1. The throwaway, and its 1852 add — `createTopicAsViewer`'s two writes.
  const created = await publish(
    buildBareFile(t.pubkey, Date.now(), { fileId, title: `FOL-33 probe ${stamp} (deletes itself)`, channelUuid: TEAM }),
    t,
  )
  step('create the throwaway 30840', created.ok, created.reason)
  if (!created.ok) return
  await sleep(WRITE_GAP_MS)
  const added = await publish(
    { pubkey: t.pubkey, created_at: toNostrSeconds(Date.now()), kind: KIND_FOLDER_COMMAND, tags: [['h', TEAM], ['op', 'add'], ['a', address]], content: '' },
    t,
  )
  step('1852 add to the team', added.ok, added.reason)
  await sleep(1_000)
  const listed = await resolveFolderContents(TEAM, query, people, createProjectionCache())
  step('listed in the team', listed.files.some((f) => f.address === address))

  // 2. The manifest, as Peek resolves it — and the actions it declares.
  const manifest = await resolveManifest(pointer, query, cache)
  step('bare file resolves the built-in manifest', manifest?.address === 'spec:6.7', manifest?.address)
  if (!manifest) return
  const object = await resolveForeignObject(address, query, people, 0, cache)
  const ids = (object?.actions ?? []).map((a) => `${a.id}:${a.control}`)
  step('actions: comment, rename (text), delete (confirm)', ids.join(',') === 'comment:text,rename:text,delete:confirm', ids.join(','))
  step('rename sets the title slot’s field', object?.actions.find((a) => a.id === 'rename')?.field === object?.slots.title?.field)

  // 3. Rename — the 1851 Peek will publish, read back three ways.
  const newTitle = `FOL-33 probe ${stamp} renamed`
  const renameEvent = buildActionEvent({
    manifest: manifest.manifest, kind: KIND_BARE_FILE, address, objectAuthor: t.pubkey, folder: TEAM,
    actionId: 'rename', value: newTitle, pubkey: t.pubkey, createdAtMs: Date.now(),
  })
  if (typeof renameEvent === 'string') {
    step('build rename', false, renameEvent)
    return
  }
  await sleep(WRITE_GAP_MS)
  const renamed = await publish(renameEvent, t)
  step('publish 1851 rename', renamed.ok, renamed.reason)
  await sleep(1_000)
  const fresh = createProjectionCache()
  const afterRename = await resolveForeignObject(address, query, people, 0, fresh)
  step('the file’s own resolve shows the new title', afterRename?.slots.title?.value === newTitle, afterRename?.slots.title?.value)
  const listingAfter = await resolveFolderContents(TEAM, query, people, fresh)
  const row = listingAfter.files.find((f) => f.address === address)
  step('the team listing (tree, Ship) shows the new title', row?.slots.title?.value === newTitle, row?.slots.title?.value)

  // 4. Delete — the kind:5 Peek will publish, then the 1852 remove.
  const deleteEvent = buildActionEvent({
    manifest: manifest.manifest, kind: KIND_BARE_FILE, address, objectAuthor: t.pubkey, folder: TEAM,
    actionId: 'delete', value: '', pubkey: t.pubkey, createdAtMs: Date.now(),
  })
  if (typeof deleteEvent === 'string') {
    step('build delete', false, deleteEvent)
    return
  }
  step('delete is kind:5 with a and k, no e', deleteEvent.kind === 5 && deleteEvent.tags.some((x) => x[0] === 'a' && x[1] === address) && !deleteEvent.tags.some((x) => x[0] === 'e'))
  await sleep(WRITE_GAP_MS)
  const deleted = await publish(deleteEvent, t)
  step('publish kind:5', deleted.ok, deleted.reason)
  await sleep(1_000)
  const [root] = await query([{ kinds: [KIND_BARE_FILE], authors: [t.pubkey], '#d': [fileId], limit: 1 }])
  step('the 30840 is gone from the relay', !root)
  await sleep(WRITE_GAP_MS)
  const removed = await publish(
    { pubkey: t.pubkey, created_at: toNostrSeconds(Date.now()), kind: KIND_FOLDER_COMMAND, tags: [['h', TEAM], ['op', 'remove'], ['a', address]], content: '' },
    t,
  )
  step('1852 remove from the team', removed.ok, removed.reason)
  await sleep(1_000)
  const [state] = await query([{ kinds: [KIND_FOLDER_STATE], '#d': [TEAM], limit: 1 }])
  const still = state?.tags.some((x) => x[0] === 'a' && x[1] === address)
  step('the team’s 30890 no longer names it', !!state && !still, state ? `${state.tags.filter((x) => x[0] === 'a').length} addresses` : 'no state read')
  const after = await resolveFolderContents(TEAM, query, people, createProjectionCache())
  step('the team listing no longer holds it', !after.files.some((f) => f.address === address), `${after.files.length} files (was ${before.files.length})`)
  step('nothing else in the team changed', after.files.length === before.files.length)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
