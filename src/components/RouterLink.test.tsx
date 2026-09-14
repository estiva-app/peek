/**
 * RouterLink keeps what react-router's Link did (UIG-27): a plain click moves
 * the router, a modified click is the browser's, the caller's onClick runs first
 * and can take the click, and the anchor stays real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { MouseEvent } from 'react'
import { RouterLink } from './RouterLink'

afterEach(cleanup)

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function renderLink(onClick?: (event: MouseEvent<HTMLAnchorElement>) => void) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <RouterLink href="/topics/3" variant="quiet" onClick={onClick}>
        Onboarding
      </RouterLink>
      <Where />
    </MemoryRouter>,
  )
  return screen.getByRole('link', { name: 'Onboarding' })
}

describe('RouterLink', () => {
  it('is a real anchor to its address', () => {
    expect(renderLink().getAttribute('href')).toBe('/topics/3')
  })

  it('a plain click moves the router, in place', () => {
    const link = renderLink()
    const allowed = fireEvent.click(link)
    expect(allowed).toBe(false)
    expect(screen.getByTestId('where').textContent).toBe('/topics/3')
  })

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)('a click with %s is the browser’s', (key) => {
    const link = renderLink()
    const allowed = fireEvent.click(link, { [key]: true })
    expect(allowed).toBe(true)
    expect(screen.getByTestId('where').textContent).toBe('/desk')
  })

  it("the caller's onClick runs first and can take the click", () => {
    const take = vi.fn((event: MouseEvent<HTMLAnchorElement>) => event.preventDefault())
    const link = renderLink(take)
    fireEvent.click(link)
    expect(take).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('where').textContent).toBe('/desk')
  })
})
