/**
 * App-private, user-owned storage on `kind:30078` — SPEC §12 (CRO-11).
 *
 * Layer 2: state only Peek reads, that the person still owns, exports and takes
 * with them. Not layer 1 (nothing else needs to see it) and not layer 3 (it
 * needs no query, index or server-side compute).
 *
 * ## Why this is not in `@estiva-app/protocol`
 *
 * It very nearly is: the `d`-tag grammar and the `t` tag are conventions the
 * whole suite follows, which is the package's usual test. But the *shape of a
 * blob* is interpretation, and the encryption seam runs through Estiva ID, which
 * is `@estiva-app/identity`'s territory rather than protocol's. So this file is
 * Peek's, and the convention it obeys lives in the spec instead of in a package.
 * If a second app grows a layer-2 store, the `blobAddress`/`blobTag` helpers are
 * what should move — not the payloads.
 *
 * ## The size limit is not the one the spec calls operative
 *
 * SPEC §12.5 lists four numbers and says the binding one is the relay's 256 KiB
 * ingest cap. For an app that holds no keys — which is every Estiva app — there
 * is a fifth and tighter one: **`POST /nip44/encrypt` refuses a plaintext over
 * 65535 bytes of UTF-8.** Ciphertext is larger than plaintext, so the relay's cap
 * is never the one you hit first. That is the limit enforced here.
 *
 * ## Last write wins, and this file accepts the loss knowingly
 *
 * §12.3 requires an app to say which it chose. Peek chooses **accept**, not a
 * convergent structure with per-installation slots. Two tabs toggling a star in
 * the same second can lose one, and the cost of that is one star, recoverable by
 * clicking again. NIP-RS pays for slots because a lost read marker is invisible;
 * a lost star is not.
 */
import { ESTIVA_ID_ORIGIN } from '@/auth/estivaId'

/**
 * Peek's Estiva ID `client_id`, which SPEC §12.2 makes the `d`-tag prefix so two
 * apps cannot collide by construction. Not `peek` — the registered id is
 * `estiva-peek`, and the prefix has to be the registered one for that guarantee
 * to hold.
 */
export const APP_ID = 'estiva-peek'

/** `POST /nip44/encrypt` refuses a plaintext over this many bytes of UTF-8. */
export const MAX_PLAINTEXT_BYTES = 65535

/** `d` for a layer-2 store: `<client_id>:<name>:v<n>` (SPEC §12.2). */
export function blobAddress(name: string, version = 1): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`app-data name must be lowercase kebab, got "${name}"`)
  }
  return `${APP_ID}:${name}:v${version}`
}

/**
 * The single `t` tag, so a reader filters by `#t` instead of fetching every
 * `kind:30078` the person owns — the same reason NIP-RS carries
 * `["t","read-state"]`.
 */
export const BLOB_TAG = `${APP_ID}-appdata`

/**
 * Guard against the `d` prefix that would hand the blob to the relay's NIP-RS
 * path, which hard-deletes superseded events at the coordinate (SPEC §11.6).
 * Unreachable through {@link blobAddress}; here because the cost of being wrong
 * is silent data loss rather than an error.
 */
export function assertNotReadState(d: string): void {
  if (d.startsWith('read-state:')) {
    throw new Error(
      `"${d}" would be treated as a NIP-RS read-state slot, whose superseded blobs the relay hard-deletes. Never use that prefix for app data.`,
    )
  }
}

async function nip44(op: 'encrypt' | 'decrypt', body: object, token: string): Promise<unknown> {
  const response = await fetch(`${ESTIVA_ID_ORIGIN}/nip44/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    // 429 is a real case: the endpoint allows 120 operations per minute per app
    // per person, and a person toggling stars quickly can reach it.
    throw new Error(`POST /nip44/${op} failed: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

/**
 * Self-encrypt, and refuse rather than truncate.
 *
 * §12.4: the relay serves any `kind:30078` by author, so an unencrypted blob is
 * readable by every app the person signs into. Encryption is what makes
 * "app-private" true rather than aspirational.
 */
export async function encryptBlob(plaintext: string, token: string): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext).length
  if (bytes > MAX_PLAINTEXT_BYTES) {
    throw new Error(
      `app-data blob is ${bytes} bytes, over the ${MAX_PLAINTEXT_BYTES}-byte plaintext limit /nip44/encrypt enforces. A blob is not a table (SPEC §12.3).`,
    )
  }
  const { ciphertext } = (await nip44('encrypt', { plaintext }, token)) as { ciphertext: string }
  return ciphertext
}

/**
 * Decrypt, returning `undefined` for anything unreadable rather than throwing.
 *
 * A blob that will not decrypt costs the state it held, never the read that
 * asked for it — the same rule `parseProfile` follows for a malformed `kind:0`.
 * The realistic cause is a blob written under a rotated key, not corruption.
 */
export async function decryptBlob(ciphertext: string, token: string): Promise<string | undefined> {
  try {
    const { plaintext } = (await nip44('decrypt', { ciphertext }, token)) as { plaintext: string }
    return plaintext
  } catch {
    return undefined
  }
}
