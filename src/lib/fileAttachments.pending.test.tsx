/**
 * What a file waiting in the composer says: uploading, ready or failed.
 *
 * The words are Peek's (`pendingAttachmentNote`); the card that draws them is
 * the package's `AttachmentCard` (UIG-27), as the composer draws it. The
 * fourth state, a warning for a file Convex held and the relay did not
 * (CON-12), went with Convex in REM-7.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('shows the size once it has uploaded', () => {
    waiting({ status: 'done' })
    expect(screen.getByText('242 KB')).toBeTruthy()
  })

  it('shows why in place of the size when it failed', () => {
    const c = waiting({ status: 'error', error: "TIFF files aren't supported." }).container
    expect(screen.getByText("TIFF files aren't supported.")).toBeTruthy()
    expect(c.querySelector('.border-error-default')).toBeTruthy()
  })

  it('says it is uploading while the upload is in flight', () => {
    waiting({ status: 'uploading' })
    expect(screen.getByText('Uploading…')).toBeTruthy()
  })
})
