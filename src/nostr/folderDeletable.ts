/**
 * Whether Peek may offer to delete a Folder, and why not (FOL-9).
 *
 * A `kind:9008` hides **everything that carries the Folder's `h`** — its
 * conversation, and every file and Ship issue filed in it — from every reader,
 * and nothing in any app undoes it (FOL-1…FOL-24 vanished that way on
 * 2026-09-14). So Delete is offered only where the only thing lost is the
 * Folder and its own messages:
 *
 *  - **not a DM.** Its channel is a conversation between people.
 *  - **no state.** Every Folder somebody navigates by has a `kind:30890` — the
 *    teams, QA, anything made with New folder — and its state is where files
 *    are placed.
 *  - **not a Ship record channel.** `project-…` is the Folder a project's
 *    issues are filed in by `h`; it is managed from Ship, and Ship has no
 *    Delete.
 *  - **nothing filed in it** — the relay's own guard (buzz#16, FOL-11), asked
 *    the same question first so a Delete that would be refused is never drawn.
 *    Asked of the relay rather than of `resolveFolderContents`, which leaves
 *    out a file that resolves to nothing (an archived project, a missing
 *    manifest).
 *  - **not placed in another Folder.** A `9008` leaves the Folder's `a` in its
 *    parent's state, where every state read still names it (FOL-28).
 *  - **the viewer may send it:** the channel's owner, or a relay steward.
 *
 * Two reads. The first answers the cheap refusals, which are nearly every
 * Folder on production; the second — placement, owner, roster — runs only for
 * what is left, and takes those events **only from the relay's own key**, the
 * author of the `39000`. A roster or admin list anybody else signed would
 * otherwise decide who is a steward.
 *
 * Its own module, with no browser imports, so `scripts/probe-fol9-deletable.ts`
 * runs this very function over production's Folders.
 */
import { KIND_BARE_FILE, KIND_CHANNEL_METADATA, KIND_FOLDER_STATE, type QueryFn } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'

/**
 * The kinds a Folder *files*: the relay refuses a `9008` while any carries its
 * `h`. A Leaf document (`30842`) is one since buzz#27.
 */
const FILED_KINDS = [KIND_BARE_FILE, KIND.DOCUMENT, 30850, 30851]
/** NIP-29 channel admins — the channel's owner is its `p … owner` tag. */
const KIND_CHANNEL_ADMINS = 39001
/** The relay's roster, one `["member", pubkey, role]` per member (NIP-43). */
const KIND_MEMBERSHIP_LIST = 13534

export type FolderDeletable = { ok: true } | { ok: false; reason: string }

/** The five things above, as `me`. */
export async function folderDeletableOf(query: QueryFn, folder: string, me: string): Promise<FolderDeletable> {
  const first = await query([
    { kinds: [KIND_CHANNEL_METADATA], '#d': [folder], limit: 1 },
    { kinds: [KIND_FOLDER_STATE], '#d': [folder], limit: 1 },
    { kinds: FILED_KINDS, '#h': [folder], limit: 1 },
  ])
  const metadata = first.find((e) => e.kind === KIND_CHANNEL_METADATA)
  if (!metadata) return { ok: false, reason: 'This folder could not be read.' }
  // A DM's channel is not a Folder (PEE-36), and a DM names no owner, so a
  // steward would otherwise pass every check below.
  if (metadata.tags.some((t) => t[0] === 't' && t[1] === 'dm')) {
    return { ok: false, reason: 'This is a conversation, not a folder.' }
  }
  if (first.some((e) => e.kind === KIND_FOLDER_STATE)) {
    return { ok: false, reason: 'A folder that files things is not deleted from Peek: everything in it would disappear.' }
  }
  const name = metadata.tags.find((t) => t[0] === 'name')?.[1] ?? ''
  if (name.startsWith('project-')) {
    return { ok: false, reason: "This is a Ship project's folder: deleting it would hide the project's issues." }
  }
  if (first.some((e) => FILED_KINDS.includes(e.kind))) {
    return { ok: false, reason: 'Something is filed in this folder, and deleting it would hide that for everyone.' }
  }

  const relay = metadata.pubkey
  const second = await query([
    { kinds: [KIND_FOLDER_STATE], authors: [relay], '#a': [`${KIND_CHANNEL_METADATA}:${relay}:${folder}`], limit: 1 },
    { kinds: [KIND_CHANNEL_ADMINS], authors: [relay], '#d': [folder], limit: 1 },
    { kinds: [KIND_MEMBERSHIP_LIST], authors: [relay], limit: 1 },
  ])
  const ofKind = (kind: number) => second.filter((e) => e.kind === kind && e.pubkey === relay)
  if (ofKind(KIND_FOLDER_STATE).length) {
    return { ok: false, reason: 'This folder is inside another one; deleting it would leave a gap there.' }
  }
  const owner = ofKind(KIND_CHANNEL_ADMINS)[0]?.tags.find((t) => t[0] === 'p' && t[2] === 'owner')?.[1]
  const role = ofKind(KIND_MEMBERSHIP_LIST)[0]?.tags.find((t) => t[0] === 'member' && t[1] === me)?.[2]
  if (owner !== me && role !== 'owner' && role !== 'admin') {
    return { ok: false, reason: 'Only the person who made this folder can delete it.' }
  }
  return { ok: true }
}
