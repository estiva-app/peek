/**
 * Putting a file where another app can read it — CON-12.
 *
 * Peek's attachments lived in Convex storage, addressed by a `storageId` that
 * means nothing outside this deployment. So a screenshot posted here reached
 * Ship, the agent and every future app as a message with **nothing on it** —
 * not a broken image, not a marker, nothing. ADR 0001 names the rule it broke:
 * Convex may never be the source of truth for something the relay owns.
 *
 * The relay has hosted blobs the whole time. This is Peek finally using it.
 *
 * ## Content-addressed, which decides the order
 *
 * A blob is its own sha256. Ingest runs `verify_imeta_blobs` and **refuses a
 * message whose blob it does not already hold**, so the upload has to land
 * before the message that names it. That is a constraint worth being glad
 * about: a dangling attachment reference cannot be published at all.
 *
 * ## Reading one back is not free either
 *
 * `GET /media/…` is **unconditionally authenticated** on the deployed relay —
 * the `BUZZ_REQUIRE_MEDIA_GET_AUTH` flag reads like an opt-in and is inert.
 * So an `<img src>` can never fetch one; a reader must sign a `get`
 * authorization, fetch, and make an object URL. That is why the grant covers
 * Ship as well as Peek, and it is the whole of SHI-1's screenshot half.
 */
import { buildBlossomAuth, blossomAuthHeader } from '@estiva-app/protocol'
import { signViaEstivaId } from './bridge'

/** What the relay hands back once it holds the bytes (BUD-02 descriptor). */
export interface UploadedBlob {
  /** Relay-local. Goes into `imeta` as `url`, which the relay checks is local. */
  url: string
  sha256: string
  size: number
  /** MIME, as the relay stored it — `imeta`'s `m` must equal this exactly. */
  type: string
  /** `<width>x<height>`, computed by the relay rather than by us. */
  dim?: string
  /** The relay's generated thumbnail, when it made one. */
  thumb?: string
}

/** A file's sha256, lowercase hex — its identity everywhere below. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Upload one file to the relay and return what it stored.
 *
 * The hash is computed here rather than taken from the response, because it is
 * what the authorization has to name: BUD-11 requires the `x` tag to match, so
 * the client must know the digest *before* it can ask permission to send the
 * bytes.
 *
 * Throws with the relay's own words. The caller decides what that means — for a
 * message being sent it is not fatal, since the Convex row still holds the file
 * and Peek still renders it; what is lost is every *other* reader.
 */
export async function uploadBlob(
  relayUrl: string,
  file: File,
  token: { accessToken: string; pubkey: string },
): Promise<UploadedBlob> {
  const bytes = await file.arrayBuffer()
  const sha256 = await sha256Hex(bytes)

  const auth = await signViaEstivaId(
    buildBlossomAuth(token.pubkey, Date.now(), {
      verb: 'upload',
      sha256,
      reason: `Upload ${file.name}`,
    }),
    token.accessToken,
    token.pubkey,
  )

  const response = await fetch(`${relayUrl.replace(/\/+$/, '')}/upload`, {
    method: 'PUT',
    headers: {
      authorization: blossomAuthHeader(auth),
      // BUD-11 makes this mandatory on PUT /upload — the relay checks the bytes
      // against it rather than trusting either side's arithmetic.
      'x-sha-256': sha256,
      'content-type': file.type || 'application/octet-stream',
    },
    body: bytes,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`upload failed: ${response.status} ${detail.slice(0, 200)}`)
  }

  const descriptor = (await response.json()) as Partial<UploadedBlob> & { sha256?: string }
  // The relay rewrites the descriptor's URLs for the tenant, so `url` and
  // `thumb` come back ready to put in an `imeta` — no host assembly here.
  if (!descriptor.url || !descriptor.sha256) {
    throw new Error('upload returned no blob descriptor')
  }
  return {
    url: descriptor.url,
    sha256: descriptor.sha256,
    size: descriptor.size ?? file.size,
    type: descriptor.type ?? file.type,
    dim: descriptor.dim,
    thumb: descriptor.thumb,
  }
}
