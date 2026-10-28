/**
 * Browser-side client for `/sign` and Buzz's HTTP bridge (PEEK-106).
 *
 * It replaced `convex/nostr/bridge.ts` for every user-attributed path, and is
 * the only one since REM-7. The reason it exists is not architectural
 * neatness: **Convex surfaces function arguments in its dashboard logs**, so
 * every `estivaAccessToken` passed to an action is a bearer token — usable to
 * publish under that person's name — sitting in log retention for anyone with
 * dashboard access. Raising the access-token TTL to 3600s widened that window
 * six-fold.
 *
 * Ship never had the problem: `estivaIdSigner` calls `/sign` straight from the
 * browser, so its backend holds no user credential at all. This is Peek
 * reaching the same shape. The division of labour becomes:
 *
 *   1. Convex builds the **unsigned** event from its own rows — it has the data
 *      and needs no credential to shape it
 *   2. the browser signs it via `/sign` and POSTs it to the relay — it has the
 *      token and it is the only place the token belongs
 *   3. Convex records the resulting event id — a fact, not a secret
 *
 * Both endpoints are CORS-open to `peek.estiva.app`, verified against the live
 * services rather than assumed.
 *
 * **The tag layout is deliberately not re-implemented here**, and neither is the
 * relay's answer. Both come from `@estiva-app/protocol`, because both are part
 * of what the relay judges: the tag layout is the event id preimage, and reading
 * `200 {"accepted":false}` as a success is a way to fail that no test notices.
 * A second copy of either would not be duplication, it would be a silent
 * divergence the relay notices and we do not.
 *
 * That was true before SHA-3 too — this file already imported the builders
 * rather than copying them — but the copy it imported *from* was one of three.
 * `convex/nostr/` held Peek's, `ship/lib/nostr/` held Ship's, and the two had
 * already drifted on `buildMessage`. The package is that sentence applied across
 * repositories instead of only within one.
 *
 * The `/sign` round trip moved into `@estiva-app/identity` with SHA-4, which is
 * what this file said would happen. What is left of it here is Peek's *binding*
 * of it — the identity origin, and the positional signature thirteen files
 * already call.
 */
import {
  authorizationHeaderFor,
  buildUnsignedAuthEvent,
  isRelayBusyResponse,
  parsePublishResponse,
  parseQueryResponse,
  RELAY_BUSY_MESSAGE,
  retryWhileBusy,
} from '@estiva-app/protocol'
import type { ReadLane } from '@estiva-app/platform'
import type { PublishResult, SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

/**
 * The pacer's lanes, and `first`: a file's first page while the person waits on
 * its placeholder (PEE-7) — a click's read that goes ahead of every other
 * (`socketRead.ts`, `socketFrames.ts`). Over HTTP it is a click's.
 */
export type QueryLane = ReadLane | 'first'
import { signViaEstivaId as signViaPackage } from '@estiva-app/identity'
import { ESTIVA_ID_ORIGIN } from '@/auth/estivaId'
import { relayBudget } from './relayBudget'
import { keepRelayAnswer } from './deviceCopy'
import { recordRelayRequest, refusalOf } from './relayMeter'

/**
 * Sign as the token's subject, over the package's round trip.
 *
 * `expectedPubkey` is not a request — `/sign` ignores any pubkey it is handed
 * and signs as the token's subject, always. It is a **check**, and the reason
 * one is needed at all: a mismatch comes back as HTTP 200 with a perfectly
 * valid event authored by somebody else. Without it the failure is invisible at
 * the call site and only shows up later as a message attributed to the wrong
 * person. `signWithIdentityService` keeps the same guard server-side; do not
 * drop either.
 *
 * **Peek's copy of this check was the only one of three that had it.** The other
 * two were `ship/lib/nostr/signer.ts` and its byte-identical twin in
 * `estiva-agent`, and neither compared the pubkey at all. That is what three
 * implementations of one call produce, and it is why SHA-4 collapsed them.
 *
 * Kept as a positional three-argument function rather than re-pointed at the
 * package's options object, because thirteen files call it and a rename across
 * thirteen files in the same commit as an auth change is how a real regression
 * hides in a diff nobody can read. The same reasoning `auth/estivaId.ts` gives
 * for its own re-exports.
 */
export type { PublishResult }

export async function signViaEstivaId(
  unsigned: UnsignedEvent,
  token: string,
  expectedPubkey?: string,
): Promise<SignedEvent> {
  return signViaPackage(unsigned, {
    base: ESTIVA_ID_ORIGIN,
    token,
    ...(expectedPubkey ? { expectedPubkey } : {}),
  })
}

/**
 * One authenticated POST to the bridge.
 *
 * The NIP-98 auth event goes through `/sign` too, not just the content. That is
 * the half that is easy to leave out and impossible to spot afterwards: an app
 * that can sign content but not auth holds a perfectly valid event the bridge
 * will not accept, and the seam looks finished.
 *
 * `pubkey` is left empty in the auth event for the same reason as the server
 * path — `/sign` overwrites it with the token's subject, and the guard above
 * rejects a mismatch.
 *
 * A relay too busy to answer is asked again quietly, as the protocol's own
 * client does, each time with fresh auth; the last answer comes back as it came.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-busy-relay-says-it-is-busy.md
 */
function bridgePost(
  relayUrl: string,
  path: string,
  payload: unknown,
  token: string,
  pubkey?: string,
): Promise<{ status: number; text: string }> {
  return retryWhileBusy(() => bridgePostOnce(relayUrl, path, payload, token, pubkey))
}

async function bridgePostOnce(
  relayUrl: string,
  path: string,
  payload: unknown,
  token: string,
  pubkey?: string,
): Promise<{ status: number; text: string }> {
  const url = `${relayUrl.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await signViaEstivaId(
    buildUnsignedAuthEvent({ pubkey: pubkey ?? '', url, method: 'POST', body }),
    token,
    pubkey,
  )
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  // Counted once the relay has answered, so the answer says whether this one
  // was refused, and why (PER-8, `window.__relayReads()`).
  const refusal = refusalOf(res.status, text)
  recordRelayRequest(path, payload, refusal)
  // Every quota refusal passes here, so this is where the tab learns the pause
  // the refresh triggers and `withRateLimitRetry` honour (PER-13). No reader
  // has to know about quotas.
  if (refusal) relayBudget.noteRateLimited(text)
  return { status: res.status, text }
}

/**
 * Publish one signed event.
 *
 * **HTTP 200 does not mean accepted** — the relay answers a duplicate channel
 * create with `200 {"accepted":false,…}`, so the `accepted` field is
 * authoritative and the status code alone would read rejections as successes.
 * Same parsing as the server client, and for the same measured reasons.
 */
export async function publishSigned(
  relayUrl: string,
  event: SignedEvent,
  token: string,
  pubkey?: string,
): Promise<PublishResult> {
  const { status, text } = await bridgePost(relayUrl, '/events', event, token, pubkey)
  if (isRelayBusyResponse(status, text)) return { ok: false, reason: RELAY_BUSY_MESSAGE, httpStatus: status }
  return parsePublishResponse(status, text)
}

/**
 * Run Nostr filters against the relay.
 *
 * Takes a **bare JSON array** of filters — sending a single filter object gets
 * `invalid type: map, expected a sequence`.
 *
 * A non-member read is answered `403 relay_membership_required`, which is why
 * reads are viewer-driven in the first place: there is no backend identity that
 * can see anything.
 */
export async function queryRelay(
  relayUrl: string,
  filters: Record<string, unknown>[],
  token: string,
  pubkey?: string,
  /**
   * `ahead` for what Desk loads before it is asked for (PEE-5): after every click, over HTTP only when the reader lets
   * it. A function when the person may join the read while it waits: asked again then, and `click` sends it at once.
   */
  lane: QueryLane | (() => QueryLane) = 'click',
): Promise<{ ok: boolean; events: SignedEvent[]; reason?: string }> {
  const laneNow = typeof lane === 'function' ? lane : () => lane
  const asked = laneNow()
  if (!socketReader && asked === 'ahead') return { ok: false, events: [], reason: 'ahead: no socket reader' }
  const click = asked !== 'ahead'
  if (click) clickReads.open += 1
  let answer: { ok: boolean; events: SignedEvent[]; reason?: string } | null
  try {
    answer = socketReader ? await socketReader(relayUrl, filters, pubkey, { lane: asked }) : null
    if (!answer) {
      const release = asked === 'ahead' ? await aheadPost(() => laneNow() !== 'ahead') : null
      try {
        const { status, text } = await bridgePost(relayUrl, '/query', filters, token, pubkey)
        answer = isRelayBusyResponse(status, text)
          ? { ok: false, events: [], reason: RELAY_BUSY_MESSAGE }
          : parseQueryResponse(status, text)
      } finally {
        release?.()
      }
    }
  } finally {
    if (click) {
      clickReads.open -= 1
      clickReads.lastAt = Date.now()
    }
  }
  // Every answer is also the copy a reload draws from, and its correction (PEE-2).
  if (answer.ok) keepRelayAnswer(relayUrl, filters, pubkey, answer.events)
  return answer
}

/**
 * Answers a read over the tab's open connection, or `null` to send it over
 * HTTP as before (OPT-2, `socketRead.ts`).
 *
 * A seam rather than an import: the reader needs the live client, which needs
 * `signViaEstivaId` from here, and the app installs it at boot (`main.tsx`) so
 * a test that reads through this file keeps the HTTP path it was written for.
 */
export type SocketReader = ((
  relayUrl: string,
  filters: Record<string, unknown>[],
  pubkey?: string,
  options?: { lane?: QueryLane },
) => Promise<{ ok: boolean; events: SignedEvent[]; reason?: string } | null>) & {
  /** Move the `ahead` reads still waiting into the click lane (PEE-5): the person just acted. */
  promoteAhead?(): void
}

let socketReader: SocketReader | null = null

/**
 * One `ahead` read over HTTP at a time (PEE-5). Each is a `/sign` round trip to
 * Estiva ID and then the POST; a spilled pack of ten sent at once queued ahead
 * of a click's own spilled reads, and of any write, at `/sign`.
 */
let aheadPosting = false

async function aheadPost(joined: () => boolean): Promise<() => void> {
  const until = Date.now() + AHEAD_HTTP_WAIT_AT_MOST_MS
  for (;;) {
    // The person has since asked for this very read and waits on it: it is theirs, and goes now.
    if (joined()) return () => {}
    // Otherwise only once the person's reads have been quiet a while, not merely after a press: one on the wire
    // cannot be taken back, and a click 1 s after Desk that found one there drew 200–300 ms later (QA-1 and QA-2).
    const quiet = clickReads.open === 0 && Date.now() - clickReads.lastAt >= AHEAD_HTTP_QUIET_MS
    if (!aheadPosting && (quiet || Date.now() >= until)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  aheadPosting = true
  return () => {
    aheadPosting = false
  }
}

/** How long the `click` lane is quiet before the loader's next HTTP read goes, and the longest it waits for that (PEE-5). */
const AHEAD_HTTP_QUIET_MS = 2_000
const AHEAD_HTTP_WAIT_AT_MOST_MS = 8_000

/** The reads in the `click` lane not yet answered, socket or HTTP, and when the last one was (PEE-5). */
const clickReads = { open: 0, lastAt: 0 }

/**
 * Resolves once no `click` read has been open for `quietMs`, or after `atMostMs`
 * (PEE-5): for loader work that is not a read of its own — tracking Folders
 * opens their live watches, whose frames take the same window a click's reads
 * need. Desk's cadence reads keep the lane from ever being quiet for long, so
 * this only lets a click that is under way finish first.
 */
export async function whenClickReadsQuiet(quietMs: number, atMostMs: number): Promise<void> {
  const until = Date.now() + atMostMs
  while (Date.now() < until) {
    if (clickReads.open === 0 && Date.now() - clickReads.lastAt >= quietMs) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** The reader the app installed, for Desk's loader to promote its reads when the person acts (PEE-5). */
export function getSocketReader(): SocketReader | null {
  return socketReader
}

export function setSocketReader(reader: SocketReader | null): void {
  socketReader = reader
}
