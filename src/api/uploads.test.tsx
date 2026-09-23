/**
 * A file comment's attachment goes to the blob store and nowhere else (REM-2).
 *
 * The regression is `generateUploadUrl` being called at all on that path: it
 * is a Convex mutation, so a file comment's attachment needed Convex, and
 * Convex storage grew by a copy that no reader of a relay-only comment ever
 * looked at. DMs keep the Convex step until REM-1, and the last test pins that
 * too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const generateUploadUrl = vi.fn(async () => 'https://convex.test/upload')
const deleteUpload = vi.fn(async () => undefined)
vi.mock('convex/react', () => ({
  useMutation: (ref: unknown) => (String(ref).includes('delete') ? deleteUpload : generateUploadUrl),
}))
vi.mock('../../convex/_generated/api', () => ({
  api: { messages: { generateUploadUrl: 'messages.generateUploadUrl', deleteUpload: 'messages.deleteUpload' } },
}))
vi.mock('./store', () => ({ hasConvex: true }))
vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'p'.repeat(64) }) }))
vi.mock('@/nostr/bridge', () => ({ signViaEstivaId: vi.fn() }))

const uploadBlob = vi.fn()
vi.mock('@estiva-app/protocol', () => ({ uploadBlob: (args: unknown) => uploadBlob(args) }))

const { UploadDestinationProvider, useCanUpload, useUploadActions } = await import('./uploads')

const inFileConversation = ({ children }: { children: ReactNode }) => (
  <UploadDestinationProvider value="blobStore">{children}</UploadDestinationProvider>
)

const file = () => new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' })

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  uploadBlob.mockResolvedValue({ sha256: 'ab'.repeat(32), url: 'https://relay.test/ab.txt', thumb: undefined, dim: undefined })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ storageId: 'stored' }), { status: 200 }),
  )
})

afterEach(() => {
  vi.clearAllMocks()
  fetchSpy.mockRestore()
})

describe('a file conversation’s upload', () => {
  it('goes to the blob store alone and carries what the imeta names', async () => {
    const { result } = renderHook(() => useUploadActions(), { wrapper: inFileConversation })
    const uploaded = await result.current.uploadFile(file())

    expect(generateUploadUrl).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(uploadBlob).toHaveBeenCalledTimes(1)
    expect(uploadBlob.mock.calls[0]?.[0]).toMatchObject({ relayUrl: 'https://relay.test', filename: 'notes.txt' })
    expect(uploaded).toMatchObject({ name: 'notes.txt', sha256: 'ab'.repeat(32), mediaUrl: 'https://relay.test/ab.txt' })
    expect(uploaded.storageId).toBeUndefined()
    expect(uploaded.shareError).toBeUndefined()
  })

  it('fails the attachment when the blob store refuses — there is no other copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    uploadBlob.mockRejectedValueOnce(new Error('blob refused'))
    const { result } = renderHook(() => useUploadActions(), { wrapper: inFileConversation })

    await expect(result.current.uploadFile(file())).rejects.toThrow('blob refused')
    expect(generateUploadUrl).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('removing one before send asks Convex to delete nothing', () => {
    const { result } = renderHook(() => useUploadActions(), { wrapper: inFileConversation })
    result.current.deleteUpload(undefined)
    expect(deleteUpload).not.toHaveBeenCalled()
  })

  it('can upload wherever the relay is configured', () => {
    const { result } = renderHook(() => useCanUpload(), { wrapper: inFileConversation })
    expect(result.current).toBe(true)
  })
})

describe('a DM’s upload, until REM-1', () => {
  it('still goes to Convex first and mirrors to the blob store', async () => {
    const { result } = renderHook(() => useUploadActions())
    const uploaded = await result.current.uploadFile(file())

    expect(generateUploadUrl).toHaveBeenCalledTimes(1)
    expect(uploadBlob).toHaveBeenCalledTimes(1)
    expect(uploaded).toMatchObject({ storageId: 'stored', sha256: 'ab'.repeat(32) })
  })
})
