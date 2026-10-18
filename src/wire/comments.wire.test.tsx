/**
 * Comments and messages, at the wire (UNI-7): what reaches the relay when a
 * person comments or replies, through the conversation hook the composer
 * calls (`useFileConversation(...).actions`), in a file's conversation and in
 * a topic's. The builders' own tests (`src/nostr/fileConversation.test.ts`)
 * check the event one step before it leaves; these check what the person's
 * action sends, in what order, and what a refusal stops.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { installWireRelay, ME, signed, tagOf, tagsOf, type WireRelay } from '@/test/wireRelay'
import { useFileConversation } from '@/api/useFileConversation'
import type { ConversationContainer, ConversationEvent } from '@/nostr/fileConversation'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

/*
  The copy on the device draws a conversation while the relay is asked (PEE-4);
  it is a read, not part of any write. Here there is no copy. Nothing tests
  the module itself yet (`useFileConversation.test.tsx` mocks it too); that
  is on the Unit tests project's Later list. Left in, its read
  shares interop's in-flight manifest sweep with the relay's, so a copy that
  cannot answer it fails the relay's read too — a finding of UNI-7, in its PR.
*/
vi.mock('@/nostr/conversationFromCopy', () => ({
  conversationFromCopy: async () => {
    throw new Error('no copy on this device')
  },
}))

const CATH ='a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const BARE_FILE = 30840
const ADDRESS = `${BARE_FILE}:${CATH}:estiva-suits-updates`
const file: ConversationContainer = { kind: 'file', address: ADDRESS, h: FOLDER }
const topic: ConversationContainer = { kind: 'channel', h: FOLDER }

const manifest = signed(
  {
    kind: 31990,
    tags: [['d', 'bare-file'], ['k', String(BARE_FILE)]],
    content: JSON.stringify({
      name: 'File',
      projections: { [BARE_FILE]: { widget: 'card', slots: { title: { tag: 'title' } } } },
      actions: [{ id: 'comment', label: 'Comment', appliesTo: String(BARE_FILE), emits: { kind: 1111, scope: 'address' }, input: { type: 'string' } }],
    }),
  },
  CATH,
)
const theFile = signed({ kind: BARE_FILE, tags: [['d', 'estiva-suits-updates'], ['title', 'Estiva Suits Updates'], ['h', FOLDER]] }, CATH)
const cathsComment = signed(
  {
    kind: 1111,
    created_at: 1_700_000_100,
    content: 'First',
    tags: [['A', ADDRESS], ['K', String(BARE_FILE)], ['P', CATH], ['a', ADDRESS], ['k', String(BARE_FILE)], ['p', CATH], ['h', FOLDER]],
  },
  CATH,
)
const cathsMessage = signed({ kind: 9, created_at: 1_700_000_100, content: 'Morning', tags: [['h', FOLDER]] }, CATH)

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(manifest, theFile, cathsComment, cathsMessage)
})
afterAll(() => vi.unstubAllGlobals())

/** The conversation as the composer has it, once it has drawn `count` top-level entries. */
async function conversation(container: ConversationContainer, roots: string[] = [], count = 0) {
  const hook = renderHook(() => useFileConversation(container, container.kind === 'file' ? roots : []))
  await waitFor(() => {
    const state = hook.result.current.state
    expect(typeof state === 'object' && 'roots' in state && state.roots.length >= count).toBe(true)
  })
  return hook
}
const rootsOf = (hook: Awaited<ReturnType<typeof conversation>>) =>
  (hook.result.current.state as { roots: ConversationEvent[] }).roots

describe("a file's conversation at the wire", () => {
  it('a comment is one 1111 on the file, in its Folder, signed as the viewer', async () => {
    const hook = await conversation(file, [cathsComment.id], 1)
    const result = await hook.result.current.actions.comment('Looks good')

    expect(result.ok).toBe(true)
    const sent = relay.sentOf(1111)
    expect(sent).toHaveLength(1)
    const [comment] = sent
    expect(comment.pubkey).toBe(ME)
    expect(comment.content).toBe('Looks good')
    expect(tagOf(comment, 'A')).toBe(ADDRESS)
    expect(tagOf(comment, 'h')).toBe(FOLDER)
    // A top-level comment names no parent comment.
    expect(tagsOf(comment, 'e')).toEqual([])
    expect(result.ok && result.id).toBe(comment.id)
  })

  it('a reply names the comment it answers as its parent, under the same file', async () => {
    const hook = await conversation(file, [cathsComment.id], 1)
    const parent = rootsOf(hook).find((root) => root.id === cathsComment.id)!
    const result = await hook.result.current.actions.reply(parent, 'Agreed')

    expect(result.ok).toBe(true)
    const [reply] = relay.sentOf(1111)
    expect(tagOf(reply, 'A')).toBe(ADDRESS)
    expect(tagOf(reply, 'e')).toBe(cathsComment.id)
    expect(tagOf(reply, 'k')).toBe('1111')
    expect(tagOf(reply, 'p')).toBe(CATH)
    expect(tagOf(reply, 'h')).toBe(FOLDER)
  })

  it('a refused comment is reported, sent once, and not retried', async () => {
    relay.refuse({ when: (event) => event.kind === 1111, message: 'restricted: not a channel member' })
    const hook = await conversation(file, [cathsComment.id], 1)
    const result = await hook.result.current.actions.comment('Hello?')

    expect(result.ok).toBe(false)
    expect(relay.sentOf(1111)).toHaveLength(1)
  })

})

describe("a topic's talk at the wire", () => {
  it('a message is one kind:9 in the Folder, with no file anchor', async () => {
    const hook = await conversation(topic, [], 1)
    const result = await hook.result.current.actions.comment('Hi all')

    expect(result.ok).toBe(true)
    const sent = relay.sentOf(9)
    expect(sent).toHaveLength(1)
    const [message] = sent
    expect(message.pubkey).toBe(ME)
    expect(message.content).toBe('Hi all')
    expect(message.tags[0]).toEqual(['h', FOLDER])
    expect(tagOf(message, 'A')).toBeUndefined()
    expect(tagsOf(message, 'e')).toEqual([])
    expect(relay.sentOf(1111)).toEqual([])
  })

  it('a reply in a topic points at the message it answers, marked as a reply', async () => {
    const hook = await conversation(topic, [], 1)
    const parent = rootsOf(hook).find((root) => root.id === cathsMessage.id)!
    const result = await hook.result.current.actions.reply(parent, 'Morning!')

    expect(result.ok).toBe(true)
    const [reply] = relay.sentOf(9)
    expect(reply.tags.filter((t) => t[0] === 'e')).toEqual([['e', cathsMessage.id, expect.any(String), 'reply']])
    expect(tagOf(reply, 'h')).toBe(FOLDER)
  })
})
