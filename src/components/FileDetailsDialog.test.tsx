import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const AUTHOR = 'b'.repeat(64)

vi.mock('@/api', () => ({
  // Everyone with a profile: where the author's name is.
  useWorkspaceDirectory: () => ({ [AUTHOR]: { displayName: 'Claude (steered by Miky)' } }),
  useAvatarSrc: () => () => undefined,
}))

const { FileDetailsDialog } = await import('./FileDetailsDialog')

describe('FileDetailsDialog', () => {
  it('names the author from the workspace when the file names nobody', () => {
    // What the relay resolves for a bare file: no field names a person, so `people` is empty.
    const file = { address: `30840:${AUTHOR}:d`, slots: { title: { value: 'Estiva Suits Updates' } }, people: {} }
    render(<FileDetailsDialog file={file} onClose={() => {}} />)
    expect(screen.getByText('Claude (steered by Miky)')).toBeTruthy()
  })
})

describe('FileDetailsDialog’s summary (SPEC §6.12)', () => {
  const file = (summary?: string) => ({
    address: `30840:${AUTHOR}:d`,
    slots: { title: { value: 'Launch naming' }, ...(summary ? { subtitle: { value: summary, field: 'summary' } } : {}) },
    people: {},
  })

  it('offers "Add a summary" to someone who can edit a topic that has none, and saves it on one line', async () => {
    const onSummarize = vi.fn(async () => null)
    render(<FileDetailsDialog file={file()} onSummarize={onSummarize} onClose={() => {}} />)
    expect(screen.getByText('No summary yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a summary' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: ' Where we pick\nthe name. ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSummarize).toHaveBeenCalledWith('Where we pick the name.'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Summary' })).toBeNull())
  })

  it('edits the whole summary, not the card’s cut copy of it', () => {
    const whole = 'x'.repeat(300)
    render(<FileDetailsDialog file={file('x'.repeat(280))} summary={whole} onSummarize={async () => null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByRole('textbox', { name: 'Summary' }) as HTMLTextAreaElement).value).toBe(whole)
  })

  it('saving an empty field clears the summary', async () => {
    const onSummarize = vi.fn(async () => null)
    render(<FileDetailsDialog file={file('Where we pick the name.')} onSummarize={onSummarize} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSummarize).toHaveBeenCalledWith(''))
  })

  it('past 240 characters says how many, and still lets you save', () => {
    render(<FileDetailsDialog file={file()} onSummarize={async () => null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a summary' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'a'.repeat(250) } })
    expect(screen.getByText(/250 characters\. A summary reads best in one or two sentences, under 240\./)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a refused save keeps the field open with your text and the relay’s reason', async () => {
    const onSummarize = vi.fn(async () => ({ kind: 'error' as const, message: 'relay_membership_required' }))
    render(<FileDetailsDialog file={file()} onSummarize={onSummarize} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a summary' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Summary not saved. relay_membership_required Your text is still here.')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Summary' }) as HTMLTextAreaElement).value).toBe('Mine')
    // The same text can be sent again.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSummarize).toHaveBeenCalledTimes(2))
  })

  it('someone who can’t edit sees the summary as text, and no section when there is none', () => {
    const { unmount } = render(<FileDetailsDialog file={file('Where we pick the name.')} onClose={() => {}} />)
    expect(screen.getByText('Where we pick the name.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    unmount()
    render(<FileDetailsDialog file={file()} onClose={() => {}} />)
    expect(screen.queryByText('Summary')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a summary' })).toBeNull()
  })
})
