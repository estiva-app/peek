/**
 * Reading an attachment another app put on the relay — CON-12.
 *
 * The mirror of the upload in `api/uploads.ts`, and the half that had no
 * implementation here at all: peek#177 taught Peek to *publish* `imeta`, and
 * until CON-12 step 3 nothing read one back, so a file attached in Ship
 * reached Peek as a message with nothing on it.
 *
 * ## Why an `<img src>` cannot do this
 *
 * Media GET on the relay is **unconditionally authenticated**: `get_blob`
 * calls `authenticate_media_read` before it touches storage, and the
 * `BUZZ_REQUIRE_MEDIA_GET_AUTH` flag that reads like an opt-in is inert. A GET
 * with no header answers 401 rather than the bytes. An `img` tag sends no
 * header and cannot be given one, so the only way to draw one of these is to
 * sign a `kind:24242`, fetch, and hand the browser an object URL.
 *
 * `fetchBlob` is the package's, not a local fetch, because each way to get it
 * wrong fails as a 401 that reads like a session problem — and one of them is
 * genuinely surprising: a thumbnail authorizes against its **parent** hash,
 * since the relay splits `sha256_ext` on the first dot. `<sha>.thumb.jpg`
 * needs an `x` of `<sha>`; splitting on the last dot yields `<sha>.thumb`,
 * a blob that does not exist. Ship reads them the same way, through the same
 * function.
 *
 * ## Caching, and why it is by URL
 *
 * A card re-renders on every reactive read and a message's files do not
 * change, so the same URL is the same bytes for ever — it is content-addressed
 * and the relay says `immutable`. One in-flight promise per URL therefore also
 * collapses the burst of identical requests a first render makes.
 *
 * Object URLs are **not revoked**: the blob has to outlive every card that
 * might draw it, this cache is the only reference to it, and a revoked URL
 * renders as a broken image. The bound is {@link CACHE_LIMIT}, past which
 * nothing new is cached and fetches simply repeat.
 */
import { fetchBlob } from '@estiva-app/protocol'
import { signViaEstivaId } from './bridge'
import { validToken } from '@/auth/estivaId'
import { RELAY_URL } from '@/api/relayUrl'

/** Distinct blobs held as object URLs before new ones stop being cached. */
export const CACHE_LIMIT = 64

const cache = new Map<string, Promise<string>>()

/**
 * An object URL for one relay-hosted attachment, fetched with the viewer's own
 * authorization.
 *
 * Rejects rather than resolving to a placeholder. The caller draws the failure,
 * and a silent placeholder would make "you are not in that channel" look
 * identical to "there is no image" — which is the reading a person would take
 * from a gap, and the wrong one.
 */
export function blobObjectUrl(mediaUrl: string): Promise<string> {
  const held = cache.get(mediaUrl)
  if (held) return held

  const pending = (async () => {
    /*
      Absolute, because the relay rewrote it for the tenant before it ever
      reached an `imeta` — `url` in a BUD-02 descriptor comes back ready to
      publish. A relative one would have to be resolved against a relay origin
      this module does not know, and guessing would send a signed authorization
      to the wrong host. Say so instead.
    */
    if (!/^https?:\/\//.test(mediaUrl)) throw new Error(`not an absolute media url: ${mediaUrl}`)
    /*
      Only this workspace's relay is sent a signed authorization (COM-2 security
      review). A media URL comes from somebody else's event — an `imeta`, or an
      attachment block in a description another member wrote — and nothing on
      the relay checks its host, so any other origin would receive the viewer's
      replayable get-token for the asking.
    */
    if (!RELAY_URL || new URL(mediaUrl).origin !== new URL(RELAY_URL).origin) {
      throw new Error(`not this relay's media: ${new URL(mediaUrl).origin}`)
    }
    const token = validToken()
    if (!token) throw new Error('not signed in')

    const { bytes, contentType } = await fetchBlob({
      relayUrl: new URL(mediaUrl).origin,
      url: mediaUrl,
      sign: (unsigned) => signViaEstivaId(unsigned, token.accessToken, token.pubkey),
      pubkey: token.pubkey,
    })
    // The type is the server's say-so, and a blob: URL opens in Peek's origin:
    // `text/html` from anywhere would run as Peek. Pictures and PDFs keep their
    // type so they preview; anything else downloads as bytes.
    return URL.createObjectURL(new Blob([bytes], { type: safeBlobType(contentType) }))
  })()

  // A failure is not cached: the usual cause is an expired token, and the next
  // render is exactly when a renewed one would work.
  pending.catch(() => cache.delete(mediaUrl))
  if (cache.size < CACHE_LIMIT) cache.set(mediaUrl, pending)
  return pending
}

/** A served type a blob: URL may carry: a raster or video picture, or a PDF; otherwise opaque bytes. */
export function safeBlobType(contentType: string | undefined): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (/^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm)|application\/pdf)$/.test(type)) return type
  return 'application/octet-stream'
}

/** Test seam — the cache is module state and a suite must not inherit it. */
export function clearBlobCache(): void {
  cache.clear()
}
