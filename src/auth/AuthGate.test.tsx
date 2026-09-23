/**
 * The gate is Estiva ID's, and the Convex bootstrap runs beside the app (REM-2).
 *
 * The first test is the regression: Convex never confirming the token used to
 * hold the whole app on the auth shell, which made a Convex outage a Peek
 * outage for screens that read nothing from Convex.
 *
 * The profile-sync tests are SHA-22's, carried over. That bug was a latch that
 * closed before `relayUrl` arrived from a Convex query; the URL is build-time
 * now, but the sync still has to wait for the adoption, and still has to run
 * once rather than once per render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const adopt = vi.fn(async () => undefined)
const convexClient = { query: vi.fn(async () => []), action: vi.fn(async () => ({ ok: true })) }

/** What `useConvexAuth` answers; swapped mid-test to confirm the token late. */
let convexAuth = { isLoading: true, isAuthenticated: false }
/** What the Estiva ID session answers. */
let session = { isLoading: false, isAuthenticated: true, fetchAccessToken: async () => 'token' }

vi.mock('convex/react', () => ({
  useConvex: () => convexClient,
  useMutation: () => adopt,
  useConvexAuth: () => convexAuth,
}))

vi.mock('@/api', () => ({ hasConvex: true, hasRelay: true, RELAY_URL: 'wss://relay.test' }))
vi.mock('./useEstivaIdSession', () => ({ useEstivaIdSession: () => session }))
vi.mock('./estivaId', () => ({
  validToken: () => ({ accessToken: 'token', pubkey: 'a'.repeat(64) }),
  CALLBACK_PATH: '/callback',
}))
vi.mock('./shell/AuthShell', () => ({ AuthShell: () => <div>auth shell</div> }))
const markEntered = vi.fn()
vi.mock('./shell/useAuthShell', () => ({
  markEntered: () => markEntered(),
  useAuthShell: () => ({ state: {}, onContinue: () => {} }),
}))

/** Typed on its first argument, which is the relay origin it was handed. */
const syncStaleProfilesFromRelay = vi.fn(async (_relayUrl: string, ..._rest: unknown[]) => undefined)
vi.mock('@/nostr/sync', () => ({
  syncStaleProfilesFromRelay: (relayUrl: string, ...rest: unknown[]) =>
    syncStaleProfilesFromRelay(relayUrl, ...rest),
}))

const { AuthGate } = await import('./AuthGate')

const app = () => <AuthGate><div>app</div></AuthGate>

beforeEach(() => {
  convexAuth = { isLoading: true, isAuthenticated: false }
  session = { isLoading: false, isAuthenticated: true, fetchAccessToken: async () => 'token' }
  adopt.mockClear()
  syncStaleProfilesFromRelay.mockClear()
  markEntered.mockClear()
})

afterEach(() => vi.clearAllMocks())

describe('the gate', () => {
  it('renders the app on an Estiva ID session while Convex has not answered', () => {
    render(app())
    expect(screen.getByText('app')).toBeTruthy()
    expect(screen.queryByText('auth shell')).toBeNull()
    expect(markEntered).toHaveBeenCalled()
    // Nothing is sent to Convex before it has taken the token.
    expect(adopt).not.toHaveBeenCalled()
  })

  it('shows the auth shell, and not the app, without a session', () => {
    session = { ...session, isAuthenticated: false }
    render(app())
    expect(screen.getByText('auth shell')).toBeTruthy()
    expect(screen.queryByText('app')).toBeNull()
    expect(markEntered).not.toHaveBeenCalled()
  })

  it('keeps the app up when adopting the identity fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    adopt.mockImplementationOnce(async () => {
      throw new Error('no')
    })
    convexAuth = { isLoading: false, isAuthenticated: true }
    render(app())
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.getByText('app')).toBeTruthy()
    expect(syncStaleProfilesFromRelay).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the Convex bootstrap', () => {
  it('adopts the identity once Convex confirms the token, then syncs profiles', async () => {
    const view = render(app())
    expect(adopt).not.toHaveBeenCalled()

    convexAuth = { isLoading: false, isAuthenticated: true }
    view.rerender(app())

    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))
    expect(adopt).toHaveBeenCalledTimes(1)
    expect(syncStaleProfilesFromRelay.mock.calls[0]?.[0]).toBe('wss://relay.test')
  })

  it('syncs once, not once per re-render', async () => {
    convexAuth = { isLoading: false, isAuthenticated: true }
    const view = render(app())
    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))

    // The roster query and the action both cost a relay round trip, so a
    // re-render must not buy another one.
    view.rerender(app())
    view.rerender(app())

    expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1)
    expect(adopt).toHaveBeenCalledTimes(1)
  })

  it('does not sync before the identity is adopted', async () => {
    // Adoption is what creates the viewer row; both functions the sync calls
    // resolve the viewer and answer nothing without one.
    let release: () => void = () => {}
    adopt.mockImplementationOnce(() => new Promise<undefined>((r) => { release = () => r(undefined) }))
    convexAuth = { isLoading: false, isAuthenticated: true }

    render(app())
    await waitFor(() => expect(adopt).toHaveBeenCalled())
    expect(syncStaleProfilesFromRelay).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))
  })
})
