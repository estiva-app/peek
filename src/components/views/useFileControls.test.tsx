/**
 * The row and header controls' Join, and Unarchive's toast (Katerina, 5 October).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'

const seam = vi.hoisted(() => ({
  state: 'unknown' as 'unknown' | 'known',
  calls: [] as string[],
  archived: [] as boolean[],
}))
const foreign = vi.hoisted(() => ({
  archiveFile: async ({ archived }: { archived: boolean }) => {
    seam.archived.push(archived)
    return { ok: true }
  },
}))
const toasts = vi.hoisted(() => ({ shown: [] as { label: string; actionLabel?: string; onAction?: () => void }[] }))

vi.mock('@/api', () => ({
  reloadFoldersOnScreen: async () => {},
  useReloadHeldObject: () => async () => {},
  useMembership: () => {
    // Each render's seam closes over that render's state, as the real one does.
    const state = seam.state
    return {
      state,
      // What the real seam does: refuses until it knows what the person is a member of.
      setMember: async () => {
        seam.calls.push(state)
        return state === 'known' ? true : 'Peek has not read what you are a member of yet.'
      },
    }
  },
  // Stable, as the app's seam is: a fresh function per render would hide a stale closure.
  useForeignObjects: () => foreign,
}))
const toast = vi.hoisted(() => ({ showToast: (shown: { label: string }) => void toasts.shown.push(shown) }))
vi.mock('@/lib/toast', () => ({ useToast: () => toast }))
vi.mock('@/lib/fileControls', async (original) => ({
  ...(await original<typeof import('@/lib/fileControls')>()),
  fileControlsOf: () => ({ archive: { id: 'archive' } }),
}))

import { useFileControls } from './useFileControls'

const FILE = {
  ref: 'r',
  address: `30851:${'b'.repeat(64)}:release`,
  naddr: 'naddr1x',
  folder: '11111111-1111-4111-8111-111111111111',
  slots: { title: { value: 'Release notes' } },
} as unknown as ForeignObject

beforeEach(() => {
  seam.state = 'unknown'
  seam.calls = []
  seam.archived = []
  toasts.shown = []
})

describe('useFileControls', () => {
  it('joins with the membership of now, not the first render’s', async () => {
    const { result, rerender } = renderHook(() => useFileControls())
    const open = result.current.open
    seam.state = 'known'
    rerender()
    // A row may hold the first `open`: it still sees the known state.
    await act(async () => open('join', FILE))
    expect(seam.calls).toEqual(['known'])
    expect(toasts.shown.at(-1)?.label).toBe('Joined “Release notes”: every new message shows as unread.')
  })

  it('unarchiving says so in a toast', async () => {
    const { result } = renderHook(() => useFileControls())
    await act(async () => result.current.open('unarchive', FILE))
    expect(seam.archived).toEqual([false])
    expect(toasts.shown.at(-1)?.label).toBe('Unarchived “Release notes”')
  })
})
