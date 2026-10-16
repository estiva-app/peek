/**
 * Peek's NIP-89 manifest — the first one Peek has ever published (PRO-6).
 *
 * Until now Peek has only ever been a *consumer*: it reads Ship's manifest and
 * renders Ship's objects. Nothing of Peek's could be rendered anywhere else,
 * so the projection layer has run in exactly one direction since it was built.
 * This is the producer half of closing that loop; Ship rendering one of these
 * is PRO-7.
 *
 * Writing it surfaced three things the mechanism could not express, each of
 * which is now in `interop/projection.ts` and RFC 0.4. That is the point of a
 * second direction, and it is why §13.5 insists the layer must not be published
 * as a package until one exists.
 *
 * **It claims no kind any more** (REC-1). It claimed two, a Folder (`39000`)
 * and a chat message (`9`), with a projection for each and Start a
 * conversation on a Folder. Both now belong to the protocol: every app has
 * them built in (interop 0.58, SPEC §3.2, §7.8), Start a conversation is the
 * Folder's own action beside New file, and the runtime no longer reads a claim
 * on either. What is left is what Peek does for everybody: it opens every
 * file's conversation.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/folders-belong-to-the-protocol.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-chat-message-belongs-to-the-protocol.md
 */
import type { ManifestAction } from '@estiva-app/interop'
import { PEEK_APP_NAME } from '@/lib/appName'

/**
 * NIP-29's channel record, a Folder — no app's kind, Peek's code still reads it.
 * Not a claim: nothing here is published as one.
 */
export const TOPIC_KIND = 39000
/** NIP-29's chat message — no app's kind either (SPEC §7.8), and not addressable. */
export const MESSAGE_KIND = 9

export const MANIFEST_D_TAG = 'estiva-peek'

export function manifestContent() {
  return {
    name: PEEK_APP_NAME,
    about: 'Conversations',

    /**
     * **Peek is a generic app: it renders the conversation of every file**
     * (RFC 0.5 §10.7, the one field that section adds to a manifest).
     *
     * It is what a consumer reads to find where something nobody owns can be
     * opened: a bare file (`kind:30840`, a topic since peek#194), a Folder, a
     * comment and a chat message have no `web` template of their own, so
     * interop takes the ones on the manifest declaring this aspect — the
     * `naddr` one for a file or a Folder, the `nevent` one for a comment or a
     * message (SPEC §7.8). Ship's Related card for a topic under a project
     * becomes a link into `/o/<naddr>` because this is published (FOL-17), and
     * `ObjectPage` opens it beside its Folder.
     */
    aspect: 'conversation',

    /**
     * What Peek calls a file nobody owns: a topic (PRO-24, interop 0.44.0).
     * A consumer labels a bare file by its type, and the word is the opening
     * app's rather than the protocol's (Miky, 2026-10-02), so Ship's chip for
     * one of these reads "Topic" because this says so.
     */
    fileNoun: 'topic',

    /**
     * **No projection, and no `records` rule.** Peek's projections were a Folder's (its name, its one-liner and
     * fifty of its messages) and a message's (its author and its text). The
     * runtime draws both from the specification now, the same in every app,
     * and a Folder's card lists the files its state names rather than
     * messages (interop 0.58). With no kind of its own, nothing of Peek's
     * folds change events either.
     */
    projections: {},

    /**
     * **No action.** Peek declared one, Start a conversation on a Folder
     * (INT-9). It is the Folder's own since interop 0.58, offered by every app
     * that may sign a `kind:9`, as New file is (INT-12) — so declared here it
     * would only be a second copy nobody reads.
     *
     * Reply and react were never declarable, and still are not: a reply names
     * the event it answers and `setTag`/`toAddressOf` can name only a parent
     * address, and a `kind:7` carries no `h` (RFC 0.4 §7.2). They are the
     * conversation's, not a manifest's.
     */
    actions: [] as ManifestAction[],

    /** Nothing of Peek's is an enumerated field. */
    vocabularies: {},
  }
}
