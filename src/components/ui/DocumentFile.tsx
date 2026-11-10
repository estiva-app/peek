import { AttachmentCard } from '@estiva-app/ui'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'

/**
 * An attachment block — an image is one (SPEC §13.3) — drawn as a message's
 * attachment is, through the same card and the same authenticated fetch:
 * in a part, in another app's text read here, and in the panel's editor of
 * it (affd152a). `RichText` and the editor have no design of their own for it.
 *
 * `download` is off in the editor, as in Ship's description editor: it saves
 * when it loses focus and the Download button takes it. A picture still opens
 * full size there.
 */
export function DocumentFile({
  attrs,
  fetchImage = blobObjectUrl,
  download = true,
}: {
  attrs: Record<string, unknown> | undefined
  fetchImage?: (mediaUrl: string) => Promise<string>
  download?: boolean
}) {
  const attr = (key: string) => (typeof attrs?.[key] === 'string' ? (attrs[key] as string) : undefined)
  const size = typeof attrs?.size === 'number' ? attrs.size : 0
  const contentType = attr('m') ?? ''
  const file = postedAttachment({ name: attr('filename') ?? 'Attachment', size, contentType, mediaUrl: attr('url'), thumbUrl: attr('thumb') })
  // Not opened, a file that is not a picture has nothing to fetch: its row is its name and size.
  const shown = download || contentType.startsWith('image/') ? file : { ...file, remoteSrc: undefined, remoteFullSrc: undefined }
  // The writer's words for a picture where they wrote some, its name otherwise, as Ship and Leaf read it: never empty.
  const alt = contentType.startsWith('image/') ? (attr('alt') ?? file.name) : undefined
  return <AttachmentCard {...shown} alt={alt} fetchImage={fetchImage} download={download} />
}
