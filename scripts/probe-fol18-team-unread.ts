/**
 * Measure what a team's unread dot costs on the sidebar (FOL-18, SPEC §11.3).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/probe-fol18-team-unread.ts
 *
 * (`--tsconfig tsconfig.app.json` because the judge imports by `@/`, and only
 * that config carries the alias.) Read-only — seven `POST /query` in all, and
 * an Estiva ID decrypt per read-state slot. The ticket asks the cost question
 * before the wiring: the naive
 * shape is `resolveFolderContents` + `conversationsOf` per Folder, which is at
 * least two `/query` POSTs per row against a 300/min meter shared across every
 * app the person has open. This measures the alternative — every message in a
 * Folder's channel, `kind:9` and `kind:1111`, one filter per Folder, batched
 * 128 filters to a POST — and reports what the sidebar would spend.
 *
 * It also prints the tags of the newest comment on the FOL-18 issue, so the
 * wire shape (does a comment carry `h`? an `a`? a root scope `A`?) is read off
 * production rather than assumed.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { readChannelStreams } from '../src/nostr/channelStreams'
import { allSlotsFilter, channelContext, fileContext, parseReadStateBlob, READ_STATE_D_PREFIX, mergeSlots, type SlotBlob } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from '../src/nostr/readState'
import { teamHasUnread } from '../src/api/teamUnread'
import { fileHasUnread } from '../src/api/fileUnread'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const HORIZON_DAYS = 90
const PER_FOLDER_LIMIT = Number(process.env.PER_FOLDER_LIMIT ?? 100)
const FILTERS_PER_POST = 128
const FOL18 =
  '30851:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:6e10d143-5fc4-4c5f-a675-d6cb35a1f5dc'

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

let posts = 0
async function query(filters: unknown[], t: { accessToken: string; pubkey: string }): Promise<SignedEvent[]> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  posts++
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

async function main() {
  const t = await token()
  console.log(`identity ${t.pubkey.slice(0, 8)}…`)

  // 1. Every Folder — what `listFolders` fetches, so the row count is the real one.
  const t0 = Date.now()
  const folderEvents = await query([{ kinds: [30890], limit: 500 }, { kinds: [39000], limit: 500 }], t)
  const folders = [...new Set(folderEvents.map((e) => tag(e, 'd')).filter(Boolean) as string[])]
  console.log(`folders: ${folders.length} (${Date.now() - t0} ms, ${folderEvents.length} state/metadata events)`)

  // 2. One filter per Folder, batched: the channel's messages inside the horizon.
  const since = Math.floor(Date.now() / 1000) - HORIZON_DAYS * 24 * 60 * 60
  const filters = folders.map((h) => ({ kinds: [9, 1111], '#h': [h], since, limit: PER_FOLDER_LIMIT }))
  const t1 = Date.now()
  const before = posts
  const events: SignedEvent[] = []
  for (let i = 0; i < filters.length; i += FILTERS_PER_POST) {
    events.push(...(await query(filters.slice(i, i + FILTERS_PER_POST), t)))
  }
  const ms = Date.now() - t1
  const perFolder = new Map<string, number>()
  let withA = 0
  for (const e of events) {
    const h = tag(e, 'h') ?? '?'
    perFolder.set(h, (perFolder.get(h) ?? 0) + 1)
    if (tag(e, 'a')) withA++
  }
  const busy = [...perFolder.values()].filter((n) => n >= PER_FOLDER_LIMIT).length
  const bytes = JSON.stringify(events).length
  console.log(
    `union read: ${posts - before} POST(s) for ${filters.length} filters, ${ms} ms, ${events.length} events ` +
      `(${withA} carry an \`a\`, ${events.length - withA} are general), ${(bytes / 1024).toFixed(0)} KiB, ` +
      `${busy} Folder(s) at the ${PER_FOLDER_LIMIT} limit, ${perFolder.size} Folder(s) with any message`,
  )
  const top = [...perFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  for (const [h, n] of top) console.log(`  ${h} ${n}`)

  // 3. The wire shape of a Ship comment: the newest on FOL-18.
  const comments = await query([{ kinds: [9, 1111], '#a': [FOL18], limit: 3 }], t)
  console.log(`FOL-18 comments (newest ${comments.length}):`)
  for (const c of comments) {
    console.log(`  kind ${c.kind} by ${c.pubkey.slice(0, 8)}… at ${new Date(c.created_at * 1000).toISOString()}`)
    console.log(`    tags ${JSON.stringify(c.tags.map((x) => x.slice(0, 2)))}`)
  }
  /*
    4. The shipped path, end to end, as this identity: `readChannelStreams`
    over the real relay, the real merged frontier (every slot, decrypted the
    way the app does), `teamHasUnread` per Folder. Reports each lit Folder
    with the stream that lit it, so the decision can be checked against
    `window.__readState.marker(<stream>)` in a browser signed in as the same
    person — and so "lit" is traceable to one message and one marker.
  */
  const nowSeconds = Math.floor(Date.now() / 1000)
  const horizonSeconds = PEEK_HORIZON_DAYS * 24 * 60 * 60
  const slotEvents = await query([allSlotsFilter(t.pubkey, Date.now(), PEEK_HORIZON_DAYS)], t)
  const slots: SlotBlob[] = []
  for (const e of slotEvents) {
    const dTag = tag(e, 'd')
    if (!dTag?.startsWith(READ_STATE_D_PREFIX)) continue
    const res = await fetch(`${ID_ORIGIN}/nip44/decrypt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
      body: JSON.stringify({ ciphertext: e.content }),
    })
    if (!res.ok) continue
    const { plaintext } = (await res.json()) as { plaintext: string }
    const blob = parseReadStateBlob(plaintext)
    if (blob) slots.push({ dTag, eventId: e.id, createdAt: e.created_at, blob })
  }
  const merged = mergeSlots(slots)
  const marker = (context: string | undefined) => (context ? merged[context] : undefined)
  // Slot events versus slots decrypted: "no read state" and "could not
  // decrypt" must not print the same line.
  console.log(
    `frontier: ${slotEvents.length} kind:30078 event(s), ${slots.length} slot(s) decrypted, ${Object.keys(merged).length} context(s)`,
  )

  const streams = await readChannelStreams(folders, nowSeconds - horizonSeconds, (f) => query(f, t))
  // A member of everything: this probe measures the FOL-18 union, not the §11.8 gate.
  const judge = {
    merged,
    termsOf: () => ({ member: true, muted: false }),
    isMentioned: () => false,
    me: t.pubkey,
    nowSeconds,
    horizonSeconds,
  }
  let lit = 0
  for (const folder of folders) {
    const messages = streams[folder] ?? []
    if (!teamHasUnread(folder, messages, judge)) continue
    lit++
    // Which stream: the same grouping the judge applies, reported per stream.
    const byStream = new Map<string, typeof messages>()
    for (const m of messages) {
      const files = m.about.map(fileContext).filter((c): c is string => c !== undefined)
      for (const c of files.length ? files : [channelContext(folder) ?? '(no context)']) {
        byStream.set(c, [...(byStream.get(c) ?? []), m])
      }
    }
    const why = [...byStream]
      .filter(([c, ms]) =>
        fileHasUnread(ms, { file: marker(c), thread: () => undefined, me: t.pubkey, nowSeconds, horizonSeconds }),
      )
      .map(([c, ms]) => {
        const newest = ms.filter((m) => m.by !== t.pubkey).sort((a, b) => b.at - a.at)[0]
        const mk = marker(c)
        return `${c.length > 40 ? c.slice(0, 12) + '…' + c.slice(-12) : c} newest ${newest ? new Date(newest.at * 1000).toISOString() : '-'} marker ${mk ? new Date(mk * 1000).toISOString() : 'absent'}`
      })
    console.log(`LIT ${folder} (${messages.length} msgs)`)
    for (const line of why) console.log(`    ${line}`)
  }
  console.log(`lit ${lit} of ${folders.length} Folders as ${t.pubkey.slice(0, 8)}…`)
  console.log(`total POST /query this run: ${posts}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
