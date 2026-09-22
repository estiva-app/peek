/**
 * A refresh must not redraw the tree — FOL-40.
 *
 * The sibling file mocks every hook and proves *when* a read is asked for.
 * This one mocks only the seam, so the real `useFolderContents`,
 * `useForeignChildren`, `useConversationBadges` and `useTeamUnread` run, and
 * what it watches is the DOM: Miky saw the team's dot arrive late and part of
 * the sidebar reload with it, and the second half of that is only visible from
 * the rendered tree.
 *
 * The property: a re-read of what is already on screen — the 30 s tick, a
 * focus, a tab becoming visible, and now the socket — keeps the rows it has.
 * A skeleton means the view said "I have nothing", which is false the moment
 * anything has answered once.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TEAM = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const OTHER = '3789d2ca-103c-40e5-906f-0490782db5fd'
const PROJECT_ADDRESS = `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const FILE_ADDRESS = `30840:${SHIP}:7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f`

const foreign = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    naddr: 'naddr1x',
    eventId: 'e'.repeat(64),
    widget: 'card',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: false,
    folder: TEAM,
    ...over,
  }) as unknown as ForeignObject

const project = foreign({
  ref: PROJECT_ADDRESS,
  address: PROJECT_ADDRESS,
  naddr: 'naddr1project',
  kind: 30850,
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
  listsChildren: true,
})
const file = foreign({
  ref: FILE_ADDRESS,
  address: FILE_ADDRESS,
  kind: 30840,
  appName: 'File',
  slots: { title: { value: 'FOL-15 test topic 2' } },
})

const folders: FolderSummary[] = [
  { id: TEAM, name: 'Peek', hasState: true },
  { id: OTHER, name: 'Zebra', hasState: true },
]

/*
  The seam, and nothing above it. Every read is a fresh object each time, as
  the relay's would be: the rows must survive a re-read that answers the same
  thing in new objects, which is the ordinary case and the one that redraws.
*/
const seam = vi.hoisted(() => ({
  reads: 0,
  resolves: 0,
  resolveFolderContents: vi.fn(),
  resolveObject: vi.fn(),
}))
/*
  Mocked where they are defined, not at the barrel: a hook inside `@/api`
  imports the barrel itself, and a `vi.mock('@/api')` built on `importActual`
  hands those the real seam (`peek-api-mock-does-not-reach-seam-internals`).
*/
vi.mock('@/api/foreign', () => {
  /*
    One object, built once. The real seam's calls are `useCallback`s, and the
    hooks under test depend on their identity: a fresh function per render
    would re-run every load effect for ever, which is a loop in the test and
    not a fact about the tree ([[mock-use-relay-viewer-stably]]).
  */
  const objects = {
    listFolders: async () => folders,
    resolveFolderContents: seam.resolveFolderContents,
    conversations: async () => ({}),
    channelStreams: async () => ({ [TEAM]: [], [OTHER]: [] }),
    resolveObject: seam.resolveObject,
    resolveFileFolder: async () => null,
  }
  return { useForeignObjects: () => objects }
})
vi.mock('@/api/topics', () => ({ useTopics: () => [] }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64) }) }))
/**
 * Present, and holding both signals: the wide filter the dot now rides
 * (FOL-40), and the projection's `onForeignActivity`, which the Folder's own
 * listing still watches for what the projection did not take.
 */
const live = vi.hoisted(() => ({
  fire: undefined as ((id: string) => void) | undefined,
  fireForeign: new Map<string, () => void>(),
}))
vi.mock('@/nostr/liveTopics', () => ({
  peekLiveTopics: () => ({
    onForeignActivity: (folder: string, listener: () => void) => {
      live.fireForeign.set(folder, listener)
      return () => live.fireForeign.delete(folder)
    },
  }),
  // `@/api` installs the console diagnostics at module load, so a mock of this
  // module owes them even though nothing here calls one.
  installWideFilterDiagnostic: () => {},
}))
vi.mock('@/nostr/useLiveTopics', () => {
  const client = {
    watchChannels: (_ids: readonly string[], listener: (id: string) => void) => {
      live.fire = listener
      return { stop: () => {} }
    },
  }
  return { useLiveTopics: () => ({ live: client, relayState: 'live' }) }
})

import { FolderTree } from './FolderTree'

const skeletons = () =>
  document.querySelectorAll('[data-loading="file-tree"], .animate-pulse, .animate-skeleton-in')

/** A Ship issue under the project, fetched when the project row is expanded. */
const issue = foreign({
  ref: `30851:${SHIP}:49f44b85`,
  address: `30851:${SHIP}:49f44b85`,
  kind: 30851,
  appName: 'Estiva Ship',
  slots: { title: { value: 'The team dot does not follow the socket' } },
})

beforeEach(() => {
  seam.reads = 0
  seam.resolves = 0
  seam.resolveObject.mockImplementation(async () => {
    seam.resolves++
    return { ...project, children: [{ ...issue }] }
  })
  seam.resolveFolderContents.mockImplementation(async (folder: string) => {
    seam.reads++
    // Fresh objects every time, like a real read.
    return {
      id: folder,
      name: 'Peek',
      hasState: true,
      source: 'state',
      files: folder === TEAM ? [{ ...project }, { ...file }] : [],
    }
  })
  window.localStorage.clear()
})
afterEach(() => {
  seam.resolveFolderContents.mockReset()
  seam.resolveObject.mockReset()
  window.localStorage.clear()
  live.fire = undefined
})

describe('a refresh keeps the rows it already has (FOL-40)', () => {
  it('re-reads the open Folder on a focus without a skeleton, and without remounting a row', async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(seam.reads).toBe(1))
    const row = document.querySelector(`[data-file="${FILE_ADDRESS}"]`)
    expect(row).not.toBeNull()

    /*
      Every skeleton the tree can draw, while the re-read is in flight and
      after it lands. Watched rather than sampled: a skeleton that appears for
      one commit and goes is exactly the flicker being ruled out.
    */
    let flickered = 0
    const observer = new MutationObserver(() => {
      if (skeletons().length > 0) flickered++
      if (!document.contains(row!)) flickered++
    })
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      window.dispatchEvent(new Event('focus'))
      await waitFor(() => expect(seam.reads).toBe(2))
      // The same node, never replaced — React kept it, so nothing redrew.
      expect(document.contains(row!)).toBe(true)
      expect(screen.getByText('FOL-15 test topic 2')).toBeDefined()
      expect(skeletons()).toHaveLength(0)
      expect(flickered).toBe(0)
    } finally {
      observer.disconnect()
    }
  })

  it("an expanded row's children survive the same refresh — the other skeleton the tree can draw", async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    const expand = await screen.findByRole('button', {
      name: 'Show what is in Folders: navigation for the whole suite',
    })
    fireEvent.click(expand)
    const child = await screen.findByText('The team dot does not follow the socket')
    await waitFor(() => expect(seam.resolves).toBe(1))

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(seam.resolves).toBe(2))
    // The child row is the same node: the re-resolve replaced the answer, not
    // the rows, and `SkeletonRow` was never drawn over them.
    expect(document.contains(child)).toBe(true)
    expect(skeletons()).toHaveLength(0)
  })

  it('a re-read that fails keeps the rows, rather than saying the Folder cannot be read', async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(seam.reads).toBe(1))

    seam.resolveFolderContents.mockImplementation(async () => {
      seam.reads++
      throw new Error('relay timed out')
    })
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(seam.reads).toBe(2))
    // The rows it had, not the sentence for a Folder nobody could read.
    expect(screen.getByText('FOL-15 test topic 2')).toBeDefined()
    expect(screen.queryByText('This folder could not be read.')).toBeNull()
    expect(skeletons()).toHaveLength(0)
  })

  it('the socket re-read is the same: the dot may change, the rows do not', async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(seam.reads).toBe(1))
    const row = document.querySelector(`[data-file="${FILE_ADDRESS}"]`)

    // The team dot's own re-read fires no Folder-contents read at all: the two
    // are separate reads on separate hooks, which is why one can be live.
    live.fire?.(TEAM)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.contains(row!)).toBe(true)
    expect(skeletons()).toHaveLength(0)
    expect(seam.reads).toBe(1)
  })
})
