/**
 * Seed the two long topics `scripts/probe-switch.mjs` switches between: "Switch
 * probe A" and "Switch probe B" in the QA Folder, each with 200 top-level
 * messages from QA-1 and QA-2 in turn, replies, reactions, an edit, a deletion
 * and a few widgets (a Ship issue, the other topic, a quoted message).
 *
 * It writes through Peek's own write paths (`createTopicAsViewer`,
 * `commentAsViewer`, …) with a QA token, so the events are byte for byte what
 * the composer sends. It is resumable: a topic that exists is reused, and the
 * top-level messages already there are counted and not written again.
 *
 * Paced, because the relay allows 300 HTTP requests per 60 s per pubkey and a
 * comment costs about five (root read, two `/sign`, `POST /events`). The two
 * identities alternate, `PACE_MS` apart (default 1500), so each stays near 100
 * a minute; ~560 writes take about 15 minutes.
 *
 *   node scripts/run-in-vite.mjs scripts/seed-switch-fixture.ts [--dry-run]
 *
 * Reads QA{1,2}_EMAIL / QA{1,2}_SECRET from the environment or `~/.estiva-qa.env`.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { encodeNaddr, encodeNevent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { queryRelay } from '@/nostr/bridge'
import { listFoldersAsViewer, type FileComment } from '@/nostr/foreign'
import { createTopicAsViewer } from '@/nostr/startTopic'
import { commentAsViewer, deleteEventAsViewer, editCommentAsViewer, reactAsViewer } from '@/nostr/fileConversation'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
/** Registered for estiva-peek; only matched, never followed. */
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'https://peek.estiva.app/auth/callback'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
/** The QA Folder: open, so QA-1 and QA-2 both write in it without a kind:9000. */
const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'
const TITLES = ['Switch probe A', 'Switch probe B'] as const
const MESSAGES = 200
const PACE_MS = Number(process.env.PACE_MS ?? 1500)
/** A real Ship issue, for an issue widget: the ticket this fixture exists for. */
const SHIP_ISSUE = {
  kind: 30851,
  pubkey: 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46',
  identifier: '8ab06fbc-ec78-4261-b9dd-c3dc62c1846e',
}

const dryRun = process.argv.includes('--dry-run')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function qaToken(n: 1 | 2): Promise<StoredToken> {
  const envFile = join(homedir(), '.estiva-qa.env')
  if (!process.env[`QA${n}_EMAIL`] && existsSync(envFile)) process.loadEnvFile(envFile)
  const login = await fetch(`${ID_ORIGIN}/auth/test-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env[`QA${n}_EMAIL`],
      secret: process.env[`QA${n}_SECRET`],
    }),
  })
  const session = (await login.json()) as {
    cookie_name: string
    session_token: string
    pubkey: string
  }
  if (!login.ok) throw new Error(`QA-${n} test-login: ${login.status} ${JSON.stringify(session)}`)
  // Signed in the way Peek is (record sign-in-is-plain-oauth): `/authorize` with the session,
  // then the code and its PKCE verifier in the form format. A session alone buys no token.
  const verifier = randomBytes(32).toString('base64url')
  const authorize = new URL('/authorize', ID_ORIGIN)
  authorize.search = new URLSearchParams({
    client_id: 'estiva-peek',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  const authorized = await fetch(authorize, {
    headers: { cookie: `${session.cookie_name}=${session.session_token}` },
    redirect: 'manual',
  })
  const code = new URL(authorized.headers.get('location') ?? '', ID_ORIGIN).searchParams.get('code')
  if (!code) throw new Error(`QA-${n} /authorize: ${authorized.status}, no code`)
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: 'estiva-peek',
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })
  const body = (await res.json()) as {
    access_token: string
    expires_in?: number
  }
  if (!res.ok) throw new Error(`QA-${n} /token: ${res.status} ${JSON.stringify(body)}`)
  return {
    accessToken: body.access_token,
    pubkey: session.pubkey,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
}

type Written = { ok: true; id: string } | { ok: false; reason: string }

/** Every write goes through here: paced, logged, and fatal when refused, so a rate limit stops the run instead of thinning the fixture. */
async function write(label: string, run: () => Promise<Written>): Promise<string> {
  if (dryRun) {
    console.log(`dry-run ${label}`)
    return '0'.repeat(64)
  }
  const result = await run()
  if (!result.ok) throw new Error(`${label}: ${result.reason}`)
  await sleep(PACE_MS)
  return result.id
}

async function findOrCreateTopic(title: string, owner: StoredToken, hasState: boolean): Promise<string> {
  const found = await queryRelay(
    RELAY_URL,
    [
      {
        kinds: [30840],
        authors: [owner.pubkey],
        '#h': [QA_FOLDER],
        limit: 500,
      },
    ],
    owner.accessToken,
    owner.pubkey,
  )
  if (!found.ok) throw new Error(`topic read refused: ${found.reason}`)
  const existing = found.events.find((e) => e.tags.some((t) => t[0] === 'title' && t[1] === title))
  if (existing) return `30840:${existing.pubkey}:${existing.tags.find((t) => t[0] === 'd')?.[1]}`
  if (dryRun) return `30840:${owner.pubkey}:dry-${title}`
  const created = await createTopicAsViewer({ folder: QA_FOLDER, title, hasState }, RELAY_URL, owner)
  if (!created.ok) throw new Error(`create ${title}: ${created.reason}`)
  await sleep(PACE_MS)
  return created.address
}

const naddrOf = (address: string) => {
  const [kind, pubkey, identifier] = address.split(':')
  return encodeNaddr({ kind: Number(kind), pubkey, identifier, relays: [] })
}

async function seedTopic(address: string, title: string, other: string, people: [StoredToken, StoredToken]) {
  const [qa1] = people
  const container = { kind: 'file' as const, address, h: QA_FOLDER }
  const read = await queryRelay(RELAY_URL, [{ kinds: [1111], '#A': [address], limit: 2000 }], qa1.accessToken, qa1.pubkey)
  if (!read.ok) throw new Error(`#A read refused: ${read.reason}`)
  const topLevel = read.events.filter((e) => !e.tags.some((t) => t[0] === 'e'))
  console.log(`${address.slice(-12)}: ${topLevel.length} top-level, ${read.events.length - topLevel.length} replies already`)
  // Resume after the highest number written, not the count: message 100 is deleted on purpose.
  const written = Math.max(0, ...topLevel.map((e) => Number(/^Message (\d+) of/.exec(e.content)?.[1] ?? 0)))

  let previous: FileComment | undefined
  for (let i = written + 1; i <= MESSAGES; i++) {
    const author = people[i % 2]
    let body =
      `Message ${i} of ${MESSAGES} in ${title}. ${i % 9 === 0 ? 'A longer one, so rows are not all one height: the quick brown fox jumps over the lazy dog, twice, and then once more for good measure.' : ''}`.trim()
    if (i === 40) body = `The ticket this topic exists for:\n\nnostr:${encodeNaddr({ ...SHIP_ISSUE, relays: [] })}`
    if (i === 80) body = `The other long topic:\n\nnostr:${naddrOf(other)}`
    if (i === 120 && previous)
      body = `Quoting the message before:\n\nnostr:${encodeNevent({ id: previous.id, pubkey: previous.author, kind: 1111, relays: [] })}`
    const id = await write(`${address.slice(-6)} #${i}`, () => commentAsViewer({ container, body }, RELAY_URL, author))
    const comment: FileComment = {
      id,
      author: author.pubkey,
      body,
      createdAt: Math.floor(Date.now() / 1000),
      kind: 1111,
    }

    if (i % 10 === 0) {
      for (let r = 1; r <= (i % 30 === 0 ? 3 : 1); r++) {
        const replier = people[(i + r) % 2]
        await write(`${address.slice(-6)} #${i} reply ${r}`, () =>
          commentAsViewer({ container, body: `Reply ${r} to message ${i}.`, parent: comment }, RELAY_URL, replier),
        )
      }
    }
    if (i % 7 === 0)
      await write(`${address.slice(-6)} #${i} react`, () =>
        reactAsViewer({ targetEventId: id, emoji: i % 14 === 0 ? '👍' : '🎉' }, RELAY_URL, people[(i + 1) % 2]),
      )
    if (i === 60)
      await write(`${address.slice(-6)} #${i} edit`, () => editCommentAsViewer({ container, targetEventId: id, body: `${body} (edited)` }, RELAY_URL, author))
    if (i === 100) await write(`${address.slice(-6)} #${i} delete`, () => deleteEventAsViewer(id, RELAY_URL, author))
    previous = comment
    if (i % 20 === 0) console.log(`${title}: ${i} of ${MESSAGES}`)
  }
}

export default async function main() {
  const qa1 = await qaToken(1)
  const qa2 = await qaToken(2)
  console.log(`QA-1 ${qa1.pubkey.slice(0, 8)}, QA-2 ${qa2.pubkey.slice(0, 8)}${dryRun ? ' (dry run)' : ''}`)
  const folder = (await listFoldersAsViewer(RELAY_URL, qa1)).find((f) => f.id === QA_FOLDER)
  if (!folder) throw new Error('QA-1 cannot see the QA Folder')
  const [a, b] = [await findOrCreateTopic(TITLES[0], qa1, folder.hasState), await findOrCreateTopic(TITLES[1], qa1, folder.hasState)]
  console.log(`A ${a}\nB ${b}`)
  await seedTopic(a, TITLES[0], b, [qa1, qa2])
  await seedTopic(b, TITLES[1], a, [qa1, qa2])
  console.log('done')
}
