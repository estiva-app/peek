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
  `@/api` reaches the relay, and the widget below the text reaches it again.
  Neither is what this file is about: the subject is the mapping from parsed
  spans and segments to DOM. Mocking them keeps the test on that.
*/
vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  // RIC-10: a reference drawn mid-sentence needs the object resolved. Nothing
  // resolves here, which is the state these tests want — the mapping to DOM is
  // the subject, and an unresolved reference still draws a chip.
  useResolvedReferences: () => ({}),
  useLinkResolver: () => () => undefined,
}))
vi.mock('./ForeignObjectWidget', () => ({ ForeignObjectWidget: () => null }))

import { MessageBody } from './MessageBody'

const show = (body: string) =>
  render(<MessageBody body={body} />).container

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
    expect(code.closest('strong')).toBeNull()
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
    expect(screen.getByText('bold').closest('strong')).not.toBeNull()
    expect(screen.getByText('italic').closest('em')).not.toBeNull()
    expect(screen.getByText('underlined').closest('u')).not.toBeNull()
  })
})

describe('MessageBody renders a labelled link (PEE-19)', () => {
  it('draws [label](url) as a link with the label as its words', () => {
    const c = show('see [the widgets topic](https://peek.estiva.app/t/1) now')
    const a = c.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://peek.estiva.app/t/1')
    expect(a?.textContent).toBe('the widgets topic')
    expect(c.textContent).toBe('see the widgets topic now')
  })

  it('a bold link is bold and a link', () => {
    const c = show('**[the topic](https://x/y)** now')
    const a = c.querySelector('a')
    expect(a?.textContent).toBe('the topic')
    expect(a?.closest('strong')).not.toBeNull()
  })

  it('a scheme a reader may not follow stays text', () => {
    const c = show('[x](javascript:alert(1))')
    expect(c.querySelector('a')).toBeNull()
    expect(c.textContent).toBe('[x](javascript:alert(1))')
  })
})
