/**
 * Clear Convex Auth's leftover columns from `users` (PEEK-41).
 *
 * A one-off, and the reason it has to exist rather than the fields simply being
 * deleted from the schema: **Convex rejects a push when a document carries a
 * field the validator does not declare.** Not a warning — the whole deploy
 * fails, including the parts unrelated to it:
 *
 *     Document with ID "…" in table "users" does not match the schema:
 *     Object contains extra field `nostrSecretKey` that is not in the validator.
 *
 * That is a real message from this project, seen while removing a different
 * column. It is why `emailVerificationTime`, `phoneVerificationTime` and
 * `isAnonymous` are still declared in `convex/schema.ts` and marked vestigial:
 * the code stopped using them the moment Convex Auth went, but the columns can
 * only leave the schema once no row carries them.
 *
 * So the order is: deploy this, run it, confirm `remaining: 0`, then delete the
 * three fields from the schema in a follow-up.
 *
 *     npx convex run dev/dropAuthFields:sweep          # report only
 *     npx convex run dev/dropAuthFields:sweep '{"apply": true}'
 *
 * Convex Auth's own tables (`authAccounts`, `authSessions`, …) need nothing
 * here. They left the schema entirely, and undeclared tables are not validated
 * — their rows are inert and unreachable rather than blocking.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

export const sweep = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { apply },
  ): Promise<{ carrying: number; cleared: number; remaining: number }> => {
    const users = await ctx.db.query('users').collect()
    const carrying = users.filter(
      (u) =>
        u.emailVerificationTime !== undefined ||
        u.phoneVerificationTime !== undefined ||
        u.isAnonymous !== undefined,
    )

    if (!apply) {
      // Dry by default. This is destructive in the sense that it edits every
      // row it touches, and a report first makes the blast radius visible.
      return { carrying: carrying.length, cleared: 0, remaining: carrying.length }
    }

    for (const u of carrying) {
      // `undefined` is how Convex removes a field; setting it to null would
      // leave a value behind and the push would still fail.
      await ctx.db.patch(u._id, {
        emailVerificationTime: undefined,
        phoneVerificationTime: undefined,
        isAnonymous: undefined,
      })
    }

    const after = await ctx.db.query('users').collect()
    const remaining = after.filter(
      (u) =>
        u.emailVerificationTime !== undefined ||
        u.phoneVerificationTime !== undefined ||
        u.isAnonymous !== undefined,
    ).length
    return { carrying: carrying.length, cleared: carrying.length, remaining }
  },
})
