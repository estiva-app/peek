/**
 * Publish a NIP-RS read-state blob and read it back (CRO-4).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/probe-read-state.ts
 *
 * CRO-4's done-when is explicit that the check is **reading the blob back**,
 * not reasoning about the call — so this is the evidence, and the unit suite is
 * not. Four things are only answerable against the live relay and Estiva ID:
 *
 *   1. the identity may sign `kind:30078` at all (the ceiling that has failed
 *      three shipped features at the last step);
 *   2. `/nip44/encrypt` → publish → `/query` → `/nip44/decrypt` round-trips to
 *      the same contexts;
 *   3. the relay accepts the §11.6 shape — exactly one `d`, exactly one
 *      `["t","read-state"]` — and a blob that misses it is stored silently as
 *      an ordinary event rather than refused, which is why the negative control
 *      below exists;
 *   4. **advancing a thread leaves the container marker where it was**, read
 *      off the relay rather than out of a local object;
 *   5. **the ceiling is where the code believes it is** (SHR-4) — a blob at the
 *      byte cap is accepted by `/nip44/encrypt` and one context more is refused.
 *      That leg is not kind-gated and writes nothing, so it runs first.
 *
 * It writes to production. What it writes is one NIP-RS slot for whichever
 * identity the credentials name, self-encrypted, at a random slot id — private
 * to that identity, replaceable, and not attached to any channel.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { MAX_BLOB_BYTES, MAX_CLIENT_ID_BYTES, MAX_CONTEXTS_BYTES, advanceContexts, buildReadStateEvent, capContextsToBytes, parseReadStateBlob, readStateDTag, serializeReadStateBlob, type ReadStateBlob, allSlotsFilter, mergeSlots, type SlotBlob } from '@estiva-app/conversation'
import { readStateSlotFilter } from '../src/nostr/readState'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

/** A channel uuid and two event ids that exist nowhere — contexts need no referent. */
const CONTAINER = 'f1e2d3c4-b5a6-4978-8b1c-2d3e4f5a6b7c'
const THREAD = `thread:${'1'.repeat(64)}`
const randomSlot = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Two slots for one identity — which is exactly what "two installations" means
 * to NIP-RS (CRO-5's done-when says two browsers is *enough*, not required).
 * SLOT is this run's "Peek"; SLOT_B is its "Ship".
 */
const SLOT = randomSlot()
const SLOT_B = randomSlot()

let failures = 0
function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}

async function token(): Promise<{ accessToken: string; pubkey: string; maySign: boolean }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — Estiva ID's /token is not an OAuth-shaped snake_case body,
    // and a snake_case one comes back "401 No session cookie", which reads as a
    // credential problem rather than a schema one.
    body: JSON.stringify({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
  // `/token` returns the live ceiling, which reads it without touching the box.
  const maySign = (body.allowed_kinds ?? []).includes(30078)
  check(
    'identity may sign kind:30078',
    maySign,
    `allowed_kinds = ${JSON.stringify(body.allowed_kinds ?? [])}`,
  )
  return { accessToken: body.access_token, pubkey: body.pubkey, maySign }
}

async function nip44<T>(op: 'encrypt' | 'decrypt', body: object, accessToken: string): Promise<T> {
  const res = await fetch(`${ID_ORIGIN}/nip44/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST /nip44/${op}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
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

async function bridge(path: string, payload: unknown, t: { accessToken: string; pubkey: string }) {
  const url = `${RELAY_URL.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(
    buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }),
    t.accessToken,
  )
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

/**
 * Ask `/nip44/encrypt` about a plaintext without throwing on a refusal (SHR-4).
 *
 * The ordinary helper above throws, which is right for every other leg and
 * wrong for this one: whether the seam refuses is the answer being measured.
 */
async function encryptStatus(
  plaintext: string,
  accessToken: string,
): Promise<{ accepted: boolean; status: number; detail: string }> {
  const res = await fetch(`${ID_ORIGIN}/nip44/encrypt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ plaintext }),
  })
  const text = await res.text()
  return { accepted: res.ok, status: res.status, detail: text.slice(0, 120) }
}

/**
 * The byte cap, against the seam that enforces it (SHR-4).
 *
 * Not checkable from a unit suite, and the reason this leg exists: 65,535 is a
 * number in a document until `/nip44/encrypt` is asked, and SPEC §12.5 counts
 * four other candidates that look like the answer and are not. So the blob at
 * the cap is offered, and then **the same blob with one more context** — the
 * negative control, without which "accepted" is equally consistent with the
 * endpoint having no limit at all.
 *
 * Sized at the longest legal `client_id`, which is what the cap budgets for, so
 * an acceptance here covers every installation and not just this one. Two
 * encryptions against a budget of 120 a minute, and nothing is published.
 */
async function checkCeiling(t: { accessToken: string }): Promise<void> {
  console.log('\n— SHR-4: the byte cap, asked of the seam that enforces it —')
  const tooMany: Record<string, number> = {}
  for (let i = 0; i < 2_000; i++) tooMany[`thread:${i.toString(16).padStart(64, '0')}`] = 1_700_000_000 + i
  const capped = capContextsToBytes(tooMany)
  const clientId = 'x'.repeat(MAX_CLIENT_ID_BYTES)
  const atCap = serializeReadStateBlob({ v: 1, client_id: clientId, contexts: capped.contexts })
  const atCapBytes = new TextEncoder().encode(atCap).length
  check(
    `the cap leaves a blob inside the ceiling: ${atCapBytes} of ${MAX_BLOB_BYTES} bytes, ${Object.keys(capped.contexts).length} contexts`,
    atCapBytes <= MAX_BLOB_BYTES && capped.bytes <= MAX_CONTEXTS_BYTES,
  )

  const accepted = await encryptStatus(atCap, t.accessToken)
  check(
    'a blob at the cap is accepted by /nip44/encrypt',
    accepted.accepted,
    `${accepted.status} ${accepted.accepted ? '' : accepted.detail}`,
  )

  // One context past it — the control. Built by hand, because every path through
  // `readState.ts` would cap it back down, which is the point.
  const overflowing = serializeReadStateBlob({
    v: 1,
    client_id: clientId,
    contexts: { ...capped.contexts, [`thread:${'f'.repeat(64)}`]: 1_800_000_000 },
  })
  const overBytes = new TextEncoder().encode(overflowing).length
  const refused = await encryptStatus(overflowing, t.accessToken)
  check(
    `and one context more is refused: ${overBytes} bytes → ${refused.status}`,
    !refused.accepted,
    refused.accepted ? 'ACCEPTED — the ceiling is not where the code believes it is' : refused.detail,
  )
}

/** Publish one blob, returning what the relay actually said about it. */
async function publish(
  contexts: Record<string, number>,
  t: { accessToken: string; pubkey: string },
  clientId: string,
  slot: string = SLOT,
): Promise<{ accepted: boolean; reason?: string }> {
  const blob: ReadStateBlob = { v: 1, client_id: clientId, contexts }
  const { ciphertext } = await nip44<{ ciphertext: string }>(
    'encrypt',
    { plaintext: serializeReadStateBlob(blob) },
    t.accessToken,
  )
  const signed = await sign(buildReadStateEvent(t.pubkey, Date.now(), slot, ciphertext), t.accessToken)
  const { status, text } = await bridge('/events', signed, t)
  // HTTP 200 does not mean accepted — the `accepted` field is authoritative.
  const parsed = JSON.parse(text) as { accepted?: boolean; message?: string }
  if (status !== 200) return { accepted: false, reason: `${status} ${text}` }
  return { accepted: parsed.accepted === true, reason: parsed.message }
}

/** Read this slot back and decrypt it. */
async function readBack(
  t: { accessToken: string; pubkey: string },
  slot: string = SLOT,
): Promise<ReadStateBlob | undefined> {
  const { status, text } = await bridge('/query', [readStateSlotFilter(t.pubkey, slot)], t)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
  // `/query` answers with a **bare JSON array of events**, not `{events: [...]}`.
  // Reading `.events` off it yields undefined and therefore an empty result —
  // which looks exactly like "the slot is empty" and passes the negative control
  // while proving nothing. `parseQueryResponse` in the protocol package gets
  // this right; this script had its own copy and did not.
  const events = JSON.parse(text) as SignedEvent[]
  const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return undefined
  const { plaintext } = await nip44<{ plaintext: string }>(
    'decrypt',
    { ciphertext: newest.content },
    t.accessToken,
  )
  return parseReadStateBlob(plaintext)
}

/** Every read-state slot this identity owns, as `mergeSlots` wants them. */
async function fetchSlots(t: { accessToken: string; pubkey: string }): Promise<SlotBlob[]> {
  const { status, text } = await bridge('/query', [allSlotsFilter(t.pubkey, Date.now())], t)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
  // Bare array, as above.
  const events = JSON.parse(text) as SignedEvent[]
  const slots: SlotBlob[] = []
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
    if (!dTag?.startsWith('read-state:')) continue
    const { plaintext } = await nip44<{ plaintext: string }>(
      'decrypt',
      { ciphertext: event.content },
      t.accessToken,
    )
    const blob = parseReadStateBlob(plaintext)
    if (blob) slots.push({ dTag, eventId: event.id, createdAt: event.created_at, blob })
  }
  return slots
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Set ESTIVA_ID_CLIENT_ID and ESTIVA_ID_CLIENT_SECRET (set -a; . ~/.estiva-agent.env; set +a)')
    process.exit(1)
  }
  console.log(`relay      ${RELAY_URL}`)
  console.log(`identity   ${ID_ORIGIN}`)
  console.log(`slot       ${readStateDTag(SLOT)}\n`)

  const t = await token()
  console.log(`signing as ${t.pubkey}\n`)

  // First, and regardless of the kind ceiling: `/nip44/encrypt` is not
  // kind-gated, so this leg answers even with a credential that cannot sign
  // kind:30078 — and it publishes nothing.
  await checkCeiling(t)

  /*
   * The ceiling refuses before anything else is attempted, so say which leg is
   * unproven rather than reporting a green run that skipped the point. The
   * encryption round trip is still worth running: it is the half CRO-1 built,
   * it is not kind-gated, and it exercises the real serialized blob.
   */
  if (!t.maySign) {
    console.log(
      `\n⚠  This credential cannot sign kind:30078, so the publish and read-back\n` +
        `   legs cannot run here. Peek's own credential (estiva-peek) carries it\n` +
        `   from CRO-2 — run this with that identity, or from a browser session.\n` +
        `   Verifying the encryption round trip on the real blob instead.\n`,
    )
    const blob: ReadStateBlob = {
      v: 1,
      client_id: 'probe',
      contexts: advanceContexts({}, { [CONTAINER]: 1_700_000_000, [THREAD]: 1_700_009_999 }).contexts,
    }
    const plaintext = serializeReadStateBlob(blob)
    const { ciphertext } = await nip44<{ ciphertext: string }>('encrypt', { plaintext }, t.accessToken)
    const round = await nip44<{ plaintext: string }>('decrypt', { ciphertext }, t.accessToken)
    check('the serialized blob survives /nip44/encrypt → /nip44/decrypt', round.plaintext === plaintext)
    const parsed = parseReadStateBlob(round.plaintext)
    check(
      'it parses back to the BARE container uuid and the thread key',
      parsed?.contexts[CONTAINER] === 1_700_000_000 && parsed?.contexts[THREAD] === 1_700_009_999,
      JSON.stringify(parsed?.contexts),
    )
    check('no h:-prefixed key anywhere in it', !plaintext.includes('h:'))
    console.log(`\n${failures === 1 ? '⚠  blocked on the ceiling; everything reachable passed' : `❌ ${failures} check(s) failed`}`)
    process.exit(failures === 1 ? 0 : 1)
  }

  // --- negative control, first, so "it worked" is distinguishable ------------
  // Before anything is published, the coordinate must be empty. Without this a
  // blob left by an earlier run would read as this run's success.
  check('slot is empty before the first publish', (await readBack(t)) === undefined)

  // --- 1. publish a container marker ----------------------------------------
  const first = advanceContexts({}, { [CONTAINER]: 1_700_000_000 }).contexts
  const published = await publish(first, t, 'probe')
  if (!check('relay accepted the kind:30078 read-state blob', published.accepted, published.reason)) {
    process.exit(1)
  }

  const afterFirst = await readBack(t)
  check('blob reads back and decrypts to valid JSON', afterFirst !== undefined)
  check(
    'container context round-trips as the BARE uuid, unprefixed',
    afterFirst?.contexts[CONTAINER] === 1_700_000_000,
    JSON.stringify(afterFirst?.contexts),
  )
  check(
    'no h:-prefixed key was written',
    !Object.keys(afterFirst?.contexts ?? {}).some((k) => k.startsWith('h:')),
  )

  // --- 2. advance a thread; the container must not move ---------------------
  // SPEC §11.2, and the clause this whole ticket is judged on.
  const second = advanceContexts(afterFirst?.contexts ?? {}, { [THREAD]: 1_700_009_999 }).contexts
  const republished = await publish(second, t, 'probe')
  check('relay accepted the second blob', republished.accepted, republished.reason)

  const afterSecond = await readBack(t)
  check(
    'thread marker is on the relay',
    afterSecond?.contexts[THREAD] === 1_700_009_999,
    JSON.stringify(afterSecond?.contexts),
  )
  check(
    'marking a thread read left the container context UNTOUCHED',
    afterSecond?.contexts[CONTAINER] === 1_700_000_000,
    `container = ${afterSecond?.contexts[CONTAINER]}`,
  )

  // --- 3. monotonic: an older timestamp cannot be expressed ------------------
  const third = advanceContexts(afterSecond?.contexts ?? {}, { [CONTAINER]: 1 }).contexts
  check(
    'an older marker does not lower the stored one (§11.4)',
    third[CONTAINER] === 1_700_000_000,
    `container = ${third[CONTAINER]}`,
  )

  // --- 4. CRO-5: two slots converge, and a stale one cannot lower them -------
  console.log('\n— CRO-5: fetch every slot and merge —')

  // The second "installation" records the same container, later.
  const bPublished = await publish({ [CONTAINER]: 1_700_050_000 }, t, 'probe-b', SLOT_B)
  check('relay accepted the second installation’s slot', bPublished.accepted, bPublished.reason)

  const all = await fetchSlots(t)
  check('both slots come back from one #t query', all.length >= 2, `${all.length} slot(s)`)
  check(
    'the query asked only for this pubkey’s own slots',
    (allSlotsFilter(t.pubkey, Date.now()).authors as string[]).length === 1,
  )

  const merged = mergeSlots(all)
  check(
    'the merge takes the LATER container marker across installations',
    merged[CONTAINER] === 1_700_050_000,
    `container = ${merged[CONTAINER]}`,
  )
  check(
    'and keeps a context only one installation has',
    merged[THREAD] === 1_700_009_999,
    `thread = ${merged[THREAD]}`,
  )

  // Idempotence, on real data rather than a fixture.
  check('re-merging the same slots is the same answer', JSON.stringify(mergeSlots(all)) === JSON.stringify(merged))

  // A stale blob arriving late: republish slot B with an OLD timestamp.
  const stale = await publish({ [CONTAINER]: 1 }, t, 'probe-b', SLOT_B)
  check('relay accepted the stale republish', stale.accepted, stale.reason)
  const afterStale = mergeSlots(await fetchSlots(t))
  check(
    'a stale blob arriving late does NOT lower the merged frontier',
    afterStale[CONTAINER] === 1_700_000_000,
    `container = ${afterStale[CONTAINER]} (slot A still holds it)`,
  )

  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error('\n💥', error instanceof Error ? error.message : error)
  process.exit(1)
})
