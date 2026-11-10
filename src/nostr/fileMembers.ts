/**
 * Everyone who is a member of one file — the Members dialog's roster (REA-3,
 * as Ship's SHI-31).
 *
 * The same read Ship makes (`readFeedFacts`): the file's membership changes and
 * its stream, folded by `membersOf` with the file's root first, so its author
 * counts from creation until they leave (SPEC §11.8 *The fold*). The stream is
 * asked for by `#A` (a reply drops the lowercase `a`) and by `#a`, because a
 * comment with no `A` anchors every `a` it has (`candidateFilesOf`).
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND_CHANGE, membersOf, type Membership } from '@estiva-app/conversation'
import { queryRelay } from './bridge'
import type { RelaySeam } from './stars'

const KIND_COMMENT = 1111

/**
 * The filters one file's roster needs, in one request. Of its changes, only
 * the ones naming `people` (everyone with a profile): the fold takes a change
 * for its `p` tags or a `member:<P>` field, and every one of those carries the
 * person's `p` (§11.8), so this is the fold's whole input for them and none of
 * the text saves (ALO-19; on production 22 of 1,993 project changes name
 * anyone). With no `people`, every change, as before.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/opening-a-file-reads-its-current-text-not-its-history.md
 */
export function fileMembersQueries(file: string, people?: readonly string[]): Record<string, unknown>[] {
  return [
    people?.length ? { kinds: [KIND_CHANGE], '#a': [file], '#p': [...new Set(people)].sort() } : { kinds: [KIND_CHANGE], '#a': [file] },
    { kinds: [KIND_COMMENT], '#A': [file] },
    { kinds: [KIND_COMMENT], '#a': [file] },
  ]
}

/**
 * Fold what the filters returned. Pure. The root is the address's own: its
 * author, kind and `d`, ordered before every event (`created_at` 0) — the page
 * does not hold the root's second, and only the order matters for who is in.
 */
export function foldFileMembers(file: string, events: readonly SignedEvent[]): Map<string, Membership> {
  const [kind, pubkey, ...d] = file.split(':')
  const root = { id: '0'.repeat(64), pubkey: pubkey ?? '', kind: Number(kind), created_at: 0, tags: [['d', d.join(':')]], content: '', sig: '' }
  // The same comment can answer two of the filters; the fold counts events, so each is held once.
  const unique = [...new Map(events.map((e) => [e.id, e])).values()]
  return membersOf(file, [root, ...unique])
}

/** The file's members, or `undefined` when the relay did not answer — never an empty guess. `people`: as {@link fileMembersQueries}. */
export async function fetchFileMembers(seam: RelaySeam, file: string, people?: readonly string[]): Promise<Map<string, Membership> | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, fileMembersQueries(file, people && [seam.pubkey, ...people]), seam.accessToken, seam.pubkey)
  return ok ? foldFileMembers(file, events) : undefined
}

/**
 * The changes naming the viewer on these files, over all history, in one
 * request; `undefined` when the relay did not answer. What the shared
 * following fold reads (TEA-6): a level, an Add, a join or a leave. Writing
 * in a file is not one, so no comment is asked for. For the Topics screen
 * (7525c414): a topic followed before the membership read's horizon, with
 * nothing since, is still yours.
 */
export async function fetchChangesNaming(seam: RelaySeam, files: readonly string[]): Promise<SignedEvent[] | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, [{ kinds: [KIND_CHANGE], '#a': files, '#p': [seam.pubkey] }], seam.accessToken, seam.pubkey)
  return ok ? events : undefined
}
