/**
 * File-upload writes — the composer's attach flow (Phase 5).
 *
 * **Two destinations since REM-2**, chosen by the conversation the composer is
 * in rather than by the composer (`UploadDestinationProvider`):
 *
 * - `blobStore` — a file's conversation. The bytes go to the relay's blob store
 *   and nowhere else, and the descriptor carries what the `imeta` names. This
 *   path makes no Convex request at all. A failed upload fails the attachment:
 *   a relay-only comment has no other copy for it to fall back on.
 * - `convex` — the default, and what DMs still use until REM-1: ask Convex for
 *   a short-lived upload URL, POST the blob, keep the storage id, and mirror to
 *   the blob store as well (CON-12). The id + metadata then ride into
 *   `messages.send`/`replies.send` as `fileAttachments`.
 *
 * Either way an upload needs somewhere real to go, so it throws in mock mode,
 * and `useCanUpload` hides the attach button there, per the rule that an
 * action only appears where it can succeed.
 */
import { createContext, useContext } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from './store'
import { RELAY_URL, hasRelay } from './relayUrl'
import { validateFile, isImageAttachment } from '@/lib/fileAttachments'
import { validToken } from '@/auth/estivaId'
import { uploadBlob } from '@estiva-app/protocol'
import { signViaEstivaId } from '@/nostr/bridge'

/** An uploaded file, ready to attach to a message/reply. `previewUrl` is a
 *  local object URL for the optimistic window (images render before the
 *  server resolves the real storage URL). */
export interface UploadedFile {
  /** The Convex copy. Absent on a `blobStore` upload, which has none. */
  storageId?: string
  name: string
  contentType: string
  size: number
  previewUrl?: string
  /**
   * The relay's copy — CON-12.
   *
   * Always present on a `blobStore` upload. On a `convex` one, absent when the
   * blob upload failed or there was no token: the message still sends and Peek
   * still renders it from Convex; what is missing is every *other* reader,
   * which is the whole point of carrying these.
   */
  sha256?: string
  mediaUrl?: string
  thumbUrl?: string
  dim?: string
  /**
   * Why the relay has no copy, when it has none — CON-12. `convex` uploads only.
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

/** Where a composer's attachments go — see the file header. */
export type UploadDestination = 'convex' | 'blobStore'

const UploadDestinationContext = createContext<UploadDestination>('convex')

/**
 * Set by a conversation whose messages live only on the relay, around its
 * composer, its thread panel and its cards' edit boxes, so every attach path
 * inside it uploads to the blob store alone.
 */
export const UploadDestinationProvider = UploadDestinationContext.Provider

/** Whether attaching can succeed here — the attach button and paste read it. */
export function useCanUpload(): boolean {
  return useContext(UploadDestinationContext) === 'blobStore' ? hasRelay : hasConvex
}

type Token = NonNullable<ReturnType<typeof validToken>>

function putBlob(relayUrl: string, token: Token, file: File) {
  return file.arrayBuffer().then((bytes) =>
    uploadBlob({
      relayUrl,
      bytes,
      contentType: file.type || undefined,
      filename: file.name,
      sign: (unsigned) => signViaEstivaId(unsigned, token.accessToken, token.pubkey),
      pubkey: token.pubkey,
    }),
  )
}

export function useUploadActions() {
  const destination = useContext(UploadDestinationContext)
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl)
  const deleteUploadRemote = useMutation(api.messages.deleteUpload)

  return {
    /**
     * Clean up a blob that was uploaded but removed before sending.
     *
     * Only a Convex copy can be deleted. The blob store has no delete, so a
     * `blobStore` upload removed before send stays there unreferenced — as the
     * relay mirror of a `convex` upload always has.
     */
    deleteUpload(storageId: string | undefined) {
      if (hasConvex && storageId) void deleteUploadRemote({ storageId: storageId as never })
    },

    /** Upload one file and return its descriptor. Throws with a user-facing
     *  message on a rejected type/size or a failed request. */
    async uploadFile(file: File): Promise<UploadedFile> {
      const err = validateFile(file)
      if (err) throw new Error(err)
      const local = {
        name: file.name,
        contentType: file.type || '',
        size: file.size,
        previewUrl: isImageAttachment(file.name, file.type) ? URL.createObjectURL(file) : undefined,
      }

      if (destination === 'blobStore') {
        if (!RELAY_URL) throw new Error('File uploads need the live app.')
        const token = validToken()
        if (!token) throw new Error('Sign in again to attach files.')
        let blob: Awaited<ReturnType<typeof uploadBlob>>
        try {
          blob = await putBlob(RELAY_URL, token, file)
        } catch (error) {
          console.warn('[nostr] attachment not uploaded to the relay:', error)
          throw new Error(`Upload failed — ${error instanceof Error ? error.message : String(error)}`)
        }
        return { ...local, sha256: blob.sha256, mediaUrl: blob.url, thumbUrl: blob.thumb, dim: blob.dim }
      }

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

        Deliberately **as well as** Convex, not instead of it. Peek renders a DM
        from its own copy and this change does not touch that; what the relay's
        copy buys is every other reader. Doing both means a relay that refuses
        costs nobody their message.

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
      const token = validToken()
      let blob: Awaited<ReturnType<typeof uploadBlob>> | undefined
      let shareError: string | undefined
      if (RELAY_URL && token) {
        try {
          blob = await putBlob(RELAY_URL, token, file)
        } catch (error) {
          shareError = error instanceof Error ? error.message : String(error)
          console.warn('[nostr] attachment not uploaded to the relay:', error)
        }
      } else {
        shareError = token ? 'this deployment publishes nothing' : 'not signed in'
        console.warn('[nostr] attachment not uploaded to the relay:', shareError)
      }

      return {
        ...local,
        storageId,
        sha256: blob?.sha256,
        mediaUrl: blob?.url,
        thumbUrl: blob?.thumb,
        dim: blob?.dim,
        shareError,
      }
    },
  }
}
