// @vitest-environment jsdom
/**
 * What the sign-in screen offers in each state (PEEK-116, AUT-3). The screen is
 * the package's `EntryShell`; what is Peek's is which state gets which button,
 * and only actions that can succeed are offered.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CONTINUE_LABEL, RETRY_LABEL, SHELL_COPY } from '@estiva-app/identity'
import { AuthShell } from './AuthShell'

describe('AuthShell', () => {
  it('an ended sign-in says why and offers the passkey, which runs on the tap', async () => {
    const onContinue = vi.fn()
    render(<AuthShell state={{ phase: 'authenticating', reason: 'session_expired' }} onContinue={onContinue} />)
    expect(screen.getByText(SHELL_COPY.session_expired)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: CONTINUE_LABEL }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('a network failure offers to try again', () => {
    render(<AuthShell state={{ phase: 'failed', reason: 'network' }} onContinue={() => {}} />)
    expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeTruthy()
  })

  it('a suspended identity says why and offers no button, since signing in again cannot help', () => {
    render(<AuthShell state={{ phase: 'failed', reason: 'identity_inactive' }} onContinue={() => {}} />)
    expect(screen.getByText(SHELL_COPY.identity_inactive)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('while entry is checking, nothing is offered and no line is shown', () => {
    render(<AuthShell state={{ phase: 'checking' }} onContinue={() => {}} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(SHELL_COPY.session_expired)).toBeNull()
  })
})
