/**
 * The profile sync has to survive `relayUrl` arriving late (SHA-22).
 *
 * `relayUrl` comes from a Convex `useQuery`, and a `useQuery` is `undefined`
 * until it resolves — so on a real page load the first render never has it.
 * The sync used to live inside the adopt `.then()`, in an effect that latched
 * a `ran` ref on that first render, and its closure captured `relayUrl` as
 * `undefined`. It returned, the latch stayed closed when the URL arrived, and
 * the sync never ran at all.
 *
 * Nothing noticed for two reasons worth keeping in mind. It is wrapped in
 * `.catch(console.warn)`, so it fails quietly by construction. And
 * `importChannel` writes the same `users.image` rows for the authors of newly
 * imported messages — so anyone who had just posted got a correct avatar
 * anyway, which reads exactly like a working sync until you check somebody who
 * has been quiet.
 *
 * The first test here is the regression: it renders with `relayUrl` undefined,
 * then supplies it, and asserts the sync ran.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const adopt = vi.fn(async () => undefined)
const convexClient = { query: vi.fn(async () => []), action: vi.fn(async () => ({ ok: true })) }

/** What `useQuery(relayConfig)` returns; swapped mid-test to land the URL late. */
let relayConfig: { relayUrl: string } | undefined

vi.mock('convex/react', () => ({
  useConvex: () => convexClient,
  useMutation: () => adopt,
  useQuery: () => relayConfig,
  // The gate's branches are not what this file is about: render the
  // authenticated one and nothing else.
  Authenticated: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Unauthenticated: () => null,
  AuthLoading: () => null,
}))

vi.mock('@/api', () => ({ hasConvex: true }))
vi.mock('./estivaId', () => ({
  validToken: () => ({ accessToken: 'token', pubkey: 'a'.repeat(64) }),
  CALLBACK_PATH: '/callback',
}))
vi.mock('./shell/AuthShell', () => ({ AuthShell: () => null }))
vi.mock('./shell/useAuthShell', () => ({ markEntered: vi.fn(), useAuthShell: () => ({ state: {}, onContinue: () => {} }) }))

/** Typed on its first argument, which is the one the regression is about. */
const syncStaleProfilesFromRelay = vi.fn(async (_relayUrl: string, ..._rest: unknown[]) => undefined)
vi.mock('@/nostr/sync', () => ({
  syncStaleProfilesFromRelay: (relayUrl: string, ...rest: unknown[]) =>
    syncStaleProfilesFromRelay(relayUrl, ...rest),
}))

const { AuthGate } = await import('./AuthGate')

beforeEach(() => {
  relayConfig = undefined
  adopt.mockClear()
  syncStaleProfilesFromRelay.mockClear()
})

afterEach(() => vi.clearAllMocks())

describe('the profile sync', () => {
  it('still runs when relayUrl only arrives after the first render', async () => {
    // A cold page load: the Convex query has not resolved yet.
    const view = render(<AuthGate><div>app</div></AuthGate>)
    await waitFor(() => expect(adopt).toHaveBeenCalled())

    // ...and now it does, which is the moment the old code had already latched past.
    relayConfig = { relayUrl: 'wss://relay.test' }
    view.rerender(<AuthGate><div>app</div></AuthGate>)

    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))
    expect(syncStaleProfilesFromRelay.mock.calls[0]?.[0]).toBe('wss://relay.test')
  })

  it('runs when relayUrl is there from the start', async () => {
    relayConfig = { relayUrl: 'wss://relay.test' }
    render(<AuthGate><div>app</div></AuthGate>)

    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))
  })

  it('runs once, not once per re-render', async () => {
    relayConfig = { relayUrl: 'wss://relay.test' }
    const view = render(<AuthGate><div>app</div></AuthGate>)
    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))

    // The roster query and the action both cost a relay round trip, so a
    // re-render must not buy another one.
    view.rerender(<AuthGate><div>app</div></AuthGate>)
    view.rerender(<AuthGate><div>app</div></AuthGate>)

    expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1)
  })

  it('does not run before the identity is adopted', async () => {
    // Adoption is what creates the viewer row; both functions the sync calls
    // resolve the viewer and answer nothing without one.
    let release: () => void = () => {}
    adopt.mockImplementationOnce(() => new Promise<undefined>((r) => { release = () => r(undefined) }))
    relayConfig = { relayUrl: 'wss://relay.test' }

    render(<AuthGate><div>app</div></AuthGate>)
    await waitFor(() => expect(adopt).toHaveBeenCalled())
    expect(syncStaleProfilesFromRelay).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(syncStaleProfilesFromRelay).toHaveBeenCalledTimes(1))
  })
})
