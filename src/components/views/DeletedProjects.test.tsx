/**
 * Archive → Deleted's rows (ALL-5): a deleted topic or page, whose Delete its listing declares as a confirm (a
 * `kind:5`), is offered Restore like a project, handed the change its restore follows.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ForeignObject } from '@estiva-app/interop'

vi.mock('@/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api')>()), useWorkspaceDirectory: () => ({}) }))

import { DeletedProjects } from './DeletedProjects'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TOPIC = `30840:${AUTHOR}:6f1c2b3a-0000-4000-8000-00000000bbbb`
const DELETING = 'd'.repeat(64)

const deletedTopic = {
  ref: TOPIC,
  address: TOPIC,
  naddr: TOPIC,
  kind: 30840,
  slots: { title: { value: 'Launch' } },
  deleted: { by: AUTHOR, at: 1_700_000_000 },
  // The bare file's Delete: a confirm, with no field of its own.
  actions: [{ id: 'delete', label: 'Delete', control: 'confirm' }],
  prevs: { deleted: DELETING },
} as unknown as ForeignObject

describe('Archive → Deleted', () => {
  it('offers Restore on a deleted topic and hands over its Delete and the deleting change', async () => {
    const onRestore = vi.fn(async () => {})
    render(<DeletedProjects state={[deletedTopic]} onRetry={async () => {}} teamOf={() => 'Launch team'} onRestore={onRestore} />)
    await userEvent.click(screen.getByRole('button', { name: /Restore/ }))

    expect(onRestore).toHaveBeenCalledWith(deletedTopic, 'delete', DELETING)
  })
})
