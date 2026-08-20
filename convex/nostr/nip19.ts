/**
 * NIP-19 `naddr` decoding — Peek's own implementation.
 *
 * Peek is a *consumer* here: someone pastes `nostr:naddr1…` into a message
 * (NIP-21 for the scheme, NIP-27 for the convention of embedding one in text)
 * and Peek has to work out what it points at.
 *
 * Written independently rather than shared with the app that produced the
 * string. That is the point of the exercise — two apps agreeing on a wire
 * format is a real claim; two apps calling the same function is not.
 *
 * BIP-173 bech32, **not bech32m**: NIP-19 predates bech32m and uses the
 * original checksum constant. And BIP-173's 90-character cap does not apply —
 * NIP-19 lifts it, and a real `naddr` carrying a UUID identifier plus a relay
 * hint runs to ~180 characters.
 */
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const value of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]
  }
  return chk >>> 0
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = []
  const low: number[] = []
  for (const char of hrp) {
    high.push(char.charCodeAt(0) >>> 5)
    low.push(char.charCodeAt(0) & 31)
  }
  return [...high, 0, ...low]
}

/** 5-bit bech32 symbols back to 8-bit bytes. */
function fromWords(words: number[]): number[] {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const word of words) {
    acc = (acc << 5) | word
    bits += 5
    while (bits >= 8) {
      bits -= 8
      out.push((acc >>> bits) & 0xff)
    }
  }
  // Leftover bits are padding and must be zero; anything else is corruption.
  if (bits >= 5 || ((acc << (8 - bits)) & 0xff) !== 0) throw new Error('invalid padding')
  return out
}

export interface AddressPointer {
  /** The `d` tag of the addressable event. */
  identifier: string
  pubkey: string
  kind: number
  relays: string[]
}

/** Decode `naddr1…` (with or without a `nostr:` prefix). Throws if malformed. */
export function decodeNaddr(input: string): AddressPointer {
  const encoded = input.replace(/^nostr:/i, '').toLowerCase()
  const split = encoded.lastIndexOf('1')
  if (split < 1 || split + 7 > encoded.length) throw new Error('malformed bech32 string')
  const hrp = encoded.slice(0, split)
  if (hrp !== 'naddr') throw new Error(`expected an naddr, got ${hrp}`)

  const words: number[] = []
  for (const char of encoded.slice(split + 1)) {
    const index = CHARSET.indexOf(char)
    if (index === -1) throw new Error(`invalid bech32 character: ${char}`)
    words.push(index)
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) throw new Error('bad bech32 checksum')

  const bytes = fromWords(words.slice(0, -6))

  let identifier: string | undefined
  let pubkey: string | undefined
  let kind: number | undefined
  const relays: string[] = []

  for (let i = 0; i < bytes.length; ) {
    const type = bytes[i]
    const length = bytes[i + 1]
    const value = bytes.slice(i + 2, i + 2 + length)
    if (value.length !== length) throw new Error('truncated TLV')
    i += 2 + length

    // 0 identifier · 1 relay · 2 author · 3 kind. Unknown types are skipped
    // rather than rejected, which is what lets the format gain fields later.
    if (type === 0) identifier = new TextDecoder().decode(new Uint8Array(value))
    else if (type === 1) relays.push(new TextDecoder().decode(new Uint8Array(value)))
    else if (type === 2) {
      if (length !== 32) throw new Error(`author must be 32 bytes, got ${length}`)
      pubkey = value.map((b) => b.toString(16).padStart(2, '0')).join('')
    } else if (type === 3) {
      if (length !== 4) throw new Error(`kind must be 4 bytes, got ${length}`)
      kind = ((value[0] << 24) | (value[1] << 16) | (value[2] << 8) | value[3]) >>> 0
    }
  }

  if (identifier === undefined || pubkey === undefined || kind === undefined) {
    throw new Error('naddr is missing identifier, author or kind')
  }
  return { identifier, pubkey, kind, relays }
}

/** `<kind>:<pubkey>:<d>` — the form used in `a` tags and relay filters. */
export function pointerToAddress(pointer: AddressPointer): string {
  return `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`
}

/**
 * The inverse: `<kind>:<pubkey>:<d>` back to a pointer.
 *
 * An address carries no relay hints — `naddr` has a TLV for them and an `a` tag
 * does not — so the relays come back empty. That is a real loss of information,
 * not an oversight here: it is why the two forms are not interchangeable and
 * why the encoder is not simply run in reverse.
 *
 * The `d` identifier may itself contain colons, so only the first two are
 * separators.
 */
export function addressToPointer(address: string): AddressPointer {
  const first = address.indexOf(':')
  const second = address.indexOf(':', first + 1)
  if (first < 1 || second < 0) throw new Error(`not an address: ${address.slice(0, 40)}`)
  const kind = Number(address.slice(0, first))
  const pubkey = address.slice(first + 1, second)
  const identifier = address.slice(second + 1)
  if (!Number.isInteger(kind) || !/^[0-9a-f]{64}$/i.test(pubkey)) {
    throw new Error(`not an address: ${address.slice(0, 40)}`)
  }
  return { kind, pubkey: pubkey.toLowerCase(), identifier, relays: [] }
}

/**
 * A pointer from *either* form a reference reaches Peek in.
 *
 * A message composed here carries `nostr:naddr1…` in its body. The same message
 * read back off the relay carries the same reference as an `a` tag, which is a
 * plain `<kind>:<pubkey>:<d>` address — that is what the NIP says a tag holds,
 * and what `referencedAddresses` writes when publishing.
 *
 * Both name one object. Accepting only the first is what made a reference stop
 * rendering the moment its own message came back from the relay (FEE-2).
 */
export function referenceToPointer(input: string): AddressPointer {
  const trimmed = input.replace(/^nostr:/i, '')
  return trimmed.toLowerCase().startsWith('naddr1')
    ? decodeNaddr(trimmed)
    : addressToPointer(trimmed)
}

/** 8-bit bytes to 5-bit bech32 symbols, zero-padding the final group. */
function toWords(bytes: number[]): number[] {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >>> bits) & 31)
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}

/**
 * Encode an address as `naddr1…`.
 *
 * The inverse of `decodeNaddr`, and needed for the same reason a decoder was:
 * this is the identifier every other app in the ecosystem speaks. Peek grew one
 * when the sidebar had to *hand an object back out* — a link into the owning
 * app, and an action addressed to a specific record — rather than only receive
 * one somebody pasted.
 *
 * Byte-identical to what Linear-lite produces for the same address, which the
 * roundtrip test pins: TLV order is identifier, relays, author, kind, and the
 * checksum is bech32, not bech32m (see the note at the top of this file).
 */
export function encodeNaddr(pointer: AddressPointer): string {
  const text = (value: string) => [...new TextEncoder().encode(value)]
  const bytes: number[] = []

  const push = (type: number, value: number[]) => bytes.push(type, value.length, ...value)

  push(0, text(pointer.identifier))
  for (const relay of pointer.relays) push(1, text(relay))
  const pubkey = pointer.pubkey.match(/.{2}/g)?.map((b) => Number.parseInt(b, 16)) ?? []
  if (pubkey.length !== 32) throw new Error(`author must be 32 bytes, got ${pubkey.length}`)
  push(2, pubkey)
  push(3, [
    (pointer.kind >>> 24) & 0xff,
    (pointer.kind >>> 16) & 0xff,
    (pointer.kind >>> 8) & 0xff,
    pointer.kind & 0xff,
  ])

  const words = toWords(bytes)
  const checksum = polymod([...hrpExpand('naddr'), ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const tail = [0, 1, 2, 3, 4, 5].map((i) => (checksum >>> (5 * (5 - i))) & 31)
  return `naddr1${[...words, ...tail].map((w) => CHARSET[w]).join('')}`
}

/**
 * Every `nostr:naddr1…` in a body of text (NIP-27).
 *
 * The character class is bech32's own alphabet, which excludes `1`, `b`, `i`
 * and `o`, so a match ends cleanly at punctuation without a lookahead.
 */
export const NADDR_RE = /nostr:(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)/gi

export function findNaddrs(text: string): string[] {
  return [...text.matchAll(NADDR_RE)].map((m) => m[1])
}

/**
 * The same text with every `nostr:naddr1…` taken out (PEEK-18).
 *
 * A reference that resolves into a widget should not also sit in the prose as
 * sixty characters of bech32: the widget *is* the reference, rendered.
 * Linear-lite appends one to every thread it starts about an issue, so leaving
 * it in means most cross-app messages open with a wall of noise nobody reads.
 *
 * Whitespace is repaired rather than merely removed. A pointer is usually
 * trailing or on a line of its own, and deleting it in place otherwise leaves a
 * double space mid-sentence or a hole between paragraphs — both of which look
 * like the message itself is broken. Runs of blanks collapse *within* a line
 * only, so indentation and paragraph breaks survive.
 *
 * Display-only. The stored body keeps the pointer, which is what lets the
 * reference still be found, resolved and followed.
 */
export function stripNaddrs(text: string): string {
  // Text with no pointer comes back byte-identical. The repairs below are only
  // ever justified by a removal, and a display helper that reflows somebody's
  // indentation for free would be a bug wearing a tidy-up's clothes.
  if (findNaddrs(text).length === 0) return text

  return (
    text
      // Take the blanks on either side along with the pointer, then put a single
      // space back only when it stood between words on one line. Doing it in one
      // pass is what keeps the repair local to the hole.
      .replace(
        new RegExp(`([^\\S\\n]*)${NADDR_RE.source}([^\\S\\n]*)`, 'gi'),
        (_match, before: string, _addr: string, after: string) => (before && after ? ' ' : ''),
      )
      // A pointer alone on its line leaves the line's newlines behind on both
      // sides, which reads as an unexplained gap.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
