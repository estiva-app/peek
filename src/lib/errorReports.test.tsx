// @vitest-environment jsdom
/**
 * A crash in Peek, read at the wire: the body of the request that would leave
 * the browser for Estiva ID holds none of the text planted in a message, a
 * topic title or the page address (PROD-2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErrorBoundary } from '@estiva-app/ui'

// The sign-in's own token handling is @estiva-app/identity's, tested there; here a signed-in QA-1.
vi.mock('@/auth/estivaId', () => ({
  ESTIVA_ID_ORIGIN: 'https://id.estiva.app',
  currentEstivaToken: () => 'qa-1-token',
}))

const PLANTED_MESSAGE = 'plantedmessage quarterly numbers'
const PLANTED_TITLE = 'plantedtitle board offsite'
const PLANTED_ADDRESS = 'plantedaddress-5a1c9e'

/** A topic whose decrypted message fails to parse, drawn under its title. */
function BrokenTopic({ title }: { title: string }) {
  const parsed = JSON.parse(PLANTED_MESSAGE) as { text: string }
  return (
    <h1>
      {title}
      {parsed.text}
    </h1>
  )
}

/** The reporter reads the token, then sends: a few turns of the microtask queue, no timer. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
let requests: Array<{ url: string; body: string }>

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      requests.push({ url, body: init.body })
      return new Response(null, { status: 202 })
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.history.pushState({}, '', `/app/teams/${PLANTED_ADDRESS}`)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Peek error reports', () => {
  it('reports a crashed panel to Estiva ID with none of the planted text', async () => {
    const { startErrorReports, ScreenSteps } = await import('./errorReports')
    startErrorReports()
    render(
      <MemoryRouter initialEntries={['/app/desk', `/app/teams/${PLANTED_ADDRESS}`]} initialIndex={1}>
        <ScreenSteps />
        <ErrorBoundary label="topic">
          <BrokenTopic title={PLANTED_TITLE} />
        </ErrorBoundary>
      </MemoryRouter>,
    )
    await flush()

    expect(requests.map((r) => r.url)).toEqual(['https://id.estiva.app/report'])
    const [{ body }] = requests as [{ url: string; body: string }]
    for (const planted of ['plantedmessage', 'quarterly', 'plantedtitle', 'offsite', 'plantedaddress']) {
      expect(body).not.toContain(planted)
    }
    const report = JSON.parse(body)
    expect(report.how).toBe('boundary')
    expect(report.error.type).toBe('SyntaxError')
    expect(report.screen).toBe('/app/teams/:id')
    expect(report.trail.map((step: { screen?: string }) => step.screen)).toEqual(['/app/teams/:id'])
  })
})

describe('screenOf', () => {
  it.each([
    [`/app/teams/${PLANTED_ADDRESS}`, '/app/teams/:id'],
    [`/app/teams/${PLANTED_ADDRESS}/chat`, '/app/teams/:id/chat'],
    ['/app/dms', '/app/dms'],
    [`/plantedtitle-board/${PLANTED_ADDRESS}`, '/:word/:ref'],
    [`/a/b/${PLANTED_ADDRESS}`, '<unknown>'],
  ])('names %s by its route, %s', async (pathname, screen) => {
    const { screenOf } = await import('./errorReports')
    expect(screenOf(pathname)).toBe(screen)
  })
})
