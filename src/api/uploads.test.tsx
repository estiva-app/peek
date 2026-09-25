/**
 * An attachment goes to the relay's blob store and nowhere else (REM-2, REM-7).
 *
 * The descriptor must carry what the `imeta` names — the store's size and type,
 * not the picked file's — and a refused upload fails the attachment, because
 * there is no other copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'p'.repeat(64) }) }))
vi.mock('@/nostr/bridge', () => ({ signViaEstivaId: vi.fn() }))

const uploadBlob = vi.fn()
vi.mock('@estiva-app/protocol', () => ({ uploadBlob: (args: unknown) => uploadBlob(args) }))

const { useCanUpload, useUploadActions } = await import('./uploads')

const file = () => new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' })

beforeEach(() => {
  // The store canonicalizes, so what it holds is not what was picked: 2 bytes
  // where the file had 3, and its own MIME. The imeta has to carry these.
  uploadBlob.mockResolvedValue({
    sha256: 'ab'.repeat(32),
    url: 'https://relay.test/ab.txt',
    size: 2,
    type: 'text/plain; charset=utf-8',
    thumb: undefined,
    dim: undefined,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('an upload', () => {
  it('goes to the blob store and carries what the imeta names', async () => {
    const { result } = renderHook(() => useUploadActions())
    const uploaded = await result.current.uploadFile(file())

    expect(uploadBlob).toHaveBeenCalledTimes(1)
    expect(uploadBlob.mock.calls[0]?.[0]).toMatchObject({ relayUrl: 'https://relay.test', filename: 'notes.txt' })
    expect(uploaded).toMatchObject({ name: 'notes.txt', sha256: 'ab'.repeat(32), mediaUrl: 'https://relay.test/ab.txt' })
  })

  it('names the size and type the store holds, not the picked file’s', async () => {
    // Ingest refuses a mismatch: "invalid: imeta size (50361) does not match
    // stored size (50340)" was the first image attached on production.
    const { result } = renderHook(() => useUploadActions())
    const uploaded = await result.current.uploadFile(file())
    expect(uploaded.size).toBe(2)
    expect(uploaded.contentType).toBe('text/plain; charset=utf-8')
  })

  it('fails the attachment when the blob store refuses — there is no other copy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    uploadBlob.mockRejectedValueOnce(new Error('blob refused'))
    const { result } = renderHook(() => useUploadActions())

    await expect(result.current.uploadFile(file())).rejects.toThrow('blob refused')
    warn.mockRestore()
  })

  it('can upload wherever the relay is configured', () => {
    const { result } = renderHook(() => useCanUpload())
    expect(result.current).toBe(true)
  })
})
