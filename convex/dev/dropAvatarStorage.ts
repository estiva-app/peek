/**
 * Clear `avatarStorageId` and delete the blobs behind it (PEEK-42).
 *
 * A one-off, in the shape CLAUDE.md describes: **removing a field from a
 * validator fails the entire push** for every row still carrying it, so the
 * column can only leave `users` once no row has one.
 *
 *     npx convex run dev/dropAvatarStorage:sweep          # report only
 *     npx convex run dev/dropAvatarStorage:sweep '{"apply": true}'
 *
 * Unlike PEEK-41's sweep this has a second job, and it is the one that would be
 * missed: **each id points at a real blob in Convex file storage.** Clearing
 * only the column would leave those files behind, still billed and now
 * unreachable — nothing would name them again. So the blob goes first and the
 * column after, and if the delete throws the row is left alone rather than
 * orphaning the file.
 *
 * Nothing is lost that anyone can see. These avatars were never published —
 * Peek stopped being a `kind:0` writer at PEEK-31 — so they existed only inside
 * Peek, shadowing the picture Estiva ID publishes. After this, that real one
 * shows through; someone with no Estiva ID photo gets a silhouette until they
 * set one at id.estiva.app/account.
 */
import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

export const sweep = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { apply },
  ): Promise<{ carrying: number; cleared: number; blobsDeleted: number; remaining: number; failures: string[] }> => {
    const carrying = (await ctx.db.query('users').collect()).filter((u) => u.avatarStorageId)

    if (!apply) {
      return {
        carrying: carrying.length,
        cleared: 0,
        blobsDeleted: 0,
        remaining: carrying.length,
        failures: [],
      }
    }

    let blobsDeleted = 0
    let cleared = 0
    const failures: string[] = []
    for (const u of carrying) {
      try {
        // Blob first: if this throws, the row keeps pointing at the file and it
        // can be retried. Clearing the column first would strand it forever.
        await ctx.storage.delete(u.avatarStorageId!)
        blobsDeleted += 1
      } catch (e) {
        // Already gone is fine and common — `setAvatar` deleted the previous
        // blob on every replacement. Anything else is worth surfacing.
        failures.push(`${u.name}: ${e instanceof Error ? e.message : 'blob delete failed'}`)
      }
      await ctx.db.patch(u._id, { avatarStorageId: undefined })
      cleared += 1
    }

    const remaining = (await ctx.db.query('users').collect()).filter((u) => u.avatarStorageId).length
    return { carrying: carrying.length, cleared, blobsDeleted, remaining, failures }
  },
})
