/**
 * PRO-11's last clause: the `web` template must name a URL that opens the object.
 *
 * NIP-89 lets an app say "open one of my objects here". Peek published that
 * claim before it had any routing, so a consumer resolved a Topic, offered
 * "open in Peek", and landed the person on their desk — the failure RFC 0.4
 * §13.6 names: renders fine, quietly does less.
 */
import { describe, expect, it, vi } from 'vitest'

// Anything not answered by a test is an empty read — a channel with no `39000`, say.
const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn(async (..._args: unknown[]) => ({ ok: true, events: [] as unknown[] })) }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { placeForReferenceAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const MESSAGE_ID = 'c'.repeat(64)
const token = { accessToken: 't', pubkey: AUTHOR } as never
const resolve = (reference: string) => placeForReferenceAsViewer(reference, 'https://relay.test', token)

describe('a Topic answers from the pointer, with no read at all', () => {
  it('reads the channel uuid out of the naddr', async () => {
    /*
      A Topic's `d` *is* the channel uuid — measured across all 50 production
      channels (RFC 0.4 §5.2). So the answer is already in the reference and
      fetching would be asking a question we hold the answer to.
    */
    queryRelay.mockClear()
    expect(await resolve(`nostr:${addrToNaddr(`39000:${AUTHOR}:${FOLDER}`, [])}`)).toEqual({ folder: FOLDER })
    expect(queryRelay).not.toHaveBeenCalled()
  })

  it('takes a bare address too, as every other reference path does', async () => {
    expect(await resolve(`39000:${AUTHOR}:${FOLDER}`)).toEqual({ folder: FOLDER })
  })

  it('refuses another app’s object rather than redirecting somewhere arbitrary', async () => {
    // A Ship project's naddr is a perfectly good reference that Peek has
    // nowhere to open. Saying so beats landing the person on a desk.
    expect(await resolve(`30850:${AUTHOR}:some-project`)).toBeNull()
  })
})

describe('a Message has no address, so its Folder has to be fetched', () => {
  it('reads the h tag off the event', async () => {
    // A kind:9 carries no `d` at all, so nothing but its event id names it.
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [['h', FOLDER]], content: '', created_at: 1, sig: '' }],
    })
    // The message comes back with its Folder: the topic view lands on it
    // rather than merely opening the topic around it (RIC-16).
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toEqual({ folder: FOLDER, message: MESSAGE_ID })
  })

  it('accepts a bare event id, which is what a pasted `e` tag gives you', async () => {
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [['h', FOLDER]], content: '', created_at: 1, sig: '' }],
    })
    expect(await resolve(MESSAGE_ID)).toEqual({ folder: FOLDER, message: MESSAGE_ID })
  })

  /*
    PEE-36: a DM's channel is not a Folder. Landing by `h` opened an empty page
    called "DM" that offered to delete the conversation.
  */
  it('opens a message in the viewer’s DM as that DM, with its thread', async () => {
    const PARTNER = 'd'.repeat(64)
    const ROOT = 'e'.repeat(64)
    queryRelay
      .mockResolvedValueOnce({
        ok: true,
        events: [{ id: MESSAGE_ID, kind: 9, pubkey: PARTNER, tags: [['h', FOLDER], ['e', ROOT, '', 'root']], content: '', created_at: 1, sig: '' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        events: [{ id: 'f'.repeat(64), kind: 39000, pubkey: AUTHOR, tags: [['d', FOLDER], ['t', 'dm'], ['p', AUTHOR], ['p', PARTNER]], content: '', created_at: 1, sig: '' }],
      })
    expect(await resolve(MESSAGE_ID)).toEqual({ folder: FOLDER, dm: PARTNER, message: MESSAGE_ID, thread: ROOT })
  })

  it('refuses a message in a group DM rather than calling its channel a Folder', async () => {
    queryRelay
      .mockResolvedValueOnce({
        ok: true,
        events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [['h', FOLDER]], content: '', created_at: 1, sig: '' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        events: [{ id: 'f'.repeat(64), kind: 39000, pubkey: AUTHOR, tags: [['d', FOLDER], ['t', 'dm'], ['p', AUTHOR], ['p', 'd'.repeat(64)], ['p', 'a'.repeat(64)]], content: '', created_at: 1, sig: '' }],
      })
    expect(await resolve(MESSAGE_ID)).toBeNull()
  })

  it('returns null for an event that is not readable from here', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [] })
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toBeNull()
  })

  it('returns null for an event carrying no Folder', async () => {
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [{ id: MESSAGE_ID, kind: 9, pubkey: AUTHOR, tags: [], content: '', created_at: 1, sig: '' }],
    })
    expect(await resolve(`nostr:${encodeNevent({ id: MESSAGE_ID, relays: [] })}`)).toBeNull()
  })
})

describe('a bare file opens beside the Folder it lives in', () => {
  /*
    FOL-17. A topic started since #194 is a `kind:30840` in the team's channel,
    and interop hands a consumer Peek's `/o/<naddr>` for it because Peek's
    manifest says it renders every file's conversation. The place is the
    Folder from the file's `h`, with the file named so `FoldersPage` opens it —
    a file is not a container and has no page of its own.
  */
  const FILE_D = '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
  const ADDRESS = `30840:${AUTHOR}:${FILE_D}`
  const bareFile = (tags: string[][]) => ({
    id: 'd'.repeat(64), kind: 30840, pubkey: AUTHOR, tags, content: '', created_at: 1, sig: '',
  })

  it('fetches the file by address and reads its h', async () => {
    queryRelay.mockClear()
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [bareFile([['d', FILE_D], ['title', 'FOL-15 test topic 2'], ['h', FOLDER], ['a', `30850:${AUTHOR}:folders`]])],
    })
    expect(await resolve(`nostr:${addrToNaddr(ADDRESS, [])}`)).toEqual({ folder: FOLDER, file: ADDRESS })
    // By kind, author and d — the address — not a `#k` sweep or an id.
    expect(queryRelay).toHaveBeenCalledTimes(1)
    expect(queryRelay.mock.calls[0][1]).toEqual([
      { kinds: [30840], authors: [AUTHOR], '#d': [FILE_D], limit: 1 },
    ])
  })

  it('takes the bare address, and names the file by its address rather than its naddr', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [bareFile([['d', FILE_D], ['title', 't'], ['h', FOLDER]])] })
    expect(await resolve(ADDRESS)).toEqual({ folder: FOLDER, file: ADDRESS })
  })

  it('is unopenable when the file cannot be read from here', async () => {
    // A member of a Folder the viewer is not in: the relay answers nothing,
    // and nothing is where to send them.
    queryRelay.mockResolvedValueOnce({ ok: true, events: [] })
    expect(await resolve(ADDRESS)).toBeNull()
  })

  it('is unopenable when the file names no Folder', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [bareFile([['d', FILE_D], ['title', 't']])] })
    expect(await resolve(ADDRESS)).toBeNull()
  })
})

describe('a comment on a file opens the file, with its thread (FOL-36)', () => {
  /*
    A `kind:1111`'s `h` is the team's channel — the Folder the file sits in —
    so landing by `h` put a link to a file comment on the team's general chat,
    where the comment is not. The file is the NIP-22 scope tag and the thread
    is `rootOf`, and both go back with the message.
  */
  const FILE = `30840:${AUTHOR}:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f`
  const ROOT_ID = 'a'.repeat(64)
  const commentEvent = (id: string, tags: string[][]) => ({ id, kind: 1111, pubkey: AUTHOR, tags, content: 'hi', created_at: 1, sig: '' })

  it('a root comment: the file off `A`, the thread is itself', async () => {
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [commentEvent(ROOT_ID, [['A', FILE], ['K', '30840'], ['a', FILE], ['k', '30840'], ['h', FOLDER]])],
    })
    expect(await resolve(ROOT_ID)).toEqual({ folder: FOLDER, file: FILE, message: ROOT_ID, thread: ROOT_ID })
  })

  it('a reply: the file off `A` (a reply carries no `a`), the thread off `e`', async () => {
    // What `replyToCommentAsViewer` writes: the uppercase trio unchanged, the lowercase one at the parent.
    queryRelay.mockResolvedValueOnce({
      ok: true,
      events: [commentEvent(MESSAGE_ID, [['A', FILE], ['K', '30840'], ['e', ROOT_ID], ['k', '1111'], ['h', FOLDER]])],
    })
    expect(await resolve(MESSAGE_ID)).toEqual({ folder: FOLDER, file: FILE, message: MESSAGE_ID, thread: ROOT_ID })
  })

  it('a root written before the uppercase trio, with `a` alone, still names its file', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [commentEvent(ROOT_ID, [['a', FILE], ['h', FOLDER]])] })
    expect(await resolve(ROOT_ID)).toEqual({ folder: FOLDER, file: FILE, message: ROOT_ID, thread: ROOT_ID })
  })

  it('a comment scoped to an event rather than a file is a message in its Folder, as before', async () => {
    queryRelay.mockResolvedValueOnce({ ok: true, events: [commentEvent(MESSAGE_ID, [['E', ROOT_ID], ['e', ROOT_ID], ['h', FOLDER]])] })
    expect(await resolve(MESSAGE_ID)).toEqual({ folder: FOLDER, message: MESSAGE_ID })
  })
})

describe('nonsense is nonsense', () => {
  it('returns null rather than throwing into the route', async () => {
    expect(await resolve('nostr:not-a-reference')).toBeNull()
    expect(await resolve('')).toBeNull()
  })
})
