/**
 * The callback hands off to the app without a document load (PEEK-167).
 *
 * This is the property the reload cleanup turns on, and it is exactly what a
 * unit test of `completeSignIn` cannot see: the exchange can be perfect and the
 * handoff still strand somebody on the logo screen.
 *
 * It drives the real history API rather than `MemoryRouter`, because the
 * callback reads `window.location.search` directly — as it must, since it is
 * landed on by a redirect rather than routed to. A memory router leaves that
 * empty and the component takes its "no code" branch, which looks like a pass
 * for the wrong reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { EstivaIdCallback } from './EstivaIdCallback'
import { CALLBACK_PATH } from './estivaId'

const realFetch = globalThis.fetch
beforeEach(() => sessionStorage.clear())
afterEach(() => {
  sessionStorage.clear()
  globalThis.fetch = realFetch
})

function renderAt(search: string) {
  window.history.replaceState({}, '', `${CALLBACK_PATH}${search}`)
  return render(
    <BrowserRouter>
      <Routes>
        <Route path={CALLBACK_PATH} element={<EstivaIdCallback />} />
        <Route path="*" element={<div>the app</div>} />
      </Routes>
    </BrowserRouter>,
  )
}

describe('the Estiva ID callback', () => {
  it('lands in the app after a successful exchange', async () => {
    sessionStorage.setItem('peek.estivaId.codeVerifier', 'v'.repeat(43))
    sessionStorage.setItem('peek.estivaId.state', 'st4te')
    sessionStorage.setItem('peek.estivaId.returnTo', '/')
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'header.payload.sig',
        expires_in: 3600,
        pubkey: 'a'.repeat(64),
      }),
    })) as unknown as typeof fetch

    renderAt('?code=abc&state=st4te')

    await waitFor(() => expect(screen.getByText('the app')).toBeInTheDocument())
    // The token is in storage before the handoff, which is what lets
    // `useEstivaIdAuth` seed authenticated on the app's first render.
    expect(sessionStorage.getItem('peek.estivaId.token')).not.toBeNull()
    // And the callback URL is gone, code and all, without a document load.
    expect(window.location.pathname).toBe('/')
  })

  it('still leaves the callback route when the exchange fails', async () => {
    // The refusal must not strand anybody on the logo screen either. The reason
    // is handed to the shell, which renders it on the other side.
    sessionStorage.setItem('peek.estivaId.codeVerifier', 'v'.repeat(43))
    sessionStorage.setItem('peek.estivaId.state', 'st4te')
    sessionStorage.setItem('peek.estivaId.returnTo', '/')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch

    renderAt('?code=abc&state=wrong')

    await waitFor(() => expect(screen.getByText('the app')).toBeInTheDocument())
    expect(sessionStorage.getItem('peek.estivaId.shellReason')).toBe('exchange_failed')
  })
})
