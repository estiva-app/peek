// @vitest-environment edge-runtime

/**
 * CON-12, the read half — a file attached in another app reaches Peek.
 *
 * `attachmentPublishing.test.ts` is the mirror of this: it pins that Peek's own
 * files leave in an `imeta`. Until this, nothing read one back, so the exchange
 * only ever went one way — Ship could show Peek's screenshots and Peek showed
 * a Ship message with nothing on it, which is SHI-1's complaint pointing the
 * other direction.
 *
 * The shape that makes it work, and the thing most likely to be undone by
 * accident: **an imported file has no `storageId`.** The bytes are on the relay
 * and this deployment holds no copy, so every path that assumed a storage id —
 * resolving a URL, deleting a blob, keeping a file across an edit — has to have
 * an answer for a row without one.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import { attachmentsOf } from './nostr/sync'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const SHA = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const RELAY = 'https://estiva.example'
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

const event = (tags: string[][], id = 'e1') => ({
  id,
  pubkey: ADA,
  created_at: 1_700_000_000,
  kind: 9,
  tags: [['h', '11111111-1111-4111-8111-111111111111'], ...tags],
  content: 'here it is',
  sig: '0'.repeat(128),
})

const imeta = (parts: string[]) => ['imeta', ...parts]
const full = [`url ${RELAY}/media/${SHA}.png`, 'm image/png', `x ${SHA}`, 'size 4096']

describe('attachmentsOf — imeta to storable rows', () => {
  it('reads a file off a message', () => {
    expect(attachmentsOf(event([imeta(full)]))).toEqual([
      { name: 'attachment', contentType: 'image/png', size: 4096, sha256: SHA, mediaUrl: `${RELAY}/media/${SHA}.png`, thumbUrl: undefined, dim: undefined },
    ])
  })

  it('has no storageId, because there is no blob in this deployment', () => {
    expect(attachmentsOf(event([imeta(full)]))[0]).not.toHaveProperty('storageId')
  })

  it('prefers the sender’s filename, falls back to alt, then to a last resort', () => {
    expect(attachmentsOf(event([imeta([...full, 'filename shot.png', 'alt a screenshot'])]))[0].name).toBe('shot.png')
    expect(attachmentsOf(event([imeta([...full, 'alt a screenshot'])]))[0].name).toBe('a screenshot')
    expect(attachmentsOf(event([imeta(full)]))[0].name).toBe('attachment')
  })

  it('carries the relay’s thumbnail and dimensions when it made them', () => {
    const [file] = attachmentsOf(event([imeta([...full, `thumb ${RELAY}/media/${SHA}.thumb.jpg`, 'dim 800x600'])]))
    expect(file.thumbUrl).toBe(`${RELAY}/media/${SHA}.thumb.jpg`)
    expect(file.dim).toBe('800x600')
  })

  /*
    A malformed tag is skipped whole rather than half-read. `size` missing would
    otherwise store 0 and render as a zero-byte file, which reads as a broken
    upload rather than as a sender who wrote a bad tag. Ship folds identically.
  */
  it('skips a malformed imeta rather than storing half of it', () => {
    expect(attachmentsOf(event([imeta([`url ${RELAY}/media/${SHA}.png`, 'm image/png', `x ${SHA}`])]))).toEqual([])
  })

  it('reads several, in the order the sender wrote them', () => {
    const second = [`url ${RELAY}/media/${OTHER}.png`, 'm image/png', `x ${OTHER}`, 'size 10']
    expect(attachmentsOf(event([imeta(full), imeta(second)])).map((f) => f.sha256)).toEqual([SHA, OTHER])
  })

  it('finds nothing on a message that carries none', () => {
    expect(attachmentsOf(event([]))).toEqual([])
  })
})

describe('an imported file survives into what the browser reads', () => {
  const relayRow = {
    name: 'shot.png',
    contentType: 'image/png',
    size: 4096,
    sha256: SHA,
    mediaUrl: `${RELAY}/media/${SHA}.png`,
    thumbUrl: `${RELAY}/media/${SHA}.thumb.jpg`,
  }

  async function seed(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: ADA })
      const topicId = await ctx.db.insert('topics', {
        title: 'Planning',
        creatorId: ada,
        createdAt: 1,
        channelUuid: '11111111-1111-4111-8111-111111111111',
      })
      await ctx.db.insert('topicMembers', { topicId, userId: ada, addedAt: 1 })
      return { ada, topicId }
    })
  }

  it('importMessage stores it, and list hands back a relay row rather than a storage URL', async () => {
    const t = convexTest(schema, modules)
    const { ada, topicId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.importMessage, {
        parentKind: 'topic',
        parentId: topicId as string,
        authorId: ada,
        body: 'here it is',
        createdAt: Date.now(),
        nostrEventId: 'e-imported',
        files: [relayRow],
      })
    })

    const { rows } = await t
      .withIdentity(asUser(ADA))
      .query(api.messages.list, { parentKind: 'topic', parentKey: topicId as string })
    /*
      Indexed, not `rows.at(-1)`. `convex/tsconfig.json` pins `lib: ES2021` and
      `Array.prototype.at` is ES2022, so `at` typechecks under the app's config
      and under the PR's `check` job, then fails the Convex typecheck that runs
      inside `convex deploy` — green CI, broken deploy.
    */
    const files = rows[rows.length - 1]?.files
    expect(files).toHaveLength(1)
    /*
      `mediaUrl` and not `url`, and the distinction is the whole point: an
      `<img src>` on a relay path answers 401, so the browser must know to sign
      a read rather than to load it. A row carrying `url` would be drawn
      directly and fail as a broken image with nothing to explain it.
    */
    expect(files?.[0]).toMatchObject({ name: 'shot.png', mediaUrl: relayRow.mediaUrl, sha256: SHA })
    expect(files?.[0]).not.toHaveProperty('url')
    expect(files?.[0]).not.toHaveProperty('storageId')
  })

  it('deleting the message does not choke on a file it has no blob for', async () => {
    const t = convexTest(schema, modules)
    const { ada, topicId } = await seed(t)
    await t.run(async (ctx) => {
      await ctx.runMutation(internal.nostr.data.importMessage, {
        parentKind: 'topic',
        parentId: topicId as string,
        authorId: ada,
        body: 'here it is',
        createdAt: Date.now(),
        nostrEventId: 'e-imported',
        files: [relayRow],
      })
    })
    const key = 'e-imported'
    await expect(t.withIdentity(asUser(ADA)).mutation(api.messages.remove, { key })).resolves.not.toThrow()
  })

  /*
    The regression this is really here for. `editFiles` keyed its kept-set on
    `storageId`; every relay file has `undefined` there, so a single set entry
    stood for all of them and editing a message would have stripped somebody
    else's attachment. Ship and Peek share an Estiva ID pubkey, so an imported
    message can genuinely be the viewer's own to edit — the author check does
    not catch it.
  */
  it('editing a message keeps an imported file that is still in the list', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seed(t)
    const kept = { ...relayRow }
    const dropped = { ...relayRow, name: 'other.png', sha256: OTHER, mediaUrl: `${RELAY}/media/${OTHER}.png` }
    await t.run(async (ctx) => {
      // A DM: a topic's message takes no edit since CON-8 (Stop writing
      // messages to Convex); the file rule still holds where edits remain.
      const bea = await ctx.db.insert('users', { name: 'Bea', nostrPubkey: 'c'.repeat(64) })
      const [userLowId, userHighId] = (ada as string) < (bea as string) ? [ada, bea] : [bea, ada]
      const dmId = await ctx.db.insert('dmConversations', { userLowId, userHighId, createdAt: 1 })
      await ctx.runMutation(internal.nostr.data.importMessage, {
        parentKind: 'dm',
        parentId: dmId as string,
        authorId: ada,
        body: 'two files',
        createdAt: Date.now(),
        nostrEventId: 'e-imported',
        files: [kept, dropped],
      })
    })

    await t.withIdentity(asUser(ADA)).mutation(api.messages.editFiles, { key: 'e-imported', files: [kept] })

    const rows = await t.run(async (ctx) => {
      const m = await ctx.db
        .query('messages')
        .withIndex('by_nostrEventId', (q) => q.eq('nostrEventId', 'e-imported'))
        .unique()
      return m?.fileAttachments
    })
    expect(rows?.map((f) => f.sha256)).toEqual([SHA])
  })
})

/** `Id<'_storage'>` is only referenced to keep the import honest in strict mode. */
export type _Unused = Id<'_storage'>
