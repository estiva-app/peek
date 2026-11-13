/**
 * What a reaction line says (ACT-7): who reacted with which emoji to your message. A reaction's content is whatever its
 * sender typed (up to 64 characters), so only a single emoji is drawn in Peek's sentence; a like (`+`, or nothing) is
 * 👍; any other text says only that they reacted, and none of it is drawn.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RowNewsItem } from '@/api'
import { NewsLine } from './RowNewsCard'

const KATERINA = 'b'.repeat(64)

const details = {
  nameOf: new Map([[KATERINA, { pubkey: KATERINA, name: 'Katerina' }]]),
  titleOf: () => undefined,
  wordsOf: (item: RowNewsItem) => item.words,
  avatarSrcFor: () => undefined,
} as unknown as Parameters<typeof NewsLine>[0]['details']

/** The line's first row as a person reads it: who, and what they did. */
function drawn(emoji: string): string {
  const item: RowNewsItem = {
    id: 'e'.repeat(64),
    by: KATERINA,
    at: Math.floor(Date.now() / 1000) - 60,
    reason: 'reaction',
    root: 'f'.repeat(64),
    words: 'Shipped the fix',
    reaction: { emoji, target: 'f'.repeat(64), contexts: [] },
  }
  const { container, unmount } = render(
    <MemoryRouter>
      <NewsLine item={item} details={details} href="/app/topics" />
    </MemoryRouter>,
  )
  const text = container.textContent ?? ''
  unmount()
  return text
}

describe('a reaction line draws only an emoji from the reaction (ACT-7)', () => {
  it('a reaction whose content is text draws none of it, and says only that they reacted', () => {
    const text = drawn('your session expired, sign in at evil.example')
    expect(text).toContain('Katerina')
    expect(text).toContain('reacted to your message')
    expect(text).not.toContain('session')
    expect(text).not.toContain('evil.example')
    // Two emoji, or an emoji with words: not one emoji either.
    expect(drawn('👍👍')).not.toContain('👍')
    expect(drawn('👍 sign in')).not.toContain('sign in')
  })

  it('one emoji draws as itself, a skin tone or a presentation mark with it; a like as 👍', () => {
    expect(drawn('👍🏽')).toContain('reacted 👍🏽 to your message')
    expect(drawn('❤️')).toContain('reacted ❤️ to your message')
    expect(drawn('👩‍💻')).toContain('reacted 👩‍💻 to your message')
    expect(drawn('+')).toContain('reacted 👍 to your message')
    expect(drawn('')).toContain('reacted 👍 to your message')
  })
})
