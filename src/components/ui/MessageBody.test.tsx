/**
 * What a reader actually sees — RIC-4's done-when is "a body containing a
 * backtick span renders as code in Peek", and the only way to check that is to
 * render one.
 *
 * The parser these exercise lives in `@estiva-app/protocol` and is unit-tested
 * there against 152 real published bodies. What is Peek's own, and therefore
 * what is tested here, is the mapping from spans and segments to DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
  `@/api` reaches convex, and the widget below the text reaches it again. Neither
  is what this file is about: the subject is the mapping from parsed spans and
  segments to DOM. Mocking them keeps the test on that, and keeps it runnable
  without a convex deployment.
*/
vi.mock('@/api', () => ({ TOPICS: [], APP_FILES: [], DOCUMENT_FILES: [] }))
vi.mock('./ForeignObjectWidget', () => ({ ForeignObjectWidget: () => null }))

import { MessageBody } from './MessageBody'

const show = (body: string) =>
  render(<MessageBody body={body} isTopicResolved={() => false} />).container

describe('MessageBody renders the code mark', () => {
  it('puts a backtick span in a <code> element', () => {
    const c = show('run `npm test` now')
    const code = c.querySelector('code')
    expect(code?.textContent).toBe('npm test')
    expect(c.textContent).toBe('run npm test now')
  })

  it('renders a plural directly after a code span — the `main`s case', () => {
    const c = show('both `main`s agree')
    expect(c.querySelector('code')?.textContent).toBe('main')
    expect(c.textContent).toBe('both mains agree')
  })

  it('does not style code as bold when it sits inside bold', () => {
    const c = show('**bold `code` end**')
    const code = c.querySelector('code')!
    expect(code.textContent).toBe('code')
    expect(code.closest('span')?.className ?? '').not.toContain('font-semibold')
  })

  it('leaves a mention inside code as literal text, not a chip', () => {
    // The ordering fix: marks are parsed before mention tokens are split out.
    const c = show('type `@Alice Johnson` exactly')
    expect(c.querySelector('code')?.textContent).toBe('@Alice Johnson')
  })

  it('renders a fenced block as pre/code and does not interpret it', () => {
    const c = show('```ts\n# not a heading\nconst a = 1\n```')
    const pre = c.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.getAttribute('data-language')).toBe('ts')
    expect(pre?.textContent).toBe('# not a heading\nconst a = 1')
    expect(c.querySelector('h1')).toBeNull()
  })

  it('leaves an unclosed fence as text rather than swallowing the message', () => {
    const c = show('```\nstill a message')
    expect(c.querySelector('pre')).toBeNull()
    expect(c.textContent).toContain('still a message')
  })

  it('still renders the marks that were already shipping', () => {
    const c = show('a **bold** and *italic* and __underlined__ word')
    expect(c.textContent).toBe('a bold and italic and underlined word')
    expect(screen.getByText('bold').className).toContain('font-semibold')
    expect(screen.getByText('italic').className).toContain('italic')
    expect(screen.getByText('underlined').className).toContain('underline')
  })
})
