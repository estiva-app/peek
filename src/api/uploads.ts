/**
 * File-upload writes — the composer's attach flow (Phase 5).
 *
 * Mirrors the avatar upload (profile.ts): ask Convex for a short-lived upload
 * URL, POST the blob, keep the returned storage id. The id + metadata then
 * ride into `messages.send`/`replies.send` as `fileAttachments`. Uploads need
 * real storage, so this is Convex-only (no-op path throws in mock mode — the
 * composer hides the attach button when `!hasConvex`, per the rule that an
 * action only appears where it can succeed).
 */
import { useConvex, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from './store'
import { validateFile, isImageAttachment } from '@/lib/fileAttachments'
import { validToken } from '@/auth/estivaId'
import { uploadBlob } from '@estiva-app/protocol'
import { signViaEstivaId } from '@/nostr/bridge'

/** An uploaded file, ready to attach to a message/reply. `previewUrl` is a
 *  local object URL for the optimistic window (images render before the
 *  server resolves the real storage URL). */
export interface UploadedFile {
  storageId: string
  name: string
  contentType: string
  size: number
  previewUrl?: string
  /**
   * The relay's copy — CON-12.
   *
   * Absent when the blob upload failed or there was no token. The message still
   * sends and Peek still renders it from Convex; what is missing is every
   * *other* reader, which is the whole point of carrying these.
   */
  sha256?: string
  mediaUrl?: string
  thumbUrl?: string
  dim?: string
  /**
   * Why the relay has no copy, when it has none — CON-12.
   *
   * The file still attaches and the message still sends; what is lost is every
   * *other* reader. That consequence has to reach the person **before** they
   * press send, which is what this carries: the first version of this path
   * swallowed the failure to a `console.warn`, and the result was a message
   * that looked complete in Peek and arrived in Ship with nothing on it.
   * Nobody was told, on either side.
   */
  shareError?: string
}

export function useUploadActions() {
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl)
  const deleteUploadRemote = useMutation(api.messages.deleteUpload)
  // The client rather than a `useQuery`: the relay origin is wanted once, when
  // a file is actually uploaded, and a live subscription here would open one in
  // every component that can attach. A first version used `useQuery` and left
  // an unhandled cross-realm Event error behind in the full suite — visible
  // only there, because the file's own tests pass either way.
  const convex = useConvex()

  return {
    /** Clean up a blob that was uploaded but removed before sending. */
    deleteUpload(storageId: string) {
      if (hasConvex) void deleteUploadRemote({ storageId: storageId as never })
    },

    /** Upload one file and return its descriptor. Throws with a user-facing
     *  message on a rejected type/size or a failed request. */
    async uploadFile(file: File): Promise<UploadedFile> {
      const err = validateFile(file)
      if (err) throw new Error(err)
      if (!hasConvex) throw new Error('File uploads need the live app.')
      const uploadUrl = await generateUploadUrl({})
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) throw new Error('Upload failed — please try again.')
      const { storageId } = (await res.json()) as { storageId: string }

      /*
        And to the relay — CON-12.

        Deliberately **as well as** Convex, not instead of it. Peek renders from
        its own copy and this change does not touch that; what the relay's copy
        buys is every other reader. Doing both means a relay that refuses costs
        nobody their message.

        Attempted here, at attach time, rather than at send: ingest refuses a
        message whose blob it does not already hold, so the bytes must land
        first — and a person waiting is waiting while they type rather than
        after they press Enter.

        A failure does not refuse the attachment. Declining to attach a file
        because a mirror is down is worse than an attachment only Peek can see.

        **It is not silent, though, and the first version of this was.** It
        swallowed the failure to a `console.warn` on the reasoning that the
        omission would be evident where the message is sent. It is not evident
        anywhere: `unsignedMessage` omits an `imeta` it has no blob for without
        complaint, Peek renders the file from its own copy, and the sender sees
        a complete message. Miky posted an image on 2026-09-08 and Ship showed
        nothing; the event was on the relay with no `imeta`, and neither app
        said a word. So the reason comes back with the file and the chip says
        it — before send, while the person can still act on it.
      */
      const relayUrl = (await convex.query(api.nostr.config.relayConfig, {}))?.relayUrl
      const token = validToken()
      let blob: Awaited<ReturnType<typeof uploadBlob>> | undefined
      let shareError: string | undefined
      if (relayUrl && token) {
        try {
          blob = await uploadBlob({
            relayUrl,
            bytes: await file.arrayBuffer(),
            contentType: file.type || undefined,
            filename: file.name,
            sign: (unsigned) => signViaEstivaId(unsigned, token.accessToken, token.pubkey),
            pubkey: token.pubkey,
          })
        } catch (error) {
          shareError = error instanceof Error ? error.message : String(error)
          console.warn('[nostr] attachment not uploaded to the relay:', error)
        }
      } else {
        shareError = token ? 'this deployment publishes nothing' : 'not signed in'
        console.warn('[nostr] attachment not uploaded to the relay:', shareError)
      }

      return {
        storageId,
        name: file.name,
        contentType: file.type || '',
        size: file.size,
        previewUrl: isImageAttachment(file.name, file.type) ? URL.createObjectURL(file) : undefined,
        sha256: blob?.sha256,
        mediaUrl: blob?.url,
        thumbUrl: blob?.thumb,
        dim: blob?.dim,
        shareError,
      }
    },
  }
}
