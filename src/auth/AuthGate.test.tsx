/**
 * The gate is Estiva ID's (REM-2).
 *
 * The first test is the regression: Convex never confirming the token used to
 * hold the whole app on the auth shell, which made a Convex outage a Peek
 * outage for screens that read nothing from Convex.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/** What the Estiva ID session answers. */
let session = { isAuthenticated: true }

vi.mock('@/api', () => ({ hasRelay: true, RELAY_URL: 'wss://relay.test' }))
vi.mock('./useEstivaIdSession', () => ({ useEstivaIdSession: () => session }))
vi.mock('./shell/AuthShell', () => ({ AuthShell: () => <div>auth shell</div> }))
const markEntered = vi.fn()
vi.mock('./shell/useAuthShell', () => ({
  markEntered: () => markEntered(),
  useAuthShell: () => ({ state: {}, onContinue: () => {} }),
}))

const { AuthGate } = await import('./AuthGate')

const app = () => <AuthGate><div>app</div></AuthGate>

beforeEach(() => {
  session = { isAuthenticated: true }
  markEntered.mockClear()
})

afterEach(() => vi.clearAllMocks())

describe('the gate', () => {
  it('renders the app on an Estiva ID session', () => {
    render(app())
    expect(screen.getByText('app')).toBeTruthy()
    expect(screen.queryByText('auth shell')).toBeNull()
    expect(markEntered).toHaveBeenCalled()
  })

  it('shows the auth shell, and not the app, without a session', () => {
    session = { ...session, isAuthenticated: false }
    render(app())
    expect(screen.getByText('auth shell')).toBeTruthy()
    expect(screen.queryByText('app')).toBeNull()
    expect(markEntered).not.toHaveBeenCalled()
  })
})
