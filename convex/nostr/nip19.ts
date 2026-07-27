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
 * Every `nostr:naddr1…` in a body of text (NIP-27).
 *
 * The character class is bech32's own alphabet, which excludes `1`, `b`, `i`
 * and `o`, so a match ends cleanly at punctuation without a lookahead.
 */
export const NADDR_RE = /nostr:(naddr1[023456789acdefghjklmnpqrstuvwxyz]+)/gi

export function findNaddrs(text: string): string[] {
  return [...text.matchAll(NADDR_RE)].map((m) => m[1])
}
