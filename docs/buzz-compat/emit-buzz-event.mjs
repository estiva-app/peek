#!/usr/bin/env node
/**
 * Peek → Buzz event emitter (Phase 4 interop probe).
 *
 * Takes Peek rows in their exact `convex/schema.ts` shape and emits a
 * Buzz-shaped, BIP-340-signed Nostr event for the smallest useful interop
 * surface: one channel (NIP-29 kind:9007) and one message (kind:9).
 *
 * This is a probe, not a product path. Every place where Peek has no value to
 * supply is recorded in the `gaps` array rather than silently defaulted, and
 * printed alongside the event.
 *
 * Usage:
 *   NODE_PATH=<dir with @noble/*> node emit-buzz-event.mjs [--pretty]
 *
 * Output: JSON on stdout —
 *   { channel_event, message_event, gaps, derivation }
 */

import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

// ───────────────────────────────────────────────────────────────────────────
// 1. Peek input — rows exactly as convex/schema.ts defines them.
//    (No live Convex deployment is reachable from this checkout — there is no
//    .env.local — so these are hand-written rows in the real schema shape,
//    with real Convex-style _id strings.)
// ───────────────────────────────────────────────────────────────────────────

const peek = {
  users: [
    {
      _id: 'jd7a8f2k3m9p0q1r2s3t4u5v6w',
      _creationTime: 1_753_300_000_000,
      name: 'Alice Chen',
      email: 'alice@example.com',
      role: 'Design Lead',
      seedKey: 'alice',
    },
  ],
  topics: [
    {
      _id: 'kx91m2n3b4v5c6x7z8a9s0d1f2',
      _creationTime: 1_753_300_100_000,
      title: 'Onboarding redesign',
      creatorId: 'jd7a8f2k3m9p0q1r2s3t4u5v6w',
      createdAt: 1_753_300_100_000,
      seedKey: 't_1753300100000_1',
    },
  ],
  topicMembers: [
    {
      _id: 'tm01',
      topicId: 'kx91m2n3b4v5c6x7z8a9s0d1f2',
      userId: 'jd7a8f2k3m9p0q1r2s3t4u5v6w',
      addedAt: 1_753_300_100_000,
    },
  ],
  messages: [
    {
      _id: 'mg55h6j7k8l9z0x1c2v3b4n5m6',
      _creationTime: 1_753_300_200_000,
      parentKind: 'topic',
      parentId: 'kx91m2n3b4v5c6x7z8a9s0d1f2',
      authorId: 'jd7a8f2k3m9p0q1r2s3t4u5v6w',
      body: 'The new sign-up flow drops a step. Worth a look before Friday.',
      createdAt: 1_753_300_200_000,
      urgent: undefined,
      highlightType: 'insight',
      resolved: undefined,
      attachments: undefined,
      fileAttachments: undefined,
      seedKey: 'm_1753300200000_1',
    },
  ],
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Identity: Peek has no keypairs (convex/schema.ts users has no key
//    material). Derive a deterministic stand-in so the probe is reproducible.
//    NOT a real identity design — see gaps.
// ───────────────────────────────────────────────────────────────────────────

const gaps = []
const note = (field, detail) => gaps.push({ field, detail })

function derivedKeypair(peekUserId) {
  const sk = sha256(utf8ToBytes(`peek:probe:user:${peekUserId}`))
  return { sk, pk: bytesToHex(schnorr.getPublicKey(sk)) }
}

/** Peek ids are opaque and not UUIDs; Buzz `h` tags are channel UUIDs. */
function derivedChannelUuid(peekTopicId) {
  const h = bytesToHex(sha256(utf8ToBytes(`peek:probe:topic:${peekTopicId}`)))
  // Shape the digest as a v4-looking UUID (version/variant nibbles pinned).
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-')
}

// ───────────────────────────────────────────────────────────────────────────
// 3. NIP-01 event id + BIP-340 signature.
// ───────────────────────────────────────────────────────────────────────────

function eventId({ pubkey, created_at, kind, tags, content }) {
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content])
  return bytesToHex(sha256(utf8ToBytes(serialized)))
}

function finalize(unsigned, sk) {
  const id = eventId(unsigned)
  const sig = bytesToHex(schnorr.sign(id, sk))
  return { ...unsigned, id, sig }
}

// ───────────────────────────────────────────────────────────────────────────
// 4. The mapping itself.
// ───────────────────────────────────────────────────────────────────────────

const user = peek.users[0]
const topic = peek.topics[0]
const message = peek.messages[0]

const { sk, pk } = derivedKeypair(user._id)
const channelId = derivedChannelUuid(topic._id)

note(
  'users.<key material>',
  'Peek has no keypairs at all. This probe derives sk = sha256("peek:probe:user:"+_id), ' +
    'which means the relay would hold a key Peek can mint for any user — no user consent, ' +
    'no key custody, no recovery. Real interop needs a genuine key story first.',
)
note(
  'topics._id → h tag',
  `Peek ids are opaque Convex ids, not UUIDs. Derived channel UUID ${channelId} ` +
    'from a hash. Two Peek deployments would derive the same UUID for different topics ' +
    'only if ids collide, but nothing ties this UUID to a channel Buzz already knows.',
)

// -- Channel: NIP-29 kind:9007, per crates/buzz-sdk/src/builders.rs build_create_channel
const channelEvent = finalize(
  {
    pubkey: pk,
    created_at: Math.floor(topic.createdAt / 1000),
    kind: 9007,
    tags: [
      ['h', channelId],
      ['name', topic.title],
      ['visibility', 'open'],
      ['channel_type', 'stream'],
    ],
    content: '',
  },
  sk,
)

note(
  'topics.<visibility>',
  'Peek topics have no visibility/private flag and no workspace scope; "open" is invented here.',
)

// -- Message: kind:9, per build_message (h tag required, content max 64 KiB)
const messageTags = [['h', channelId]]

// Peek parses @mentions out of body text; Buzz wants ["p", <64-hex>] tags.
const mentioned = [...message.body.matchAll(/@([A-Za-z][A-Za-z ]*)/g)].map((m) => m[1].trim())
if (mentioned.length > 0) {
  note(
    'messages.body @mentions',
    `Found ${mentioned.length} in-band mention(s) (${mentioned.join(', ')}). Buzz expects ` +
      'structured ["p", <hex pubkey>] tags. Peek resolves mentions by display-name string ' +
      'match, so there is no pubkey to put in the tag.',
  )
}

if (message.urgent) {
  note('messages.urgent', 'No kind:9 equivalent. Dropped — the urgency signal is lost.')
}
if (message.highlightType) {
  note(
    'messages.highlightType',
    `"${message.highlightType}" has no Buzz equivalent on kind:9 and no registered kind. Dropped.`,
  )
}
if (message.resolved) {
  note(
    'messages.resolved / resolvedById / resolutionMessage / resolvedAt',
    'Peek stores resolution as mutated fields on the author\'s row. Buzz has no resolution ' +
      'concept; on an append-only substrate this needs a new kind anyway. Dropped.',
  )
}
if (message.fileAttachments?.length) {
  note(
    'messages.fileAttachments',
    'Buzz attaches media via imeta tags referencing Blossom sha256 content hashes. Convex ' +
      'storageIds are opaque and carry no hash — the blob would have to be re-uploaded.',
  )
}
if (message.attachments?.length) {
  note('messages.attachments', 'Figma frame ids — static integration mocks, no Buzz analogue.')
}

const messageEvent = finalize(
  {
    pubkey: pk,
    created_at: Math.floor(message.createdAt / 1000),
    kind: 9,
    tags: messageTags,
    content: message.body,
  },
  sk,
)

note(
  'messages.createdAt',
  'Peek stores ms; Nostr created_at is seconds. Sub-second ordering is lost, and Peek sorts ' +
    'by createdAt — two messages in the same second become order-ambiguous on the relay.',
)
note(
  'messages._id / seedKey',
  `Peek's stable id (${message.seedKey}) is discarded: a Nostr event id is the hash of its ` +
    'own content. Peek would need to store the returned event id to keep the two in sync.',
)

// ───────────────────────────────────────────────────────────────────────────
// 5. Output
// ───────────────────────────────────────────────────────────────────────────

const out = {
  derivation: {
    peek_user_id: user._id,
    derived_pubkey: pk,
    peek_topic_id: topic._id,
    derived_channel_uuid: channelId,
    peek_message_id: message._id,
    nostr_event_id: messageEvent.id,
  },
  channel_event: channelEvent,
  message_event: messageEvent,
  gaps,
}

process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n')
