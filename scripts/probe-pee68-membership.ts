/**
 * Which files does Peek think Miky is a member of, and does the read's limit cut
 * any out? (PEE-68 — items leave the Screener between sessions.)
 *
 *   npx tsx scripts/probe-pee68-membership.ts [session.json] [asOfUnixSeconds]
 *
 * Reads as whoever the delegated Estiva ID session names (per22-scratch's
 * session.json). Read-only: it queries the relay and publishes nothing, so it
 * moves no read marker. For each of Peek's three membership filters it asks
 * twice — with Peek's own MEMBERSHIP_LIMIT and with a much larger one — folds
 * both with Peek's own `foldMemberships`, and prints the member files the
 * limited read loses. `asOf` replays the read as Peek would have made it then
 * (events created after it are dropped).
 */
import { readFileSync } from 'node:fs'
import type { SignedEvent } from '@estiva-app/protocol'
import { Relay } from '@estiva-app/protocol'
import { estivaIdSigner } from '@estiva-app/identity'
import { READ_STATE_HORIZON_DAYS, candidateFilesOf, membershipFilters, membershipOf, type Membership } from '@estiva-app/conversation'

// `src/nostr/membership.ts`'s read and fold, copied: importing it pulls in the browser bridge.
const MEMBERSHIP_LIMIT = 1000
const HORIZON_SECONDS = READ_STATE_HORIZON_DAYS * 24 * 60 * 60
const membershipQueries = (pubkey: string, nowSeconds: number) =>
  membershipFilters(pubkey, nowSeconds - HORIZON_SECONDS).map((filter) => ({ ...filter, limit: MEMBERSHIP_LIMIT }))
function foldMemberships(pubkey: string, events: readonly SignedEvent[], nowSeconds: number) {
  const floor = nowSeconds - HORIZON_SECONDS
  const byFile = new Map<string, SignedEvent[]>()
  for (const event of events) for (const file of candidateFilesOf(event)) byFile.set(file, [...(byFile.get(file) ?? []), event])
  const files = new Map<string, Membership>()
  for (const [file, held] of byFile) {
    const [kind, author, d] = file.split(':')
    const root = author === pubkey ? [{ id: '', pubkey, kind: Number(kind), created_at: floor, tags: [['d', d ?? '']], content: '', sig: '' }] : []
    files.set(file, membershipOf(file, pubkey, [...root, ...held]))
  }
  return { files }
}

const ID = 'https://id.estiva.app'
const RELAY = 'https://estiva.estiva.app'
const sessionPath = process.argv[2] ?? `${process.env.HOME}/estiva/per22-scratch/session.json`
const asOf = Number(process.argv[3] ?? Math.floor(Date.now() / 1000))

const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
const cookie = `${session.cookie_name}=${session.session_token}`
const me = (await (await fetch(`${ID}/me`, { headers: { cookie } })).json()) as { pubkey: string }
const tokenRes = await fetch(`${ID}/token`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ clientId: 'estiva-peek' }),
})
const { access_token: token } = (await tokenRes.json()) as { access_token: string }
if (!token) throw new Error(`POST /token ${tokenRes.status}`)
const relay = new Relay(RELAY, estivaIdSigner({ base: ID, pubkey: me.pubkey, token }))

const queries = membershipQueries(me.pubkey, asOf)
const limited: SignedEvent[] = []
const full: SignedEvent[] = []
for (const [i, filter] of queries.entries()) {
  const until = { ...filter, until: asOf }
  const small = (await relay.query([until])) as SignedEvent[]
  const big = (await relay.query([{ ...until, limit: 20_000 }])) as SignedEvent[]
  const oldest = (list: SignedEvent[]) => (list.length ? new Date(Math.min(...list.map((e) => e.created_at)) * 1000).toISOString() : '-')
  console.log(`filter ${i}: ${JSON.stringify({ ...filter, limit: undefined, since: filter.since })}`)
  console.log(`  limit ${MEMBERSHIP_LIMIT}: ${small.length} events, oldest ${oldest(small)}`)
  console.log(`  limit 20000: ${big.length} events, oldest ${oldest(big)}`)
  limited.push(...small)
  full.push(...big)
}

const a = foldMemberships(me.pubkey, limited, asOf)
const b = foldMemberships(me.pubkey, full, asOf)
const members = (read: typeof a) => new Set([...read.files].filter(([, m]) => m.member).map(([file]) => file))
const inA = members(a)
const inB = members(b)
console.log(`\nas of ${new Date(asOf * 1000).toISOString()}: member files ${inA.size} (Peek's read) vs ${inB.size} (unlimited)`)
for (const file of inB) if (!inA.has(file)) console.log(`  lost to the limit: ${file}`)
for (const file of inA) if (!inB.has(file)) console.log(`  only in Peek's read: ${file}`)
