import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopBar } from './TopBar'

/**
 * The viewer's photo in the top bar comes through the avatar registry's
 * viewer branch, which is keyed by the literal CURRENT_USER_NAME ("You") —
 * the uploaded avatar lives ONLY behind that key. The bar displays the
 * profile NAME (me.name), but it must never use that name for the picture
 * lookup: a signed-in person's profile name is not "You", the generic path
 * knows nothing about the viewer's upload, and the face silently degrades
 * to initials. Shipped broken on 2026-09-02; this pins the seam.
 *
 * Mock mode and Storybook hand portraits to ANY name, so only a
 * registry-faithful mock (photo behind "You" alone) can catch it — which
 * is exactly what this mock is.
 */
vi.mock('@/api', () => ({
  hasConvex: true,
  CURRENT_USER_NAME: 'You',
  PROFILE_EDIT_URL: 'https://id.example/profile',
  useCurrentUser: () => ({ id: 'u1', name: 'Katerina Kelepouri', email: 'k@example.com' }),
  useRelayUrl: () => 'wss://relay.example',
  useAvatarSrc: () => (name: string | undefined) => (name === 'You' ? 'https://cdn.example/me.png' : undefined),
}))
vi.mock('@/auth/useSignOut', () => ({ useSignOut: () => vi.fn() }))

describe('TopBar viewer avatar', () => {
  it('resolves the photo through the viewer branch, not the display name', () => {
    render(<TopBar />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://cdn.example/me.png')
  })
})
