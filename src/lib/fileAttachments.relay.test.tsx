/**
 * Drawing a file that lives on the relay — CON-12, through the package's card.
 *
 * Peek's files come with a URL a browser can load. One imported from another
 * app does not: media GET is authenticated, so `<img src>` answers 401 and the
 * bytes have to be fetched with a signed `kind:24242` first.
 *
 * The wait, the refusal and the full-screen viewer are the package's since
 * UIG-35, and are tested there. **What is Peek's, and what is checked here, is
 * which URL goes where**: the thumbnail for the card, the original for opening
 * and for saving, and neither for a file this deployment holds.
 *
 * `blobObjectUrl` is mocked because the real one signs through Estiva ID.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AttachmentCard } from '@estiva-app/ui'

const blobObjectUrl = vi.fn<(url: string) => Promise<string>>()
vi.mock('@/nostr/media', () => ({ blobObjectUrl: (url: string) => blobObjectUrl(url) }))

import { postedAttachment } from './fileAttachments'
import type { FileAttachment } from '@/data/topicData'

const SHA = 'b'.repeat(64)
const RELAY = 'https://estiva.example'

const fromRelay: FileAttachment = {
  name: 'shot.png',
  contentType: 'image/png',
  size: 4096,
  sha256: SHA,
  mediaUrl: `${RELAY}/media/${SHA}.png`,
  thumbUrl: `${RELAY}/media/${SHA}.thumb.jpg`,
}

/** The two call sites, in one line: ConversationCard and ReplyCard. */
const card = (file: FileAttachment) => <AttachmentCard {...postedAttachment(file)} fetchImage={blobObjectUrl} download />

/*
  A block body, not a concise one. `mockReset()` returns the mock, a concise
  arrow returns it out of the hook, and Vitest awaits whatever a hook returns —
  which hangs it. It surfaces as the *next* rejection failing the run, so the
  minutes go on the card rather than on the two characters that caused it.
*/
beforeEach(() => {
  blobObjectUrl.mockReset()
})

describe('a relay-hosted attachment', () => {
  it('waits, then draws the bytes it fetched', async () => {
    blobObjectUrl.mockResolvedValue('blob:fetched')
    render(card(fromRelay))

    expect(screen.getByLabelText('Loading shot.png')).toBeInTheDocument()
    const image = await screen.findByAltText('shot.png')
    expect(image).toHaveAttribute('src', 'blob:fetched')
  })

  /*
    The thumbnail, not the original. A thread of screenshots drawn at 180px
    would otherwise pull every full-size image to show them — and the relay
    generated the thumbnail for exactly this.
  */
  it('fetches the relay’s thumbnail for the card', async () => {
    blobObjectUrl.mockResolvedValue('blob:fetched')
    render(card(fromRelay))
    await waitFor(() => expect(blobObjectUrl).toHaveBeenCalledWith(fromRelay.thumbUrl))
    expect(blobObjectUrl).not.toHaveBeenCalledWith(fromRelay.mediaUrl)
  })

  it('falls back to the original where the relay made no thumbnail', async () => {
    blobObjectUrl.mockResolvedValue('blob:fetched')
    render(card({ ...fromRelay, thumbUrl: undefined }))
    await waitFor(() => expect(blobObjectUrl).toHaveBeenCalledWith(fromRelay.mediaUrl))
  })

  /*
    A refusal is drawn as a refusal. The message says a file is attached, so a
    card that rendered nothing would read as a sender who forgot it — and the
    likeliest cause here is `relay_membership_required`, a real answer about a
    channel this viewer is not in rather than a bug.
  */
  it('says so when the bytes cannot be read, rather than showing a gap', async () => {
    blobObjectUrl.mockRejectedValue(new Error('relay_membership_required'))
    render(card(fromRelay))

    expect(await screen.findByText('Could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('shot.png')).toBeInTheDocument()
    expect(screen.queryByAltText('shot.png')).not.toBeInTheDocument()
  })

  it('opening it asks for the original, not the thumbnail on screen', async () => {
    blobObjectUrl.mockResolvedValue('blob:fetched')
    render(card(fromRelay))
    await screen.findByAltText('shot.png')

    screen.getByRole('button', { name: 'Preview shot.png' }).click()
    await waitFor(() => expect(blobObjectUrl).toHaveBeenCalledWith(fromRelay.mediaUrl))
  })

  it('the download takes the original and not the thumbnail', async () => {
    // jsdom implements neither `fetch` on a blob: URL nor `window.open`, and
    // the card's save falls back to the second when the first fails. Stubbed so
    // the run is not littered with "Not implemented" for a path that is not
    // what this checks.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']))))
    blobObjectUrl.mockResolvedValue('blob:fetched')
    render(card(fromRelay))
    await screen.findByAltText('shot.png')

    screen.getByRole('button', { name: 'Download shot.png' }).click()
    await waitFor(() => expect(blobObjectUrl).toHaveBeenCalledWith(fromRelay.mediaUrl))
    vi.unstubAllGlobals()
  })
})

describe('a file still in its optimistic window', () => {
  it('draws the local preview, signing nothing', async () => {
    render(card({ previewUrl: 'blob:local', name: 'mine.png', contentType: 'image/png', size: 10 }))
    expect(await screen.findByAltText('mine.png')).toHaveAttribute('src', 'blob:local')
    expect(blobObjectUrl).not.toHaveBeenCalled()
  })
})
