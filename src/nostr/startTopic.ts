import { buildBareFile, buildDeletion, encodeNaddr, type UnsignedEvent } from '@estiva-app/protocol'
import { KIND_BARE_FILE, SUMMARY_FIELD, planPlaceFile } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import { summaryText } from '@/lib/summary'
import { publishConfirmed } from './fileConversation'

/**
 * A new topic before anything is written (PEE-6): its `d` is the client's, so
 * its address, its link and its page are known at Start, and the page opens on
 * it while {@link publishTopicAsViewer} writes it behind.
 */
export interface PlannedTopic {
  fileId: string
  address: string
  naddr: string
  /** The file — a `kind:30840` carrying the team's channel as `h`, and the file it sits under as `a`. */
  event: UnsignedEvent
}

/**
 * Start a topic — a bare file inside a team, SPEC §6.7 (RFC 0.5 §10.7).
 *
 * A new topic is no longer a channel. It is a `kind:30840` carrying the team's
 * channel as `h`, optionally naming the file it sits under with one `a` of any
 * kind, and its conversation is `kind:1111` comments on it — which is what
 * `applyActionAsViewer` already publishes through the bare file's built-in
 * `comment` action. Existing topics stay channels; nothing here touches them.
 *
 * `fileId` is given again when a refused topic is started again, so the draft
 * kept under its address is the one its composer opens with.
 *
 * A summary is seeded as the root's `["summary", <text>]`, last, as SPEC §6.12
 * has the reference writers put it; `buildBareFile` takes none, so it is
 * appended here. Blank, the root carries no tag at all.
 */
export function planTopic(
  args: { folder: string; title: string; summary?: string; parent?: string; fileId?: string },
  pubkey: string,
): PlannedTopic {
  const fileId = args.fileId ?? crypto.randomUUID()
  const built = buildBareFile(pubkey, Date.now(), {
    fileId,
    title: args.title,
    channelUuid: args.folder,
    ...(args.parent ? { parent: args.parent } : {}),
  })
  const summary = summaryText(args.summary ?? '')
  const event = summary ? { ...built, tags: [...built.tags, [SUMMARY_FIELD, summary]] } : built
  return {
    fileId,
    address: `${KIND_BARE_FILE}:${pubkey}:${fileId}`,
    naddr: encodeNaddr({ kind: KIND_BARE_FILE, pubkey, identifier: fileId, relays: [] }),
    event,
  }
}

/**
 * Write a planned topic: the file, then — when its Folder has state — the
 * `kind:1852` `add` that lists it.
 *
 * **Two writes when the Folder has state, one when it does not, and the
 * caller says which.** A Folder read by containment lists the new file the
 * moment its `h` is stored. A Folder with a `kind:30890` lists only what its
 * state names, so it also needs the `add` — and a `1852` against a Folder with
 * *no* state emits state listing nothing, which empties the Folder on every
 * surface (peek#192). `hasState` is required rather than guessed: the page has
 * just read it, and getting it wrong is silent loss.
 *
 * **A topic its Folder refuses to list was not created** (Miky, PEE-6 kickoff):
 * the saved file is deleted again and the answer says so (`deleted`): its `d`
 * was used, so starting it again takes a new one — why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-files-id-is-unique-across-every-kind.md — and the refusal
 * is reported as the file's would be. Each write is retried on a transient
 * failure, as a message is; an HTTP refusal and `accepted: false` both come
 * back as a refusal.
 */
export async function publishTopicAsViewer(
  planned: PlannedTopic,
  args: { folder: string; hasState: boolean },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true } | { ok: false; reason: string; deleted?: true }> {
  const file = await publishConfirmed(planned.event, relayUrl, token, 'The relay refused to create the topic.')
  if (!file.ok) return file
  for (const command of planPlaceFile(token.pubkey, Date.now(), { folder: args.folder, address: planned.address, hasState: args.hasState })) {
    const placed = await publishConfirmed(command, relayUrl, token, 'The Folder refused to list the topic.')
    if (placed.ok) continue
    const deleted = file.id
      ? await publishConfirmed(buildDeletion(token.pubkey, Date.now(), { targetEventId: file.id }), relayUrl, token, '')
      : { ok: false as const, reason: 'no event id' }
    // Deleted, its `d` is spent: started again, it is a new file (a file's id is never reused, deleted files included).
    if (deleted.ok) return { ...placed, deleted: true }
    // Not deleted, it is still there unlisted: started again at the same `d`, it is replaced and listed after all.
    console.warn('[nostr] deleting a topic its Folder refused failed:', deleted.reason)
    return placed
  }
  return { ok: true }
}

/** Plan and write a topic in one go, answering once the relay has — for the fixture seeds, which wait. */
export async function createTopicAsViewer(
  args: { folder: string; title: string; summary?: string; parent?: string; hasState: boolean },
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true; address: string; naddr: string } | { ok: false; reason: string }> {
  const planned = planTopic(args, token.pubkey)
  const written = await publishTopicAsViewer(planned, args, relayUrl, token)
  return written.ok ? { ok: true, address: planned.address, naddr: planned.naddr } : written
}
