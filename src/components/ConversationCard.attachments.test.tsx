/**
 * Attaching a file while editing a sent message — PEE-16.
 *
 * The ticket names two ways in and both did nothing: the paperclip had no
 * handler, and the edit editor had no paste handler. Those two, and the three
 * rules around them, are what is proved here.
 *
 * The upload is mocked, exactly as in ComposeBox.paste.test: without a relay
 * it is inert on purpose, so a test against the real one would prove nothing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { PeekDataProvider, type FileAttachment } from '@/api'
import { ConversationCard } from './ConversationCard'

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on
   text nodes, and ProseMirror calls them on every document change. */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

const screenshot = () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })
const NAMED = /^Screenshot \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/

const EXISTING: FileAttachment = {
  name: 'brief.pdf',
  contentType: 'application/pdf',
  size: 2048,
  sha256: 'ab'.repeat(32),
  mediaUrl: 'https://relay.test/brief.pdf',
}

/** jsdom has no `DataTransfer`; ProseMirror reads `clipboardData` and nothing else. */
function paste(editor: Element, text: string, files: File[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files, types: files.length ? ['Files'] : ['text/plain'], getData: (f: string) => (f === 'text/plain' ? text : '') },
  })
  editor.dispatchEvent(event)
  return event
}

/** Render one of the viewer's own messages and open its editor via the menu. */
async function openEditor(props: Partial<React.ComponentProps<typeof ConversationCard>> = {}) {
  const onFilesChange = vi.fn()
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationCard
            authorName="You"
            timestamp="10:24"
            body="The brief, as promised."
            onFilesChange={onFilesChange}
            {...props}
          />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  const card = container.firstElementChild as Element
  fireEvent.mouseEnter(card)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await screen.findByText('Edit message'))
  await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull())
  return { editor: container.querySelector('.ProseMirror') as Element, container, onFilesChange }
}

describe('attaching a file while editing a sent message', () => {
  it('attaches a pasted screenshot and keeps it out of the text', async () => {
    const { editor } = await openEditor()
    const before = editor.textContent
    const event = paste(editor, '', [screenshot()])

    expect(await screen.findByText(NAMED)).toBeTruthy()
    expect(event.defaultPrevented).toBe(true)
    expect(editor.textContent).toBe(before)
  })

  it('attaches a file picked with the paperclip', async () => {
    const { container } = await openEditor()
    expect(screen.getByRole('button', { name: 'Attach file' })).toBeTruthy()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' }))

    expect(await screen.findByText('notes.txt')).toBeTruthy()
  })

  /* A copy from Excel or Word carries a picture of the selection beside the
     text. The text is what was meant — same rule as the composer. */
  it('attaches nothing when the clipboard carries text', async () => {
    const { editor } = await openEditor()
    paste(editor, 'Q3 revenue\t120', [screenshot()])
    await waitFor(() => expect(editor.textContent).toContain('Q3 revenue'))
    expect(screen.queryByText(NAMED)).toBeNull()
  })

  it('shows the files the message already has, and can remove one', async () => {
    const { onFilesChange } = await openEditor({ files: [EXISTING] })
    expect(await screen.findByText('brief.pdf')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Remove brief.pdf' }))
    await waitFor(() => expect(screen.queryByText('brief.pdf')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onFilesChange).toHaveBeenCalledWith([])
  })

  it('saves the message its files, old and new together', async () => {
    const { editor, onFilesChange } = await openEditor({ files: [EXISTING] })
    paste(editor, '', [screenshot()])
    await screen.findByText(NAMED)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onFilesChange).toHaveBeenCalledTimes(1)
    const saved = onFilesChange.mock.calls[0][0] as FileAttachment[]
    expect(saved).toHaveLength(2)
    expect(saved[0].name).toBe('brief.pdf')
    expect(saved[1].name).toMatch(NAMED)
    // The relay's copy rides along: the conversation view refuses a file
    // without it, which was every file added in an edit until REM-7.
    expect(saved[1]).toMatchObject({ sha256: 'cd'.repeat(32), mediaUrl: expect.stringMatching(/^https:\/\/relay\.test\//) })
  })

  it('says nothing about files when the edit did not touch them', async () => {
    const { onFilesChange } = await openEditor({ files: [EXISTING] })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onFilesChange).not.toHaveBeenCalled()
  })

  /* Her ruling: cancel reverts the changes, the attached file included. */
  it('cancel puts back what was removed and drops what was added', async () => {
    const { editor, onFilesChange } = await openEditor({ files: [EXISTING] })

    await userEvent.click(screen.getByRole('button', { name: 'Remove brief.pdf' }))
    paste(editor, '', [screenshot()])
    await screen.findByText(NAMED)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText(NAMED)).toBeNull())
    expect(screen.getByText('brief.pdf')).toBeTruthy()
    expect(onFilesChange).not.toHaveBeenCalled()
  })
})
