/**
 * A screenshot on the clipboard becomes an attachment — PEE-20.
 *
 * The naming and the text-wins rule are decided in `lib/fileAttachments` and
 * tested there. What is proved here is the wiring: that the composer sees a
 * paste at all, that the picture becomes a chip instead of going into the
 * text, and that a second paste adds to the first rather than replacing it.
 *
 * The upload is mocked. Without a relay the real one makes a paste inert on
 * purpose, so a test against it would prove nothing — and the upload itself is
 * the seam's, not the composer's.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  useCanUpload: () => true,
  useUploadActions: () => ({
    uploadFile: async (file: File) => ({
      name: file.name,
      contentType: file.type,
      size: file.size,
      previewUrl: 'blob:preview',
      sha256: 'cd'.repeat(32),
      mediaUrl: `https://relay.test/${file.name}`,
    }),
  }),
}))

import { PeekDataProvider } from '@/api'
import { ComposeBox } from './ComposeBox'

/* Same reason as ComposeBox.drafts.test.tsx: jsdom implements neither
   `getClientRects` nor `getBoundingClientRect` on text nodes, and ProseMirror
   calls them whenever the document changes. */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

const screenshot = () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })

/**
 * jsdom has no `DataTransfer`, so the clipboard is handed to the event
 * directly. ProseMirror reads `clipboardData` off the event and nothing else.
 */
function paste(editor: Element, text: string, files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files, types: files.length ? ['Files'] : ['text/plain'], getData: (f: string) => (f === 'text/plain' ? text : '') },
  })
  editor.dispatchEvent(event)
  return event
}

async function showComposer() {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ComposeBox />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
  return container.querySelector('.ProseMirror') as Element
}

const NAMED = /^Screenshot \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/

describe('pasting an image into the composer', () => {
  it('attaches the screenshot, named, and keeps it out of the text', async () => {
    const editor = await showComposer()
    const event = paste(editor, '', [screenshot()])

    expect(await screen.findByText(NAMED)).toBeTruthy()
    // Handled, so the browser never inserts anything of its own.
    expect(event.defaultPrevented).toBe(true)
    expect(editor.textContent).toBe('')
    // The size replaces 'Uploading…' once the upload settles.
    expect(await screen.findByText('3 bytes')).toBeTruthy()
  })

  /* Her ask: one at a time, each one kept. */
  it('adds a second pasted image to the first', async () => {
    const editor = await showComposer()
    paste(editor, '', [screenshot()])
    await screen.findByText(NAMED)
    paste(editor, '', [screenshot()])
    await waitFor(() => expect(screen.getAllByText(NAMED)).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: /^Remove Screenshot/ })).toHaveLength(2)
  })

  /* A copy from Excel or Word carries a picture of the selection beside the
     text. The text is what was meant. */
  it('attaches nothing when the clipboard carries text', async () => {
    const editor = await showComposer()
    paste(editor, 'Q3 revenue\t120', [screenshot()])
    await waitFor(() => expect(editor.textContent).toContain('Q3 revenue'))
    expect(screen.queryByText(NAMED)).toBeNull()
  })
})
