/**
 * What a production migration script needs from the relay and Estiva ID —
 * shared by `con20-kind9-to-1111.ts` and `con22-shr8-leftovers.ts`.
 *
 * The input is a `con20-export.sql` export (the database, not the relay: the
 * agent reads only some Folders). Writes go through buzz's HTTP bridge, each
 * signed by its author: the agent through Estiva ID's `/sign`, anyone else
 * with their own key from a JSON map of pubkey to secret hex (memory:
 * exporting-a-custodied-signing-key). Nothing here prints a secret.
 */
import { existsSync, readFileSync } from 'node:fs'
import { authorizationHeaderFor, buildUnsignedAuthEvent, computeEventId, parsePublishResponse, publicKeyFromSecret, signEvent } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** Between writes; a quota refusal names its own wait and is honoured on top. */
export const WRITE_GAP_MS = 400

export type Signer = (u: UnsignedEvent) => Promise<SignedEvent>
export interface Identity {
  pubkey: string
  sign: Signer
}

export const valuesOf = (e: Pick<SignedEvent, 'tags'>, name: string) => e.tags.filter((t) => t[0] === name && t[1]).map((t) => t[1])
export const hasE = (e: Pick<SignedEvent, 'tags'>) => e.tags.some((t) => t[0] === 'e')
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface Index {
  byId: Map<string, SignedEvent>
  /** Events naming an id by `e` or `q`. */
  pointing: Map<string, SignedEvent[]>
}

export function loadExport(path: string): Index {
  const byId = new Map<string, SignedEvent>()
  const pointing = new Map<string, SignedEvent[]>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue
    const e = JSON.parse(line) as SignedEvent
    // The database's jsonb must hand back the tags that were signed, or a copy would carry different ones.
    if (computeEventId(e) !== e.id) throw new Error(`${e.id}: the exported fields do not hash to its id — refusing the export`)
    byId.set(e.id, e)
  }
  for (const e of byId.values()) {
    for (const t of e.tags) {
      if ((t[0] === 'e' || t[0] === 'q') && t[1]) pointing.set(t[1], [...(pointing.get(t[1]) ?? []), e])
    }
  }
  return { byId, pointing }
}

export async function agentIdentity(): Promise<Identity> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required (the agent signs its own copies)')
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
  const t = (await res.json()) as { access_token: string; pubkey: string }
  return {
    pubkey: t.pubkey,
    sign: async (unsigned) => {
      const r = await fetch(`${ID_ORIGIN}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` },
        body: JSON.stringify({ event: unsigned }),
      })
      if (!r.ok) throw new Error(`POST /sign: ${r.status} ${await r.text()}`)
      return ((await r.json()) as { event: SignedEvent }).event
    },
  }
}

/** A NIP-98-authorised POST to the relay's bridge, as `who`. */
async function bridge(path: string, payload: unknown, who: Identity) {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await who.sign(buildUnsignedAuthEvent({ pubkey: who.pubkey, url, method: 'POST', body }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

/** Which of these ids the relay returns to `who`. */
export async function present(ids: readonly string[], who: Identity): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { status, text } = await bridge('/query', [{ ids: chunk, limit: chunk.length }], who)
    if (status !== 200) throw new Error(`/query: ${status} ${text.slice(0, 200)}`)
    for (const e of JSON.parse(text) as SignedEvent[]) out.add(e.id)
  }
  return out
}

/** Per author, which of the rows' ids the relay returns — read as the author, who can read their own Folder. */
export async function readBack<R extends { old: { pubkey: string } }>(rows: readonly R[], idOf: (r: R) => string, signers: ReadonlyMap<string, Identity>): Promise<Set<string>> {
  const out = new Set<string>()
  for (const [pk, who] of signers) {
    for (const id of await present(rows.filter((r) => r.old.pubkey === pk).map(idOf), who)) out.add(id)
  }
  return out
}

/** pubkey → secret hex; each secret is checked against the pubkey it is filed under. Empty when the file does not exist. */
export function loadKeys(path: string): Map<string, string> {
  const keys = new Map<string, string>()
  if (!existsSync(path)) return keys
  for (const [pk, sk] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>)) {
    if (publicKeyFromSecret(sk) !== pk) throw new Error(`${path}: the secret filed under ${pk.slice(0, 8)}… derives a different pubkey`)
    keys.set(pk, sk)
  }
  return keys
}

/** The agent, plus everyone whose key is in `keys`. */
export function signersFrom(agent: Identity, keys: ReadonlyMap<string, string>): Map<string, Identity> {
  const signers = new Map<string, Identity>([[agent.pubkey, agent]])
  for (const [pk, sk] of keys) if (pk !== agent.pubkey) signers.set(pk, { pubkey: pk, sign: async (u) => signEvent(u, sk) })
  return signers
}

/** Publish a signed event as its author; a quota refusal is waited out, anything else throws. */
export async function publish(signed: SignedEvent, author: Identity): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const { status, text } = await bridge('/events', signed, author)
    const result = parsePublishResponse(status, text)
    if (result.ok) return
    const reason = `${status} ${result.reason ?? text.slice(0, 200)}`
    const quota = status === 429 || /rate.?limit|quota/i.test(reason)
    if (!quota || attempt === 6) throw new Error(`refused: ${reason}`)
    await sleep((Number(/retry in (\d+)\s*s/i.exec(reason)?.[1] ?? 5) + 1) * 1000)
  }
}

/** `h` → pubkey → role, from `con20-members.sql`. */
export function loadMembers(path: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue
    const m = JSON.parse(line) as { h: string; pubkey: string; role: string }
    if (!out.has(m.h)) out.set(m.h, new Map())
    out.get(m.h)!.set(m.pubkey, m.role)
  }
  return out
}
