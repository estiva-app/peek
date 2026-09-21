/**
 * The followed set as one hook (FOL-30): two reads make one set, a toggle moves
 * it at once and writes it, and an unfollow of an implied key is written down
 * as a mute so the next load does not bring it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FollowsBlob } from './follows'

const relay = vi.hoisted(() => ({
  fetchFollows: vi.fn(),
  publishFollows: vi.fn(),
  fetchImpliedFollows: vi.fn(),
}))
vi.mock('./follows', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./follows')),
  fetchFollows: relay.fetchFollows,
  publishFollows: relay.publishFollows,
}))
vi.mock('./impliedFollows', () => ({ fetchImpliedFollows: relay.fetchImpliedFollows }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'c'.repeat(64) }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { useFollowsSync } from './useFollowsSync'

const PK = 'b'.repeat(64)
const ISSUE = `30851:${PK}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const TOPIC = `30840:${PK}:0a2e4f9b-2f1c-4a52-9c0f-5f0e9b0e1a11`
const FOLDER = '11111111-1111-4111-8111-111111111111'
const RELAY = 'https://relay.test'

const blob = (keys: string[], muted: string[] = []): FollowsBlob => ({ v: 1, updatedAt: 1_000, keys, muted })

/** A read the test releases by hand, to hold `state` at `unknown`. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  relay.fetchFollows.mockResolvedValue({ state: 'present', blob: blob([ISSUE], []) })
  relay.fetchImpliedFollows.mockResolvedValue(new Set([TOPIC, FOLDER]))
  relay.publishFollows.mockResolvedValue({ ok: true, eventId: 'x' })
})
afterEach(() => {
  relay.fetchFollows.mockReset()
  relay.publishFollows.mockReset()
  relay.fetchImpliedFollows.mockReset()
})

describe('useFollowsSync', () => {
  it('is unknown until both reads have landed, then the union of explicit and implied', async () => {
    const implied = deferred<Set<string>>()
    relay.fetchImpliedFollows.mockReturnValue(implied.promise)
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(relay.fetchFollows).toHaveBeenCalledTimes(1))
    // The blob alone does not settle it: explicit follows lit and mentions dark is a wrong answer.
    expect(result.current.state).toBe('unknown')
    expect(result.current.followed.size).toBe(0)
    await act(async () => implied.resolve(new Set([TOPIC, FOLDER])))
    await waitFor(() => expect(result.current.state).toBe('present'))
    expect([...result.current.followed].sort()).toEqual([ISSUE, TOPIC, FOLDER].sort())
  })

  it('an absent blob still follows what the relay implies', async () => {
    relay.fetchFollows.mockResolvedValue({ state: 'absent' })
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('absent'))
    expect([...result.current.followed].sort()).toEqual([TOPIC, FOLDER].sort())
  })

  it('a muted key is implied but not followed, and following it again clears the mute', async () => {
    relay.fetchFollows.mockResolvedValue({ state: 'present', blob: blob([ISSUE], [TOPIC]) })
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('present'))
    expect([...result.current.followed].sort()).toEqual([ISSUE, FOLDER].sort())
    await act(() => result.current.setFollowed(TOPIC, true))
    expect(result.current.followed.has(TOPIC)).toBe(true)
    const written = relay.publishFollows.mock.calls[0][0] as FollowsBlob
    expect(written.keys.sort()).toEqual([ISSUE, TOPIC].sort())
    expect(written.muted).toEqual([])
  })

  it('unfollowing an implied key mutes it, so the next load does not bring it back', async () => {
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('present'))
    await act(() => result.current.setFollowed(FOLDER, false))
    expect(result.current.followed.has(FOLDER)).toBe(false)
    const written = relay.publishFollows.mock.calls[0][0] as FollowsBlob
    expect(written.keys).toEqual([ISSUE])
    expect(written.muted).toEqual([FOLDER])
    // Unfollowing an explicit key that nothing implies removes it and mutes nothing.
    await act(() => result.current.setFollowed(ISSUE, false))
    const again = relay.publishFollows.mock.calls[1][0] as FollowsBlob
    expect(again.keys).toEqual([])
    expect(again.muted).toEqual([FOLDER])
  })

  it('a refused publish puts the toggle back', async () => {
    relay.publishFollows.mockResolvedValue({ ok: false, reason: 'no' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('present'))
    await act(() => result.current.setFollowed(FOLDER, false))
    expect(result.current.followed.has(FOLDER)).toBe(true)
    warn.mockRestore()
  })

  it('does not write while the set is unknown', async () => {
    relay.fetchImpliedFollows.mockReturnValue(new Promise(() => {}))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useFollowsSync(RELAY))
    await waitFor(() => expect(relay.fetchFollows).toHaveBeenCalledTimes(1))
    await act(() => result.current.setFollowed(ISSUE, false))
    expect(relay.publishFollows).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
