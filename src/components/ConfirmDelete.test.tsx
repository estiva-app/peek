/**
 * FOL-46 in Peek: Archive offered where a topic's deletion is asked. The
 * archive question itself is the kit's `ArchiveDialog` (C11), tested there.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDelete } from './ConfirmDelete'

describe('ConfirmDelete', () => {
  it('offers Archive instead for a topic that can be archived', async () => {
    const onArchiveInstead = vi.fn()
    render(<ConfirmDelete onArchiveInstead={onArchiveInstead} onConfirm={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Archive instead' }))
    expect(onArchiveInstead).toHaveBeenCalled()
  })

  it('says where a file comes back from when its delete only marks it, and not that the relay decides (ALL-5)', () => {
    render(<ConfirmDelete restorable onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/bring it back from Archive → Deleted/)).toBeTruthy()
    expect(screen.queryByText(/The relay decides/)).toBeNull()
  })

  it('keeps today’s words for a file whose delete cannot be undone', () => {
    render(<ConfirmDelete onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/The relay decides/)).toBeTruthy()
    expect(screen.queryByText(/Archive → Deleted/)).toBeNull()
  })

  it('offers nothing more where there is no archive', () => {
    render(<ConfirmDelete onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Archive instead' })).toBeNull()
  })
})
