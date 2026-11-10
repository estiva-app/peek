/**
 * CON-20: a relay's `/query` answered from a snapshot, so Ship's and Peek's own
 * readers can be run against production's data as it was before the migration
 * and as it is after — and against every Folder, where the agent reads 68.
 *
 *   npx tsx scripts/con20-fake-relay.ts ~/con20-scratch/before.jsonl [port]
 *
 * NIP-01 filters (`ids`, `authors`, `kinds`, `#x`, `since`, `until`, `limit`),
 * newest first, `limit` clamped at 1,000 per filter as buzz does. Authorization
 * is not checked: it reads as a member of everything, which is the point.
 * `/events` is refused, so a reader that tries to write fails loudly.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import type { SignedEvent } from '@estiva-app/protocol'

const [file, portArg] = process.argv.slice(2)
if (!file) throw new Error('usage: con20-fake-relay.ts <snapshot.jsonl> [port]')
const port = Number(portArg ?? 7781)
const CEILING = 1000

const events = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('{'))
  .map((l) => JSON.parse(l) as SignedEvent)
  .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))

type Filter = Record<string, unknown>

function matches(e: SignedEvent, f: Filter): boolean {
  if (Array.isArray(f.ids) && !f.ids.some((id: string) => e.id.startsWith(id))) return false
  if (Array.isArray(f.authors) && !f.authors.some((a: string) => e.pubkey.startsWith(a))) return false
  if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
  if (typeof f.since === 'number' && e.created_at < f.since) return false
  if (typeof f.until === 'number' && e.created_at > f.until) return false
  for (const [key, values] of Object.entries(f)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue
    const name = key.slice(1)
    if (!e.tags.some((t) => t[0] === name && values.includes(t[1]))) return false
  }
  return true
}

function query(filters: Filter[]): SignedEvent[] {
  const out = new Map<string, SignedEvent>()
  for (const f of filters) {
    if (typeof f.search === 'string') continue
    const limit = Math.min(typeof f.limit === 'number' ? f.limit : CEILING, CEILING)
    let n = 0
    for (const e of events) {
      if (n >= limit) break
      if (!matches(e, f)) continue
      out.set(e.id, e)
      n++
    }
  }
  return [...out.values()]
}

createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end()
    if (req.method === 'POST' && req.url?.startsWith('/query')) {
      const parsed = JSON.parse(body) as Filter | Filter[]
      return void res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(query(Array.isArray(parsed) ? parsed : [parsed])))
    }
    res.writeHead(405, cors).end(JSON.stringify({ error: `con20-fake-relay: ${req.method} ${req.url} is not served` }))
  })
}).listen(port, () => console.log(`con20-fake-relay: ${events.length} events from ${file} on http://localhost:${port}`))
