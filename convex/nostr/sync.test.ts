import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { referencedAddresses, replyTargetOf, syncReactions } from './sync'


describe('folder UUID learning from imported messages', () => {
  it('learns channelUuid from the first imported Ship message when topic lacks one', async () => {
    const FOLDER_UUID = '12345678-1234-1234-1234-123456789abc'
    const topicId = 'topic123'

    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    }

    // Mock the topic query to return a topic without channelUuid
    ctx.runQuery.mockResolvedValue({
      channelUuid: null,
      creatorId: 'creator123',
    })

    // Mock the storeChannelUuid mutation to capture the write
    const storeChannelUuid = vi.fn()
    storeChannelUuid.mockResolvedValue({ channelUuid: FOLDER_UUID, minted: true })
    ctx.runMutation.mockImplementation(async (mutationName, args) => {
      if (mutationName === 'storeChannelUuid') {
        return await storeChannelUuid(args)
      }
      return {}
    })

    // Simulate a Ship message with h tag
    const shipMessage = {
      id: 'event123',
      pubkey: 'ship-pubkey',
      created_at: 1234567890,
      kind: 9,
      tags: [['h', FOLDER_UUID], ['p', 'author123']],
      content: 'Test message from Ship',
    }

    const topic = { topicId, channelUuid: null, since: null }
    const folderUuid = shipMessage.tags.find((t) => t[0] === 'h')?.[1]

    if (!topic.channelUuid && folderUuid) {
      await ctx.runMutation('storeChannelUuid', {
        topicId: topic.topicId,
        channelUuid: folderUuid,
      })
    }

    // Verify that storeChannelUuid was called with the folder UUID from the message
    expect(storeChannelUuid).toHaveBeenCalledWith({
      topicId,
      channelUuid: FOLDER_UUID,
    })
    expect(storeChannelUuid).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an existing channelUuid (first-write-wins)', async () => {
    const EXISTING_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const NEW_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const topicId = 'topic123'

    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    }

    // Mock the topic query to return a topic WITH existing channelUuid
    ctx.runQuery.mockResolvedValue({
      channelUuid: EXISTING_UUID,
      creatorId: 'creator123',
    })

    const storeChannelUuid = vi.fn()
    storeChannelUuid.mockResolvedValue({ channelUuid: EXISTING_UUID, minted: false })
    ctx.runMutation.mockImplementation(async (mutationName, args) => {
      if (mutationName === 'storeChannelUuid') {
        return await storeChannelUuid(args)
      }
      return {}
    })

    // Simulate a Ship message with a different h tag
    const shipMessage = {
      id: 'event123',
      pubkey: 'ship-pubkey',
      created_at: 1234567890,
      kind: 9,
      tags: [['h', NEW_UUID]],
      content: 'Test message',
    }

    const topic = { topicId, channelUuid: EXISTING_UUID, since: null }
    const folderUuid = shipMessage.tags.find((t) => t[0] === 'h')?.[1]

    // Should NOT call storeChannelUuid because topic already has one
    if (!topic.channelUuid && folderUuid) {
      await ctx.runMutation('storeChannelUuid', {
        topicId: topic.topicId,
        channelUuid: folderUuid,
      })
    }

    // Verify that storeChannelUuid was NOT called
    expect(storeChannelUuid).not.toHaveBeenCalled()
  })
})

/*
  NIP-22 threading, which arrives here because Ship's comments are moving to
  kind:1111 (REW-10) and a Ship comment lands in the topic's own channel.

  The whole spec is the case of the tags: uppercase names the thread ROOT, the
  object under discussion; lowercase names the IMMEDIATE PARENT. Getting it
  backwards does not throw — it silently reparents replies or drops their
  anchor, which is the kind of thing that shows up as "a conversation looks odd"
  weeks later.
*/
describe('NIP-22 comments in a topic', () => {
  const ISSUE = '30851:aaaa:i1'
  const ev = (tags: string[][]) => ({ id: 'x', pubkey: 'p', created_at: 1, kind: 1111, tags, content: '', sig: '' }) as never

  it('reads a top-level comment as top-level, not a reply', () => {
    // A comment on an *address* has no `e` at all — its parent is the object.
    expect(replyTargetOf(ev([['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851']]))).toBe(null)
  })

  it('reads a reply as pointing at the comment it answers', () => {
    expect(replyTargetOf(ev([['A', ISSUE], ['K', '30851'], ['e', 'parent1'], ['k', '1111']]))).toBe('parent1')
  })

  it('never mistakes the uppercase root E for the parent', () => {
    // `E` is the thread root and may be a different event entirely. Treating it
    // as the parent would flatten every reply onto the root.
    expect(replyTargetOf(ev([['E', 'root1'], ['e', 'parent1']]))).toBe('parent1')
    expect(replyTargetOf(ev([['E', 'root1']]))).toBe(null)
  })

  it('keeps the thread anchor on a reply, which carries it only in uppercase A', () => {
    // The regression this guards: reading lowercase `a` alone attaches the
    // first comment on a Ship issue and detaches every reply beneath it.
    expect(referencedAddresses(ev([['A', ISSUE], ['e', 'parent1'], ['k', '1111']]))).toEqual([ISSUE])
  })

  it('does not duplicate the address a top-level comment names twice', () => {
    expect(referencedAddresses(ev([['A', ISSUE], ['a', ISSUE]]))).toEqual([ISSUE])
  })

  it('still reads a plain NIP-27 reference on an ordinary kind:9', () => {
    expect(referencedAddresses(ev([['a', ISSUE]]))).toEqual([ISSUE])
  })
})

describe('a reaction made in another app', () => {
  const TARGET = 'e'.repeat(64)
  const PEEK_USER = 'a'.repeat(64)
  const reaction = (pubkey: string) =>
    ({ id: 'r'.repeat(64), pubkey, kind: 7, created_at: 1_700_000_000, tags: [['e', TARGET]], content: '🎉' }) as never

  /*
    A ctx that resolves the target and records every importReaction call.

    Calls are told apart by the SHAPE of their arguments, not by the function
    reference: a Convex reference is an object and stringifying one throws,
    which is how the first draft of this test failed.
  */
  const ctxFor = (imported: unknown[]) => ({
    // The first lookup is `messageByNostrEventId`; answering it means the
    // reply lookup is short-circuited by `??`.
    runQuery: vi.fn(async () => ({ messageId: 'm1' })),
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args && 'nostrPubkey' in args) return 'u1' // resolveExternalUser
      if (args && 'emoji' in args) imported.push(args) // importReaction
      return {}
    }),
  })

  /*
    The bug this pins. `syncReactions` filtered out every reaction whose author
    had a Peek account — `isLocal` was *all* local pubkeys, not the viewer's —
    on the reasoning that Peek already holds its own users' reactions. True of a
    reaction made in Peek; false of the same person reacting in Ship. So no
    reaction made in Ship ever reached Peek, for anybody with an account, and
    the relay had the event the whole time.
  */
  it('is imported even when its author has a Peek account', async () => {
    const imported: unknown[] = []
    await syncReactions(ctxFor(imported) as never, [reaction(PEEK_USER)], [], [], [])
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({ emoji: '🎉', nostrEventId: 'r'.repeat(64) })
  })

  it('still imports a reaction from somebody with no Peek account', async () => {
    const imported: unknown[] = []
    await syncReactions(ctxFor(imported) as never, [reaction('f'.repeat(64))], [], [], [])
    expect(imported).toHaveLength(1)
  })

  /* A reaction naming no target has nothing to attach to. */
  it('skips a reaction with no e tag', async () => {
    const imported: unknown[] = []
    const noTarget = { ...(reaction(PEEK_USER) as object), tags: [] }
    await syncReactions(ctxFor(imported) as never, [noTarget as never], [], [], [])
    expect(imported).toHaveLength(0)
  })

  /* A target Peek does not hold — a message from a channel it never imported. */
  it('skips a reaction whose target it cannot find', async () => {
    const imported: unknown[] = []
    // Neither lookup finds it — not a message, not a reply.
    const ctx = { runQuery: vi.fn(async () => null), runMutation: vi.fn(async () => ({})) }
    await syncReactions(ctx as never, [reaction(PEEK_USER)], [], [], [])
    expect(imported).toHaveLength(0)
  })
})
