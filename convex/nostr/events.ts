/**
 * Buzz-shaped Nostr event builders (docs/buzz-compat/IMPLEMENTATION_PLAN.md §3.2).
 *
 * Every builder here mirrors a function in Buzz's own SDK
 * (`crates/buzz-sdk/src/builders.rs`) exactly — same kind, same tags, **same tag
 * order**. Tag order is part of the NIP-01 id preimage, so a reordered tag
 * produces a different event id. Where a shape was verified against Buzz's code,
 * the Rust function is named in the comment.
 *
 * Verified: `buildMessage` + `buildCreateChannel` output was compared against
 * `build_message` / `build_create_channel` by running Buzz's own crates over this
 * emitter's output — byte-identical event ids
 * (docs/buzz-compat/INTEROP_PROOF.md §4).
 *
 * Pure functions only: no signing, no I/O, no randomness. That keeps this module
 * runnable in Convex's default runtime and unit-testable. Signing lives in
 * `convex/nostr/sign.ts`, which needs a Node runtime for entropy.
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** A Nostr tag: an array of strings whose first element is the tag name. */
export type NostrTag = string[]

/** An event before signing. `pubkey` is 64-char lowercase hex. */
export interface UnsignedEvent {
  pubkey: string
  created_at: number
  kind: number
  tags: NostrTag[]
  content: string
}

/** A signed event, ready to submit to the relay. */
export interface SignedEvent extends UnsignedEvent {
  id: string
  sig: string
}

/** Buzz kind numbers used by Peek (crates/buzz-core/src/kind.rs). */
export const KIND = {
  PROFILE: 0,
  DELETION: 5,
  REACTION: 7,
  STREAM_MESSAGE: 9,
  NIP29_PUT_USER: 9000,
  NIP29_CREATE_GROUP: 9007,
  HTTP_AUTH: 27235,
} as const

/** `build_reaction` (builders.rs:463) caps the emoji at 64 chars. */
export const MAX_EMOJI_CHARS = 64

/** kind:9 content cap — `check_content(content, 64 * 1024)` in build_message. */
export const MAX_MESSAGE_BYTES = 64 * 1024

/** `mention_tags` in builders.rs rejects more than this many mentions. */
export const MAX_MENTIONS = 50

/**
 * NIP-01 event id: sha256 over the canonical serialization
 * `[0, pubkey, created_at, kind, tags, content]`.
 *
 * `JSON.stringify` produces exactly the escaping NIP-01 requires (`\n`, `\"`,
 * `\\`, `\r`, `\t`, `\b`, `\f`, `\uXXXX` for other control chars) with no
 * insignificant whitespace, so no custom serializer is needed.
 */
export function computeEventId(e: UnsignedEvent): string {
  const serialized = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content])
  return bytesToHex(sha256(utf8ToBytes(serialized)))
}

/** Peek stores ms; Nostr `created_at` is seconds. */
export function toNostrSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

function assertHex64(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be 64 lowercase hex chars, got: ${value.slice(0, 16)}…`)
  }
}

/**
 * Buzz's `canonical_channel_name` (crates/buzz-core/src/channel.rs:15):
 * strip leading '#' and whitespace, then trim the end. Applied by
 * `build_create_channel` before the name reaches the tag, so we must match it or
 * our ids diverge for any title with a leading '#' or space.
 */
export function canonicalChannelName(name: string): string {
  return name.replace(/^[#\s]+/, '').replace(/\s+$/, '')
}

/**
 * kind:0 profile — mirrors `build_profile` (builders.rs:537).
 *
 * Buzz builds the content with `serde_json::Map`, which is a `BTreeMap` unless
 * the `preserve_order` feature is enabled. It is not enabled in Buzz's
 * workspace, so **keys serialize in alphabetical order**: about, display_name,
 * name, nip05, picture. We sort to match; getting this wrong changes the content
 * string and therefore the event id.
 */
export function buildProfile(
  pubkey: string,
  createdAtMs: number,
  fields: {
    display_name?: string
    name?: string
    picture?: string
    about?: string
    nip05?: string
  },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  const present = Object.entries(fields).filter(([, v]) => v !== undefined && v !== '')
  present.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const content = `{${present.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',')}}`
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.PROFILE,
    tags: [],
    content,
  }
}

export type ChannelVisibility = 'open' | 'private'
export type ChannelKind = 'stream' | 'forum' | 'dm'

/**
 * kind:9007 create channel — mirrors `build_create_channel` (builders.rs:674).
 * Tag order is fixed: h, name, [visibility], [channel_type], [about], [ttl].
 */
export function buildCreateChannel(
  pubkey: string,
  createdAtMs: number,
  args: {
    channelUuid: string
    name: string
    visibility?: ChannelVisibility
    channelType?: ChannelKind
    about?: string
    ttlSeconds?: number
  },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  const name = canonicalChannelName(args.name)
  if (name.trim() === '') throw new Error('channel name is required')
  const tags: NostrTag[] = [
    ['h', args.channelUuid],
    ['name', name],
  ]
  if (args.visibility) tags.push(['visibility', args.visibility])
  if (args.channelType) tags.push(['channel_type', args.channelType])
  if (args.about) tags.push(['about', args.about])
  if (args.ttlSeconds !== undefined) tags.push(['ttl', String(args.ttlSeconds)])
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.NIP29_CREATE_GROUP,
    tags,
    content: '',
  }
}

export type MemberRole = 'owner' | 'admin' | 'member'

/**
 * kind:9000 add member — mirrors `build_add_member` (builders.rs:565).
 * Tag order: h, p, [role]. The target pubkey is lowercased by Buzz.
 */
export function buildAddMember(
  pubkey: string,
  createdAtMs: number,
  args: { channelUuid: string; targetPubkey: string; role?: MemberRole },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  const target = args.targetPubkey.toLowerCase()
  assertHex64(target, 'targetPubkey')
  const tags: NostrTag[] = [
    ['h', args.channelUuid],
    ['p', target],
  ]
  if (args.role) tags.push(['role', args.role])
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.NIP29_PUT_USER,
    tags,
    content: '',
  }
}

/**
 * kind:7 reaction — mirrors `build_reaction` (builders.rs:463).
 *
 * Note there is **no `h` tag**: Buzz derives the channel from the *target's*
 * `#e` tag and explicitly ignores a client-supplied `#h` (`NOSTR.md`). Adding one
 * would change the event id for no benefit.
 */
export function buildReaction(
  pubkey: string,
  createdAtMs: number,
  args: { targetEventId: string; emoji: string },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  assertHex64(args.targetEventId, 'targetEventId')
  if ([...args.emoji].length > MAX_EMOJI_CHARS) {
    throw new Error(`emoji longer than ${MAX_EMOJI_CHARS} chars`)
  }
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.REACTION,
    tags: [['e', args.targetEventId]],
    content: args.emoji,
  }
}

/**
 * kind:5 deletion — mirrors `build_remove_reaction` (builders.rs:495).
 *
 * Used to retract a reaction: Peek deletes the row, Nostr needs a tombstone.
 * Buzz accepts self-authored deletions (and an owner deleting their agent's).
 */
export function buildDeletion(
  pubkey: string,
  createdAtMs: number,
  args: { targetEventId: string },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  assertHex64(args.targetEventId, 'targetEventId')
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.DELETION,
    tags: [['e', args.targetEventId]],
    content: '',
  }
}

/**
 * NIP-10 reply context.
 *
 * Mirrors Buzz's `ThreadRef` + `thread_tags` (builders.rs:173), which has a
 * detail that is easy to get wrong: for a **direct** reply (parent is the root)
 * Buzz emits a SINGLE tag marked `"reply"` — not a `"root"` tag. Only a nested
 * reply emits both. Getting this wrong changes the event id and, worse, produces
 * threads Buzz's clients read differently.
 */
export interface ThreadRef {
  /** Thread root event id (64-hex). */
  rootId: string
  /** Direct parent event id. Equal to `rootId` for a direct reply. */
  parentId: string
}

/** Exactly Buzz's `thread_tags` (builders.rs:173). */
export function threadTags(ref: ThreadRef): NostrTag[] {
  if (ref.rootId === ref.parentId) {
    return [['e', ref.rootId, '', 'reply']]
  }
  return [
    ['e', ref.rootId, '', 'root'],
    ['e', ref.parentId, '', 'reply'],
  ]
}

/**
 * kind:9 stream message — mirrors `build_message` (builders.rs:219).
 * Tag order: h, [thread tags], [p mentions], [broadcast], [imeta].
 *
 * **This is the shape verified byte-identical against Buzz's SDK** — see
 * docs/buzz-compat/INTEROP_PROOF.md §4.
 */
export function buildMessage(
  pubkey: string,
  createdAtMs: number,
  args: {
    channelUuid: string
    content: string
    threadRef?: ThreadRef
    /** Mentioned pubkeys (64-hex). Deduplicated, lowercased, capped at 50. */
    mentions?: string[]
    broadcast?: boolean
    /** Raw `imeta` tag vectors for media attachments. */
    mediaTags?: NostrTag[]
  },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  const bytes = utf8ToBytes(args.content).length
  if (bytes > MAX_MESSAGE_BYTES) {
    throw new Error(`content is ${bytes} bytes, max ${MAX_MESSAGE_BYTES}`)
  }

  const tags: NostrTag[] = [['h', args.channelUuid]]

  if (args.threadRef) tags.push(...threadTags(args.threadRef))

  if (args.mentions && args.mentions.length > 0) {
    if (args.mentions.length > MAX_MENTIONS) {
      throw new Error(`too many mentions: ${args.mentions.length} > ${MAX_MENTIONS}`)
    }
    const seen = new Set<string>()
    for (const hex of args.mentions) {
      const lower = hex.toLowerCase()
      assertHex64(lower, 'mention pubkey')
      if (!seen.has(lower)) {
        seen.add(lower)
        tags.push(['p', lower])
      }
    }
  }

  if (args.broadcast) tags.push(['broadcast', '1'])
  for (const mt of args.mediaTags ?? []) tags.push(mt)

  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.STREAM_MESSAGE,
    tags,
    content: args.content,
  }
}
