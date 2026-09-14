/**
 * A file that did not reach the relay says so — CON-12.
 *
 * The state exists because of a failure nobody could see. Peek uploads an
 * attachment twice: to Convex, which is what it draws from, and to the relay,
 * which is what every *other* app reads. The second one failing costs the
 * sender nothing visible — their message looks complete — and costs every
 * other reader the whole file.
 *
 * That is not hypothetical. On 2026-09-08 an image posted from Peek reached
 * the relay with no `imeta`; Ship drew an empty message, and neither app said
 * anything. The upload error was a `console.warn`.
 *
 * So these assertions are about being *told*, and about being told the right
 * thing: a warning rather than an error, because nothing the sender did failed.
 * The words are Peek's (`pendingAttachmentNote`); the card that draws them is
 * the package's `AttachmentCard` (UIG-27), as the composer draws it.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AttachmentCard } from '@estiva-app/ui'
import { pendingAttachmentNote } from './fileAttachments'

const base = {
  name: 'shot.png',
  size: 248_000,
  contentType: 'image/png',
  onRemove: () => {},
}

type Waiting = Parameters<typeof pendingAttachmentNote>[0]
const waiting = (file: Waiting) => render(<AttachmentCard pending {...base} {...pendingAttachmentNote(file)} />)

describe('a file waiting in the composer', () => {
  it('shows the size when the file reached both places', () => {
    waiting({ status: 'done' })
    expect(screen.getByText('242 KB')).toBeTruthy()
  })

  it('says other apps will not see a file the relay never got', () => {
    waiting({ status: 'done', shareError: 'upload failed: 403' })
    expect(screen.getByText("Other apps won't see this")).toBeTruthy()
    expect(screen.queryByText('242 KB')).toBeNull()
  })

  /* Warning, not error: the message sends and Peek draws the file. Red would
     tell the sender something is broken for them, which is false, and the
     honest reading of it is "do not send" — the wrong action. */
  it('draws it as a warning rather than a failure', () => {
    const c = waiting({ status: 'done', shareError: 'upload failed: 403' }).container
    expect(c.querySelector('.border-warning-default')).toBeTruthy()
    expect(c.querySelector('.border-error-default')).toBeNull()
  })

  /* The relay's words are what a maintainer needs and noise to everyone else,
     so they go on hover rather than in the line. */
  it('keeps the relay’s own words available on hover', async () => {
    waiting({ status: 'done', shareError: 'upload failed: 403 kind_not_allowed' })
    const line = screen.getByText("Other apps won't see this")
    /* The tooltip's words are not in the DOM until it opens — the package
       mounts the popup on open, after its wait (PEEK-ADOPTION.md §5.5). */
    expect(screen.queryByText(/403 kind_not_allowed/)).toBeNull()
    await userEvent.hover(line)
    expect(await screen.findByText(/403 kind_not_allowed/, {}, { timeout: 2000 })).toBeTruthy()
  })

  /* A real upload failure is a different thing and already had a state. A file
     that never uploaded has no relay copy either, and reporting both would say
     the smaller problem twice. */
  it('lets a real failure win over the sharing note', () => {
    const c = waiting({ status: 'error', error: "TIFF files aren't supported.", shareError: 'not signed in' }).container
    expect(screen.getByText("TIFF files aren't supported.")).toBeTruthy()
    expect(screen.queryByText("Other apps won't see this")).toBeNull()
    expect(c.querySelector('.border-error-default')).toBeTruthy()
  })

  it('says nothing about sharing while the upload is still in flight', () => {
    waiting({ status: 'uploading', shareError: 'not signed in' })
    expect(screen.getByText('Uploading…')).toBeTruthy()
    expect(screen.queryByText("Other apps won't see this")).toBeNull()
  })
})
