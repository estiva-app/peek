/**
 * File-upload writes — the composer's attach flow (Phase 5).
 *
 * The bytes go to the relay's blob store and nowhere else, and the descriptor
 * carries what the `imeta` names. A failed upload fails the attachment: a
 * relay message has no other copy for it to fall back on.
 *
 * There used to be a second destination, Convex, with the blob store as a
 * mirror beside it (CON-12); DMs used it until REM-1, and it went with Convex
 * in REM-7.
 *
 * An upload needs somewhere real to go, so it throws in mock mode, and
 * `useCanUpload` hides the attach button there, per the rule that an action
 * only appears where it can succeed.
 */
import { RELAY_URL, hasRelay } from './relayUrl'
import { validateFile, isImageAttachment } from '@/lib/fileAttachments'
import { validToken } from '@/auth/estivaId'
import { uploadBlob } from '@estiva-app/protocol'
import { signViaEstivaId } from '@/nostr/bridge'

/** An uploaded file, ready to attach to a message/reply. `previewUrl` is a
 *  local object URL for the optimistic window (images render before the
 *  server resolves the real storage URL). */
export interface UploadedFile {
  name: string
  contentType: string
  size: number
  previewUrl?: string
  /** The relay's copy — what the message's `imeta` names. */
  sha256: string
  mediaUrl: string
  thumbUrl?: string
  dim?: string
}

/** Whether attaching can succeed here — the attach button and paste read it. */
export function useCanUpload(): boolean {
  return hasRelay
}

export function useUploadActions() {
  return {
    /** Upload one file and return its descriptor. Throws with a user-facing
     *  message on a rejected type/size or a failed request. */
    async uploadFile(file: File): Promise<UploadedFile> {
      const err = validateFile(file)
      if (err) throw new Error(err)
      if (!RELAY_URL) throw new Error('File uploads need the live app.')
      const token = validToken()
      if (!token) throw new Error('Sign in again to attach files.')

      let blob: Awaited<ReturnType<typeof uploadBlob>>
      try {
        blob = await uploadBlob({
          relayUrl: RELAY_URL,
          bytes: await file.arrayBuffer(),
          contentType: file.type || undefined,
          filename: file.name,
          sign: (unsigned) => signViaEstivaId(unsigned, token.accessToken, token.pubkey),
          pubkey: token.pubkey,
        })
      } catch (error) {
        console.warn('[nostr] attachment not uploaded to the relay:', error)
        throw new Error(`Upload failed — ${error instanceof Error ? error.message : String(error)}`)
      }
      /*
        Size and type are the store's, not the picked file's. The store
        canonicalizes an image before it keeps it — metadata goes — so the
        bytes it holds can be a few dozen fewer than the ones picked, and
        ingest refuses an `imeta` whose `size` or `m` disagrees with what it
        stored: "invalid: imeta size (50361) does not match stored size
        (50340)". The same lesson as DMS-7's republish.
      */
      return {
        name: file.name,
        contentType: blob.type || file.type || '',
        size: blob.size,
        previewUrl: isImageAttachment(file.name, file.type) ? URL.createObjectURL(file) : undefined,
        sha256: blob.sha256,
        mediaUrl: blob.url,
        thumbUrl: blob.thumb,
        dim: blob.dim,
      }
    },
  }
}
