// @vitest-environment edge-runtime

/**
 * CON-12, the publish half — a message's attachments reach the relay.
 *
 * `unsignedMessage` built the event from the body and nothing else, so a
 * `kind:9` on Buzz carried the words and not the files: the blob lived in
 * Convex storage under a `storageId` that means nothing outside this
 * deployment. Ship, the agent and every future app saw a message with nothing
 * on it, and nobody was told anything was missing.
 *
 * The sharp edge is the one these mostly cover: ingest runs `verify_imeta_blobs`
 * and **refuses a message whose blob it does not hold**. So naming a file that
 * did not upload does not degrade the attachment — it takes the whole message
 * down. A row with no `sha256` must therefore produce no `imeta` at all.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'
import { ESTIVA_ID_ISSUER } from './users'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

const ADA = 'a'.repeat(64)
const SHA = 'b'.repeat(64)
const asUser = (pubkey: string) => ({ issuer: ESTIVA_ID_ISSUER, subject: pubkey })

type FileRow = {
  storageId: Id<'_storage'>
  name: string
  contentType: string
  size: number
  sha256?: string
  mediaUrl?: string
  thumbUrl?: string
  dim?: string
}

/** A real `_storage` id — the validator rejects an invented one, and storing a
 *  byte is cheaper than hand-rolling something that only looks like an id. */
async function storageId(t: ReturnType<typeof convexTest>): Promise<Id<'_storage'>> {
  return await t.run(async (ctx) => await ctx.storage.store(new Blob(['x'])))
}

async function seed(t: ReturnType<typeof convexTest>, files: FileRow[]) {
  return await t.run(async (ctx) => {
    const ada = await ctx.db.insert('users', { name: 'Ada', nostrPubkey: ADA })
    const topicId = await ctx.db.insert('topics', {
      title: 'Planning',
      creatorId: ada,
      createdAt: 1,
      channelUuid: '11111111-1111-4111-8111-111111111111',
    })
    await ctx.db.insert('topicMembers', { topicId, userId: ada, addedAt: 1 })
    const messageId = await ctx.db.insert('messages', {
      parentKind: 'topic',
      parentId: topicId as string,
      authorId: ada,
      body: 'here is the screenshot',
      createdAt: Date.now(),
      seedKey: 'msg-1',
      fileAttachments: files,
    })
    return { ada, topicId, messageId }
  })
}

const uploadedWith = (storage: Id<'_storage'>): FileRow => ({
  storageId: storage,
  name: 'screenshot.png',
  contentType: 'image/png',
  size: 4096,
  sha256: SHA,
  mediaUrl: `/media/${SHA}.png`,
  thumbUrl: `/media/${SHA}.thumb.jpg`,
  dim: '800x600',
})

const localOnly = (storage: Id<'_storage'>): FileRow => ({
  storageId: storage,
  name: 'local.png',
  contentType: 'image/png',
  size: 10,
})

const imetaOf = (unsigned: { tags: string[][] }) => unsigned.tags.filter((t) => t[0] === 'imeta')

describe('unsignedMessage carries its attachments', () => {
  it('names an uploaded file in an imeta tag', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, [uploadedWith(await storageId(t))])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    const tags = imetaOf(built.unsigned as { tags: string[][] })
    expect(tags).toHaveLength(1)
    expect(tags[0]).toContain(`x ${SHA}`)
    expect(tags[0]).toContain(`url /media/${SHA}.png`)
    expect(tags[0]).toContain('m image/png')
    expect(tags[0]).toContain('size 4096')
  })

  it('carries the relay’s own dim and thumbnail, and the person’s filename', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, [uploadedWith(await storageId(t))])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })
    if (!built.ok) throw new Error('expected an event')
    const tag = imetaOf(built.unsigned as { tags: string[][] })[0]
    expect(tag).toContain('dim 800x600')
    expect(tag).toContain(`thumb /media/${SHA}.thumb.jpg`)
    expect(tag).toContain('filename screenshot.png')
  })

  /*
    The one that matters. `verify_imeta_blobs` refuses a message whose blob the
    relay does not hold, so an `imeta` for a file that never uploaded would not
    degrade the attachment — it would stop the message publishing at all.
  */
  it('omits a file that never reached the relay, rather than naming it', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, [localOnly(await storageId(t))])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(imetaOf(built.unsigned as { tags: string[][] })).toEqual([])
  })

  it('  …and still publishes the message', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, [localOnly(await storageId(t))])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.unsigned.content).toBe('here is the screenshot')
  })

  it('takes the uploaded ones and leaves the rest', async () => {
    const t = convexTest(schema, modules)
    const storage = await storageId(t)
    const { messageId } = await seed(t, [uploadedWith(storage), localOnly(await storageId(t))])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })
    if (!built.ok) throw new Error('expected an event')
    expect(imetaOf(built.unsigned as { tags: string[][] })).toHaveLength(1)
  })

  it('emits no imeta for a message with no files at all', async () => {
    const t = convexTest(schema, modules)
    const { messageId } = await seed(t, [])
    const built = await t.withIdentity(asUser(ADA)).query(api.nostr.outbox.unsignedMessage, { messageId })
    if (!built.ok) throw new Error('expected an event')
    expect(imetaOf(built.unsigned as { tags: string[][] })).toEqual([])
  })
})
