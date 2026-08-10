/**
 * BIP-340 Schnorr signing for Nostr events.
 *
 * Split out from `events.ts` because signing needs entropy (`@noble/curves`
 * draws auxiliary randomness per signature), so this module only runs where a
 * CSPRNG is available. Callers are Convex **actions** marked `"use node"`;
 * mutations cannot use this.
 */
import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { computeEventId, type SignedEvent, type UnsignedEvent } from './events'

/** Derive the 64-char hex x-only public key for a secret key. */
export function publicKeyFromSecret(secretKeyHex: string): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secretKeyHex)))
}

/**
 * Compute the event id and sign it, producing a relay-submittable event.
 *
 * Throws if `unsigned.pubkey` does not match the secret key — a mismatch would
 * produce an event the relay silently rejects as an invalid signature, which is
 * painful to debug from the other side.
 */
export function signEvent(unsigned: UnsignedEvent, secretKeyHex: string): SignedEvent {
  const derived = publicKeyFromSecret(secretKeyHex)
  if (derived !== unsigned.pubkey) {
    throw new Error(
      `pubkey mismatch: event declares ${unsigned.pubkey.slice(0, 16)}… but the secret key derives ${derived.slice(0, 16)}…`,
    )
  }
  const id = computeEventId(unsigned)
  const sig = bytesToHex(schnorr.sign(id, hexToBytes(secretKeyHex)))
  return { ...unsigned, id, sig }
}
