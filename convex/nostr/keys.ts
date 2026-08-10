/**
 * Per-user Nostr keypairs, custodied by Peek's backend.
 *
 * **This is PoC-grade custody, deliberately** — see
 * docs/buzz-compat/IMPLEMENTATION_PLAN.md §6.1. Because Peek holds the secrets,
 * Peek can sign as any user: a signature proves the event came from Peek's
 * backend, not from the person. Two consequences that are decisions, not bugs:
 *
 *   - Iteration 1 relay data is throwaway. When identity moves to org- or
 *     user-held keys, everything signed under these keys becomes unverifiable.
 *   - Nothing here should be presented to users as cryptographic proof of
 *     authorship.
 *
 * Secrets are encrypted at rest with AES-256-GCM under a deployment-wide key
 * from `NOSTR_KEY_ENCRYPTION_SECRET`, so a database dump alone does not yield
 * signing keys. Cheap now, awkward to retrofit later.
 *
 * WebCrypto is used rather than an npm cipher so this has no dependency beyond
 * what signing already needs.
 */
import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha256'

const ENV_VAR = 'NOSTR_KEY_ENCRYPTION_SECRET'
const IV_BYTES = 12

/** A freshly minted identity. The secret is raw — encrypt before storing. */
export interface Keypair {
  publicKeyHex: string
  secretKeyHex: string
}

/** Mint a new secp256k1 keypair. */
export function generateKeypair(): Keypair {
  const secret = schnorr.utils.randomPrivateKey()
  return {
    secretKeyHex: bytesToHex(secret),
    publicKeyHex: bytesToHex(schnorr.getPublicKey(secret)),
  }
}

/**
 * Derive the AES key from the configured passphrase.
 *
 * Throws when unset: silently falling back to plaintext storage or a constant
 * key would be worse than failing to publish.
 */
async function encryptionKey(): Promise<CryptoKey> {
  const secret = process.env[ENV_VAR]
  if (!secret || secret.length < 32) {
    throw new Error(
      `${ENV_VAR} must be set to a random string of at least 32 characters ` +
        `(set it with: npx convex env set ${ENV_VAR} "$(openssl rand -hex 32)")`,
    )
  }
  // The passphrase is hashed to exactly 32 bytes so any sufficiently long
  // string works as input. This is not a password-KDF: the input is expected
  // to be high-entropy already, not user-chosen.
  const raw = sha256(new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Encrypt a hex secret key for storage. Output is base64 of `iv || ciphertext`. */
export async function encryptSecretKey(secretKeyHex: string): Promise<string> {
  const key = await encryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, hexToBytes(secretKeyHex) as unknown as BufferSource),
  )
  const packed = new Uint8Array(iv.length + ciphertext.length)
  packed.set(iv, 0)
  packed.set(ciphertext, iv.length)
  return toBase64(packed)
}

/** Reverse of {@link encryptSecretKey}. */
export async function decryptSecretKey(stored: string): Promise<string> {
  const key = await encryptionKey()
  const packed = fromBase64(stored)
  const iv = packed.slice(0, IV_BYTES)
  const ciphertext = packed.slice(IV_BYTES)
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext as unknown as BufferSource),
  )
  return bytesToHex(plaintext)
}
