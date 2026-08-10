/**
 * What PEEK-37 would actually have to move — counts and pubkeys only.
 *
 * Deliberately never returns `nostrSecretKey`. The point of the migration is
 * that custodied secrets move between two services without passing through
 * anybody's terminal, so an audit that prints them would undermine the thing it
 * is auditing.
 */
import { internalQuery, query } from '../_generated/server'

export const custodyAudit = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()

    const withSecret = users.filter((u) => Boolean(u.nostrSecretKey))
    const withPubkeyOnly = users.filter((u) => u.nostrPubkey && !u.nostrSecretKey)

    return {
      total: users.length,
      // The migration set: Peek accounts whose keys this service custodies.
      custodied: withSecret.length,
      // Strangers seen on the relay. Nothing to migrate — no secret exists.
      externalOnly: withPubkeyOnly.length,
      noKeyAtAll: users.filter((u) => !u.nostrPubkey).length,
      custodiedPubkeys: withSecret.map((u) => ({
        name: u.name,
        pubkey: u.nostrPubkey ?? null,
        isExternal: u.isExternal ?? false,
        hasEmail: Boolean(u.email),
      })),
    }
  },
})

/**
 * The migration payload for PEEK-37.
 *
 * `internalQuery`, not `query`: this returns the encrypted secret blobs, and
 * while they are useless without `NOSTR_KEY_ENCRYPTION_SECRET`, handing
 * ciphertext to any client that asks is a gift to someone who later obtains the
 * passphrase. Reachable only through `npx convex run`, which needs admin
 * credentials.
 *
 * The blobs move **still encrypted**. Estiva ID decrypts them in-process and
 * immediately re-seals them into its own envelope, so the plaintext secret never
 * exists in a file, a terminal, or anyone's scrollback.
 */
export const exportCustodiedKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    return users
      .filter((u) => u.nostrSecretKey && u.nostrPubkey)
      .map((u) => ({
        name: u.name,
        email: u.email ?? null,
        pubkey: u.nostrPubkey as string,
        encryptedSecret: u.nostrSecretKey as string,
      }))
  },
})
