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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/** A project's conversation channel, placed under the team (FOL-42). */
const CONVERSATION = '2611db6d-0d4c-4a41-9b0e-6a2f1c3d4e5f'

const folders: FolderSummary[] = [
  { id: TEAM, name: 'Peek', hasState: true },
  { id: OTHER, name: 'Zebra', hasState: true },
  { id: CONVERSATION, hasState: false, listedIn: [TEAM] },
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
  /** Every badge read, by the addresses it asked about. */
  conversations: vi.fn<(files: ForeignObject[]) => Promise<Record<string, never>>>(async () => ({})),
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
    conversations: seam.conversations,
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
vi.mock('@/nostr/useLiveClient', () => {
  const client = {
    watchChannels: (_ids: readonly string[], listener: (id: string) => void) => {
      live.fire = listener
      return { stop: () => {} }
    },
  }
  return { useLiveClient: () => ({ live: client, relayState: 'live' }) }
})
/**
 * The dots' messages, from the tab's channel store (PER-8) — scripted, so a
 * test can change what the dot sees without any read of the Folder's rows.
 */
const dots = vi.hoisted(() => ({
  version: 0,
  at: 0,
  streams: {} as Record<string, unknown[]>,
  listeners: new Set<() => void>(),
  /** The store's deliveries — what the socket's signal is now (FOL-44 rides it). */
  deliveries: new Set<(channel: string) => void>(),
}))
/** The socket delivering an event in `channel` to the store. */
const deliver = (channel: string) => {
  for (const heard of dots.deliveries) heard(channel)
}
vi.mock('@/api/useChannelStreams', async () => {
  const { useSyncExternalStore, useMemo } = await import('react')
  return {
    useChannelStreams: () => {
      const version = useSyncExternalStore(
        (listener) => {
          dots.listeners.add(listener)
          return () => dots.listeners.delete(listener)
        },
        () => dots.version,
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return useMemo(() => ({ at: dots.at, streams: { [TEAM]: [], [OTHER]: [], ...dots.streams } }), [version])
    },
    onChannelStoreRead: () => () => {},
    onChannelStoreDelivery: (listener: (channel: string) => void) => {
      dots.deliveries.add(listener)
      return () => dots.deliveries.delete(listener)
    },
  }
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
  seam.conversations.mockClear()
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

  it('a message the socket delivers changes the dot, and neither reads nor redraws the rows', async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(seam.reads).toBe(1))
    const row = document.querySelector(`[data-file="${FILE_ADDRESS}"]`)

    // The dot's messages come from the channel store, which applies what the
    // socket delivers (PER-8): no Folder-contents read at all, and no remount.
    act(() => {
      dots.streams = { [TEAM]: [{ id: 'n', at: dots.at, by: 'd'.repeat(64), root: 'n', about: [], urgent: false }] }
      dots.version++
      for (const listener of dots.listeners) listener()
    })
    expect(document.contains(row!)).toBe(true)
    expect(skeletons()).toHaveLength(0)
    expect(seam.reads).toBe(1)
  })
})

describe("an open section's rows follow the socket (FOL-44)", () => {
  /** The badge reads that asked about the team's first level. */
  const rowReads = () =>
    seam.conversations.mock.calls.filter(([asked]) =>
      asked.some((object) => object.address === FILE_ADDRESS),
    ).length

  it("a comment in a project's channel under the team re-reads the open rows' dots, without a remount", async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(rowReads()).toBe(1))
    const row = document.querySelector(`[data-file="${FILE_ADDRESS}"]`)

    // The channel the comment lands in is not the team's: it is placed in it.
    deliver(CONVERSATION)
    await waitFor(() => expect(rowReads()).toBe(2), { timeout: 3_000 })
    expect(document.contains(row!)).toBe(true)
    expect(skeletons()).toHaveLength(0)
  })

  it("an expanded row's children re-read on the same signal", async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Show what is in Folders: navigation for the whole suite' }),
    )
    await screen.findByText('The team dot does not follow the socket')
    const childReads = () =>
      seam.conversations.mock.calls.filter(([asked]) =>
        asked.some((object) => object.address === issue.address),
      ).length
    await waitFor(() => expect(childReads()).toBe(1))

    deliver(TEAM)
    await waitFor(() => expect(childReads()).toBe(2), { timeout: 3_000 })
  })

  it("a signal from another team re-reads nothing in this one's rows", async () => {
    render(
      <MemoryRouter initialEntries={['/folders']}>
        <FolderTree currentFolder={TEAM} />
      </MemoryRouter>,
    )
    await screen.findByText('FOL-15 test topic 2')
    await waitFor(() => expect(rowReads()).toBe(1))

    deliver(OTHER)
    // Past the settle window, so a read it caused would have gone out.
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(rowReads()).toBe(1)
  })
})

describe('the tab holds what it read (SID-2)', () => {
  const tree = (currentFolder?: string) => (
    <MemoryRouter initialEntries={['/folders']}>
      <FolderTree currentFolder={currentFolder} />
    </MemoryRouter>
  )
  const readsOf = (folder: string) => seam.resolveFolderContents.mock.calls.filter(([f]) => f === folder).length
  const section = (id: string) => document.querySelector(`[data-tree-folder="${id}"]`) as HTMLElement

  it('a Folder closed and opened again draws its rows at once, and asks nothing while its answer is fresh', async () => {
    render(tree(TEAM))
    await screen.findByText('FOL-15 test topic 2')
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }))
    expect(screen.queryByText('FOL-15 test topic 2')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }))
    // Synchronously: no commit with a skeleton in between.
    expect(screen.getByText('FOL-15 test topic 2')).toBeInTheDocument()
    expect(skeletons()).toHaveLength(0)
    expect(readsOf(TEAM)).toBe(1)
  })

  it('the next page’s sidebar draws the Folders and the open rows on its first commit', async () => {
    const first = render(tree(TEAM))
    await screen.findByText('FOL-15 test topic 2')
    first.unmount()
    render(tree(TEAM))
    expect(screen.getByText('FOL-15 test topic 2')).toBeInTheDocument()
    expect(skeletons()).toHaveLength(0)
    expect(readsOf(TEAM)).toBe(1)
  })

  it('a pointer resting on a closed Folder reads it once, and the first open draws no skeleton', async () => {
    render(tree())
    await screen.findByRole('button', { name: 'Peek' })
    fireEvent.pointerOver(section(TEAM))
    await waitFor(() => expect(readsOf(TEAM)).toBe(1))
    fireEvent.pointerOut(section(TEAM))
    fireEvent.pointerOver(section(TEAM))
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Held already: a second rest asks nothing.
    expect(readsOf(TEAM)).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Peek' }))
    expect(screen.getByText('FOL-15 test topic 2')).toBeInTheDocument()
    expect(skeletons()).toHaveLength(0)
  })

  it('a pointer passing over a closed Folder reads nothing', async () => {
    render(tree())
    await screen.findByRole('button', { name: 'Zebra' })
    fireEvent.pointerOver(section(OTHER))
    fireEvent.pointerOut(section(OTHER))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(readsOf(OTHER)).toBe(0)
  })
})
