import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

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
