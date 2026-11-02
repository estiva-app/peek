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

/** The filters one file's roster needs, in one request. */
export function fileMembersQueries(file: string): Record<string, unknown>[] {
  return [
    { kinds: [KIND_CHANGE], '#a': [file] },
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

/** The file's members, or `undefined` when the relay did not answer — never an empty guess. */
export async function fetchFileMembers(seam: RelaySeam, file: string): Promise<Map<string, Membership> | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, fileMembersQueries(file), seam.accessToken, seam.pubkey)
  return ok ? foldFileMembers(file, events) : undefined
}

/**
 * The filters for one person in many files, over all history: of each file's
 * roster read, only the events that can name them — the changes tagging them,
 * and the comments they wrote or that mention them.
 */
export function personInFilesQueries(person: string, files: readonly string[]): Record<string, unknown>[] {
  return [
    { kinds: [KIND_CHANGE], '#a': files, '#p': [person] },
    { kinds: [KIND_COMMENT], '#A': files, authors: [person] },
    { kinds: [KIND_COMMENT], '#a': files, authors: [person] },
    { kinds: [KIND_COMMENT], '#A': files, '#p': [person] },
    { kinds: [KIND_COMMENT], '#a': files, '#p': [person] },
  ]
}

/**
 * Which of these files the viewer is a member of, judged as each file's page
 * judges it (`fetchFileMembers`), in one request; `undefined` when the relay
 * did not answer. For the Topics screen (7525c414): a topic joined before the
 * membership read's horizon, with nothing since, is still yours.
 */
export async function fetchMemberOf(seam: RelaySeam, files: readonly string[]): Promise<Set<string> | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, personInFilesQueries(seam.pubkey, files), seam.accessToken, seam.pubkey)
  if (!ok) return undefined
  return new Set(files.filter((file) => foldFileMembers(file, events).has(seam.pubkey)))
}
