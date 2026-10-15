/**
 * The viewer's signed media token goes to this workspace's relay and nowhere
 * else (COM-2 security review): a media URL comes from somebody else's event,
 * and nothing checks its host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sign = vi.hoisted(() => vi.fn())
const fetchBlob = vi.hoisted(() => vi.fn())
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://estiva.example' }))
vi.mock('./bridge', () => ({ signViaEstivaId: sign }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'a'.repeat(64) }) }))
vi.mock('@estiva-app/protocol', () => ({ fetchBlob }))

import { blobObjectUrl, clearBlobCache, safeBlobType } from './media'

beforeEach(() => {
  clearBlobCache()
  sign.mockReset()
  fetchBlob.mockReset()
})

describe('blobObjectUrl', () => {
  it('refuses another origin before signing anything', async () => {
    await expect(blobObjectUrl('https://evil.example/media/abc.png')).rejects.toThrow(/not this relay/)
    expect(fetchBlob).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it.each([
    ['a host that only ends with the relay’s name', 'https://evilestiva.example/media/abc.png'],
    ['a subdomain of the relay', 'https://evil.estiva.example/media/abc.png'],
    ['the relay’s host on another port', 'https://estiva.example:8443/media/abc.png'],
    ['the relay’s host over plain http', 'http://estiva.example/media/abc.png'],
    ['a host that only starts with the relay’s name', 'https://estiva.example.evil.com/media/abc.png'],
    ['the relay’s name as a user part before another host', 'https://estiva.example@evil.example/media/abc.png'],
  ])('refuses %s before signing or fetching anything', async (_case, url) => {
    await expect(blobObjectUrl(url)).rejects.toThrow(/not this relay/)
    expect(fetchBlob).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it("fetches this relay's media, and never keeps a served html type", async () => {
    fetchBlob.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: 'text/html' })
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    await blobObjectUrl('https://estiva.example/media/abc.png')
    expect(fetchBlob).toHaveBeenCalledOnce()
    expect((created.mock.calls[0][0] as Blob).type).toBe('application/octet-stream')
    created.mockRestore()
  })
})

describe('safeBlobType', () => {
  it('keeps a picture or a pdf, and makes anything else bytes', () => {
    expect(safeBlobType('image/png')).toBe('image/png')
    expect(safeBlobType('application/pdf; charset=binary')).toBe('application/pdf')
    expect(safeBlobType('image/svg+xml')).toBe('application/octet-stream')
    expect(safeBlobType('text/html')).toBe('application/octet-stream')
    expect(safeBlobType(undefined)).toBe('application/octet-stream')
  })
})
