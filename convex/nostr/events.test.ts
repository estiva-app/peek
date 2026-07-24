/**
 * Cross-implementation regression test.
 *
 * The expected event ids below are not hand-computed: they are the ids Buzz's
 * own Rust crates produced and verified in Phase 4
 * (docs/buzz-compat/phase4-run-output.txt) — `buzz_core::verify_event` accepted
 * them, and `buzz_sdk::builders::build_message` / `build_create_channel`
 * regenerated the identical id from the same inputs.
 *
 * So if these assertions fail, this TypeScript has diverged from Buzz's Rust —
 * which is exactly the drift this whole exercise is trying to prevent. Do not
 * "fix" a failure by updating the expected id; find what changed in the tags,
 * the tag order, or the content.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAddMember,
  buildCreateChannel,
  buildMessage,
  buildProfile,
  canonicalChannelName,
  computeEventId,
} from './events'

/** Derived in Phase 4 from sha256("peek:probe:user:jd7a8f2k3m9p0q1r2s3t4u5v6w"). */
const PUBKEY = '714902a6e7b9a991fe77ebd9cc4dad01b6474afdf58048277e1ec6b9cde567e8'
const CHANNEL = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'

describe('parity with Buzz’s Rust builders', () => {
  it('kind:9 message reproduces the id Buzz’s build_message produced', () => {
    const event = buildMessage(PUBKEY, 1_753_300_200_000, {
      channelUuid: CHANNEL,
      content: 'The new sign-up flow drops a step. Worth a look before Friday.',
    })
    expect(event.tags).toEqual([['h', CHANNEL]])
    expect(computeEventId(event)).toBe(
      '4f0edeb3b732fa1c44c4dbd26563b4acad022ffeb469ccfdb2aeb02088a92546',
    )
  })

  it('kind:9007 create-channel reproduces the id Buzz’s build_create_channel produced', () => {
    const event = buildCreateChannel(PUBKEY, 1_753_300_100_000, {
      channelUuid: CHANNEL,
      name: 'Onboarding redesign',
      visibility: 'open',
      channelType: 'stream',
    })
    expect(event.tags).toEqual([
      ['h', CHANNEL],
      ['name', 'Onboarding redesign'],
      ['visibility', 'open'],
      ['channel_type', 'stream'],
    ])
    expect(computeEventId(event)).toBe(
      'e6fb22b28309ae82d34f5f28c38a572bf84dab47fb6bad8f4fe001e9638e87b8',
    )
  })
})

describe('shape rules taken from builders.rs', () => {
  it('canonicalChannelName strips leading # and whitespace, trims the end', () => {
    // Buzz applies this before tagging, so a mismatch changes the event id.
    expect(canonicalChannelName('  #design  ')).toBe('design')
    expect(canonicalChannelName('##a b ')).toBe('a b')
    expect(canonicalChannelName('normal')).toBe('normal')
  })

  it('kind:9000 orders tags h, p, role and lowercases the target', () => {
    const target = 'C6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5'
    const event = buildAddMember(PUBKEY, 1_753_300_100_000, {
      channelUuid: CHANNEL,
      targetPubkey: target,
      role: 'member',
    })
    expect(event.tags).toEqual([
      ['h', CHANNEL],
      ['p', target.toLowerCase()],
      ['role', 'member'],
    ])
    expect(event.content).toBe('')
  })

  it('kind:0 serializes profile keys alphabetically, as serde_json’s BTreeMap does', () => {
    // Buzz does NOT enable serde_json's preserve_order feature, so its Map is a
    // BTreeMap and keys come out sorted. Insertion order here is deliberately
    // scrambled to prove we sort rather than preserve.
    const event = buildProfile(PUBKEY, 1_753_300_100_000, {
      picture: 'https://example.com/a.png',
      display_name: 'Alice Chen',
      about: 'Design Lead',
    })
    expect(event.content).toBe(
      '{"about":"Design Lead","display_name":"Alice Chen","picture":"https://example.com/a.png"}',
    )
    expect(event.tags).toEqual([])
  })

  it('drops empty and undefined profile fields entirely', () => {
    const event = buildProfile(PUBKEY, 0, { display_name: 'X', about: '', nip05: undefined })
    expect(event.content).toBe('{"display_name":"X"}')
  })

  it('dedupes mentions, preserves first-seen order, and caps at 50', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const event = buildMessage(PUBKEY, 0, {
      channelUuid: CHANNEL,
      content: 'hi',
      mentions: [b, a, b],
    })
    expect(event.tags).toEqual([
      ['h', CHANNEL],
      ['p', b],
      ['p', a],
    ])

    expect(() =>
      buildMessage(PUBKEY, 0, {
        channelUuid: CHANNEL,
        content: 'hi',
        mentions: Array.from({ length: 51 }, (_, i) => String(i).padStart(64, '0')),
      }),
    ).toThrow(/too many mentions/)
  })

  it('rejects content over the 64 KiB cap build_message enforces', () => {
    expect(() =>
      buildMessage(PUBKEY, 0, { channelUuid: CHANNEL, content: 'x'.repeat(64 * 1024 + 1) }),
    ).toThrow(/max 65536/)
  })

  it('measures the content cap in bytes, not characters', () => {
    // 'é' is 2 bytes in UTF-8 — a char-based check would let this through.
    expect(() =>
      buildMessage(PUBKEY, 0, { channelUuid: CHANNEL, content: 'é'.repeat(32 * 1024 + 1) }),
    ).toThrow(/max 65536/)
  })

  it('emits NIP-10 marked e-tags in root-then-reply order', () => {
    const root = '1'.repeat(64)
    const reply = '2'.repeat(64)
    const event = buildMessage(PUBKEY, 0, {
      channelUuid: CHANNEL,
      content: 'hi',
      threadRef: { rootId: root, replyId: reply },
    })
    expect(event.tags).toEqual([
      ['h', CHANNEL],
      ['e', root, '', 'root'],
      ['e', reply, '', 'reply'],
    ])
  })

  it('truncates Peek’s millisecond timestamps to Nostr seconds', () => {
    const event = buildMessage(PUBKEY, 1_753_300_200_999, { channelUuid: CHANNEL, content: 'hi' })
    expect(event.created_at).toBe(1_753_300_200)
  })
})
