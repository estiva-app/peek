'use node'

/**
 * Acting on another app's object, from inside Peek.
 *
 * The read side proved Peek can *render* a Linear-lite issue from a manifest.
 * This is the other half: Peek changes its status, and Linear-lite shows the
 * change — with neither app importing a line of the other's code.
 *
 * **Nothing here knows what Linear-lite is.** The kind to publish, the tag names
 * to use, which field an action sets and which values are legal all come off the
 * manifest at runtime. Hardcoding `1851` or `"status"` would turn this from a
 * protocol demonstration into an integration.
 *
 * ## Two things that make this honest rather than a trick
 *
 * **It is signed by the person who clicked.** Not by Peek, and not by the
 * borrowed reader identity the render path uses. A status change is an
 * attributable act; Linear-lite's activity feed will name whoever did it, and it
 * would be a lie if every change from Peek appeared under one service key.
 *
 * **It is a new event, never an edit.** NIP-33 addresses are
 * `(pubkey, kind, d)`, so Peek *cannot* rewrite Linear-lite's issue even if it
 * wanted to — and does not need to. That constraint is the reason the change-event
 * model exists (RFC_UPDATES.md §1.1), and this is where it pays off: a second app
 * writing to a first app's object requires no permission from the first app, no
 * API, and no coordination.
 */
import { v } from 'convex/values'
import { action } from '../_generated/server'
import { internal } from '../_generated/api'
import { publishEvent, queryEvents, relayUrl } from './bridge'
import { identityFor } from './publish'
import { signEvent } from './sign'
import { decodeNaddr, pointerToAddress } from './nip19'
import { buildActionEvent, resolveManifest } from './projection'

export interface ActResult {
  ok: boolean
  reason?: string
}

const fail = (reason: string): ActResult => ({ ok: false, reason })

/**
 * Perform a manifest-declared action on a foreign object.
 *
 * Returns `{ok:false, reason}` rather than throwing: every failure here is
 * something a user should read (not signed in, value not allowed, relay said
 * no), not an exception for a log nobody opens.
 */
export const applyAction = action({
  args: { naddr: v.string(), actionId: v.string(), value: v.string() },
  handler: async (ctx, { naddr, actionId, value }): Promise<ActResult> => {
    if (!relayUrl()) return fail('Nostr publishing is off (NOSTR_RELAY_URL is unset).')

    // Resolves by pubkey for Estiva ID identities. `getAuthUserId` was used
    // here and silently returned a pubkey instead of a user id for them.
    const userId = await ctx.runQuery(internal.users.viewerIdForAction, {})
    if (!userId) return fail('Sign in to change another app\'s object.')
    const identity = await identityFor(ctx, userId)
    if (!identity) {
      return fail(
        'Peek cannot sign as you yet: your key lives in Estiva ID, and Peek signs through it from PEEK-40 onwards.',
      )
    }

    let pointer
    try {
      pointer = decodeNaddr(naddr)
    } catch {
      return fail('That reference could not be decoded.')
    }
    const address = pointerToAddress(pointer)

    const query = async (filters: Record<string, unknown>[]) => {
      const { events } = await queryEvents(filters, identity)
      return events
    }

    const resolved = await resolveManifest(pointer, query)
    if (!resolved) return fail('No app claims this kind, so there is nothing to act on.')
    const { manifest } = resolved

    // The Folder has to come off the object itself. It is required on the event
    // we are about to publish, and asking the user for it would be absurd.
    const [root] = await query([
      { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 },
    ])
    if (!root) {
      return fail('That object is not readable from here — you may not have access to its Folder.')
    }
    const folder = root.tags.find((t) => t[0] === 'h')?.[1]
    if (!folder) return fail('That object has no Folder, so there is nowhere to write.')

    // `@me` lets the UI say "assign to me" without ever seeing a key. The
    // browser has no idea what this user's Nostr pubkey is, and should not —
    // key material lives on the server. Substituting here keeps it that way.
    const resolvedValue = value === '@me' ? identity.pubkey : value

    const built = buildActionEvent({
      manifest,
      kind: pointer.kind,
      address,
      objectAuthor: pointer.pubkey,
      folder,
      actionId,
      value: resolvedValue,
      pubkey: identity.pubkey,
      createdAtMs: Date.now(),
    })
    if (typeof built === 'string') return fail(built)

    const result = await publishEvent(signEvent(built, identity.secretKeyHex), identity)
    if (!result.ok) {
      return fail(result.reason ?? 'The relay rejected the change.')
    }
    return { ok: true }
  },
})
