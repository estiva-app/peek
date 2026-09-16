/**
 * SHR-7, the deciding query: does the per-person screener/open-work state fit
 * in a `kind:30078` blob, on real data?
 *
 * Four of ADR 0001 §3's five — query, index, aggregation, server-side compute —
 * are settled by reading `convex/screener.ts` and `convex/desk.ts`: every access
 * is `by_user` followed by a JS `.find()` / `.some()` / `Set`. **Size** is the
 * only leg that needs the deployment, and this is what reads it.
 *
 * Run it against the deployment Peek actually uses (CLAUDE.md: NOT `--prod`):
 *
 *   npx convex run dev/shr7BlobBound:report \
 *     --url https://honorable-guineapig-592.eu-west-1.convex.cloud \
 *     --admin-key '<deploy key>'
 *
 * It decides layer 2 if `worst.openWorkBytes` and `worst.decisionsBytes` are a
 * small fraction of `MAX_PLAINTEXT_BYTES`, and decides against it — or forces an
 * eviction rule — if either approaches it. `rowsBytes` is the control: the same
 * state lifted into a blob *whole*, preview and all, which is the shape that
 * does not fit and is why the recommendation is a fold rather than a copy.
 *
 * Dev-only and disposable: this is a spike's instrument, not app code.
 */
import { query } from '../_generated/server'

/** `POST /nip44/encrypt` refuses a plaintext over this many bytes (SPEC §12.5). */
const MAX_PLAINTEXT_BYTES = 65535

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

export const report = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect()
    const now = Date.now()

    interface Row {
      user: string
      screenerRows: number
      openWorkRows: number
      openWorkBytes: number
      decisionsBytes: number
      rowsBytes: number
    }
    const per: Row[] = []
    for (const user of users) {
      const screener = await ctx.db
        .query('screenerItems')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .collect()
      const openWork = await ctx.db
        .query('deskOpenWork')
        .withIndex('by_user', (q) => q.eq('userId', user._id))
        .collect()

      // Blob A — open work, on the shape `src/nostr/stars.ts` already publishes.
      const topicIds = openWork.filter((w) => w.kind === 'topic').map((w) => w.targetId)
      const channelUuid = new Map<string, string>()
      for (const id of topicIds) {
        const normalized = ctx.db.normalizeId('topics', id)
        const topic = normalized ? await ctx.db.get(normalized) : null
        if (topic?.channelUuid) channelUuid.set(id, topic.channelUuid)
      }
      const openWorkBlob = {
        v: 1,
        updatedAt: now,
        topics: topicIds.map((id) => ({
          id,
          ...(channelUuid.has(id) ? { channelUuid: channelUuid.get(id)! } : {}),
        })),
        people: openWork.filter((w) => w.kind === 'dm').map((w) => ({ key: w.targetId })),
      }

      // Blob B — the screener's *decisions* only. The rows themselves are a fold
      // over messages + membership + read state, so nothing derived is stored.
      const decisionsBlob = {
        v: 1,
        updatedAt: now,
        snoozed: Object.fromEntries(
          screener
            .filter((s) => s.snoozedUntil !== undefined)
            .map((s) => [s.targetId, Math.floor(s.snoozedUntil! / 1000)]),
        ),
        dismissed: {} as Record<string, number>,
      }

      // Control — the same state lifted whole, preview included.
      const rowsBlob = {
        v: 1,
        updatedAt: now,
        items: screener.map((s) => ({
          kind: s.kind,
          targetId: s.targetId,
          preview: s.preview,
          messageId: s.messageId ?? null,
          createdAt: s.createdAt,
        })),
      }

      per.push({
        user: user.name,
        screenerRows: screener.length,
        openWorkRows: openWork.length,
        openWorkBytes: bytes(openWorkBlob),
        decisionsBytes: bytes(decisionsBlob),
        rowsBytes: bytes(rowsBlob),
      })
    }

    const max = (pick: (r: Row) => number) => per.reduce((acc, r) => Math.max(acc, pick(r)), 0)

    return {
      cap: MAX_PLAINTEXT_BYTES,
      users: per.length,
      worst: {
        screenerRows: max((r) => r.screenerRows),
        openWorkRows: max((r) => r.openWorkRows),
        openWorkBytes: max((r) => r.openWorkBytes),
        decisionsBytes: max((r) => r.decisionsBytes),
        rowsBytes: max((r) => r.rowsBytes),
      },
      per: per.sort((a, b) => b.rowsBytes - a.rowsBytes),
    }
  },
})
