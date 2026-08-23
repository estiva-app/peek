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
  NIP29_EDIT_METADATA: 9002,
  NIP29_CREATE_GROUP: 9007,
  NIP29_DELETE_GROUP: 9008,
  /**
   * Estiva assertion — a statement *about* something in the channel, rather
   * than a message in it (PEEK-128). `resolution` is the first and, for now,
   * only subtype; the `t` tag names it so later subtypes can join without a
   * new kind.
   *
   * Estiva-specific rather than an existing NIP, deliberately: shipping the
   * event matters more than finding a standard to fit into, and the shape
   * leaves room to migrate later.
   *
   * The number sits in the **regular** range (1000–9999), which is what makes
   * it stored and append-only. A replaceable kind would overwrite the previous
   * assertion and destroy exactly the history this exists to keep. It clears
   * NIP-29's 9000–9030 block on purpose.
   */
  ASSERTION: 9101,
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

/** Who a pubkey belongs to, as far as the relay knows. */
export interface Profile {
  /** kind:0 `display_name` or `name`. Absent when nobody has published one. */
  displayName?: string
  /** kind:0 `picture` — an avatar URL chosen by whichever app published it. */
  picture?: string
}

/**
 * The inverse of `buildProfile`: a kind:0 event to the fields Peek shows.
 *
 * Both name keys are read because both are written: Peek publishes
 * `display_name`, Linear-lite publishes `name`, and a person who has used both
 * apps should resolve either way rather than on a coin flip. Anything that will
 * not parse costs a name, never the read that asked for it.
 *
 * Lives beside `buildProfile` rather than in either caller because there are
 * now two: the Convex sync path, which stores profiles for message authors, and
 * the relay projection, which reads them in the browser for the people named on
 * another app's objects. One parser is what keeps a person from having two
 * names depending on which pane they appear in.
 */
export function parseProfile(event: { content: string } | undefined): Profile {
  if (!event) return {}
  try {
    const meta = JSON.parse(event.content)
    const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
    return { displayName: str(meta.display_name) ?? str(meta.name), picture: str(meta.picture) }
  } catch {
    return {}
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

/**
 * kind:9008 NIP-29 delete-group — what makes a deleted topic actually gone.
 *
 * Deleting a topic used to remove it, its messages, replies, reactions and
 * huddles from Convex and publish nothing at all. Create propagated as a 9007;
 * delete propagated nowhere. So a conversation somebody deleted, believing it
 * gone, stayed readable to every admitted member indefinitely — measured on
 * production at 145 messages across 37 channels with zero deletion requests
 * against any of them (PEEK-170).
 *
 * **9008 rather than a kind:5 per message**, and the difference is capability
 * rather than efficiency. Buzz rejects a multi-target kind:5 outright, and
 * NIP-09 is honoured only for the key that signed the original — so
 * per-message deletion could never reach anybody else's messages in the topic.
 * Delete-group soft-deletes the channel, and Buzz's read guards
 * (`c.deleted_at IS NULL` in both `get_accessible_channels` and `is_member`)
 * then hide the whole container regardless of who wrote what is in it.
 *
 * Requires the channel's **owner** — Buzz enforces "only owner can delete
 * group" in `validate_admin_event`, and a topic's creator becomes its owner at
 * create. Anybody else is refused, which the caller reports rather than hides.
 */
export function buildDeleteChannel(
  pubkey: string,
  createdAtMs: number,
  args: { channelUuid: string },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.NIP29_DELETE_GROUP,
    tags: [['h', args.channelUuid]],
    content: '',
  }
}

/**
 * kind:9002 edit metadata — renaming a channel (PEE-2).
 *
 * Buzz applies each recognised tag it finds (`name`, `about`, `archived`,
 * `topic`, `purpose`, `visibility`, `ttl`) and refuses an event carrying none
 * of them, so this builds exactly the fields asked for and nothing else.
 *
 * The name goes through `canonicalChannelName` for the same reason
 * `buildCreateChannel` does: Buzz canonicalises before storing, so sending the
 * raw string means Peek and the relay disagree about what the topic is called.
 * A name that canonicalises away to nothing is not a rename, and throwing here
 * is better than a round trip to be told so.
 *
 * Requires the channel's owner or admin — the relay refuses anyone else, which
 * is why the UI offers this to the topic's creator alone.
 */
export function buildEditChannelMetadata(
  pubkey: string,
  createdAtMs: number,
  args: { channelUuid: string; name?: string; about?: string },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  const tags: NostrTag[] = [['h', args.channelUuid]]
  if (args.name !== undefined) {
    const name = canonicalChannelName(args.name)
    if (name.trim() === '') throw new Error('channel name is required')
    tags.push(['name', name])
  }
  if (args.about !== undefined) tags.push(['about', args.about])
  if (tags.length === 1) throw new Error('nothing to edit')
  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.NIP29_EDIT_METADATA,
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
 * Tag order: h, [thread tags], [a about], [p mentions], [broadcast], [imeta].
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
    /** Addressable objects this conversation concerns (for cross-app routing). */
    about?: string[]
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

  // Keep a pasted NIP-19 pointer in content for portable display, and carry
  // its address here so Ship can route the conversation to the issue directly.
  for (const address of [...new Set(args.about ?? [])]) tags.push(['a', address])

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

/** Assertion subtypes. Only `resolution` exists today (PEEK-128). */
export const ASSERTION_SUBTYPE = { RESOLUTION: 'resolution' } as const

/** What a resolution assertion says happened. */
export type ResolutionAction = 'resolved' | 'reopened'

/** Rationale cap — the same 64 KiB ceiling a message content carries. */
export const MAX_RATIONALE_BYTES = MAX_MESSAGE_BYTES

/**
 * kind:9101 resolution assertion — "this thread is resolved", said on the wire
 * so any Estiva app reading the channel can see it (PEEK-128).
 *
 * **Append-only.** A reopen is another assertion, never a deletion of the
 * resolve that preceded it; current state is folded from the ordered run, not
 * read off a single canonical event. That is why this is a regular kind rather
 * than a replaceable one — see `KIND.ASSERTION`.
 *
 * The event carries the claim and who made it. It does **not** carry authority:
 * there is no "proposed" or "endorsed" mode here, because how much weight a
 * given actor's assertion deserves is a policy question that belongs to the app
 * reading it, not to the protocol. Peek's own trust rules live in the
 * projection, not here.
 *
 * Tag order is fixed so the event id is reproducible: h, e(target), t, action,
 * [e(support)].
 */
export function buildResolution(
  pubkey: string,
  createdAtMs: number,
  args: {
    channelUuid: string
    /** Event id of the message whose resolution state this asserts. */
    targetEventId: string
    action: ResolutionAction
    /** Optional reply that carried the resolution, for readers that want it. */
    supportingEventId?: string
    /** Optional free text — Peek's `resolutionMessage`. */
    rationale?: string
  },
): UnsignedEvent {
  assertHex64(pubkey, 'pubkey')
  assertHex64(args.targetEventId, 'targetEventId')
  if (args.supportingEventId) assertHex64(args.supportingEventId, 'supportingEventId')
  if (args.action !== 'resolved' && args.action !== 'reopened') {
    throw new Error(`unknown resolution action: ${String(args.action)}`)
  }
  const rationale = args.rationale ?? ''
  const bytes = utf8ToBytes(rationale).length
  if (bytes > MAX_RATIONALE_BYTES) {
    throw new Error(`rationale is ${bytes} bytes, max ${MAX_RATIONALE_BYTES}`)
  }

  const tags: NostrTag[] = [
    ['h', args.channelUuid],
    ['e', args.targetEventId],
    ['t', ASSERTION_SUBTYPE.RESOLUTION],
    ['action', args.action],
  ]
  // Marked so a reader can tell the supporting reply from the target, which
  // share the `e` tag name.
  if (args.supportingEventId) tags.push(['e', args.supportingEventId, '', 'support'])

  return {
    pubkey,
    created_at: toNostrSeconds(createdAtMs),
    kind: KIND.ASSERTION,
    tags,
    content: rationale,
  }
}

/**
 * Fold an ordered run of resolution assertions into the state Peek renders.
 *
 * Ordering is by `created_at`, then event id as a tiebreak — two assertions can
 * share a second, and without a stable tiebreak the same run would fold
 * differently on different clients.
 *
 * **Trust is applied by the caller, not here.** Pass only the assertions whose
 * authors the app is willing to let flip state (PEEK-128 decision 4); foreign
 * ones can still be displayed as history without being fed to this.
 */
export function foldResolution(
  assertions: Array<{
    id: string
    pubkey: string
    created_at: number
    action: ResolutionAction
    rationale?: string
  }>,
): { resolved: boolean; byPubkey?: string; atSeconds?: number; rationale?: string } {
  const ordered = [...assertions].sort(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  )
  const last = ordered[ordered.length - 1]
  if (!last) return { resolved: false }
  return last.action === 'resolved'
    ? { resolved: true, byPubkey: last.pubkey, atSeconds: last.created_at, rationale: last.rationale || undefined }
    : { resolved: false, byPubkey: last.pubkey, atSeconds: last.created_at }
}
