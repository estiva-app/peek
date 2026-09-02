/**
 * Another app's body, rendered — PRO-2.
 *
 * The three branches are decided by the *declaration*, never by the text, which
 * is SPEC §13.4's rule and the reason it exists: a description that happens to
 * begin with `{` is marker text if it carries no tag. So each case here fixes
 * the format and varies the body, rather than the other way round.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ResolvedSlot } from '@estiva-app/interop'
import { ForeignBody } from './ForeignBody'

const slot = (value: string, format?: ResolvedSlot['format']): ResolvedSlot => ({ value, format })

describe('ForeignBody', () => {
  it('renders §13.2 structure for marker text', () => {
    const { container } = render(
      <ForeignBody slot={slot('# Goal\n\n- one\n- two\n\n`code` and **bold**', 'marker')} />,
    )
    expect(container.querySelector('h1')?.textContent).toBe('Goal')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelector('.font-semibold')?.textContent).toBe('bold')
  })

  it('leaves a block document as text rather than drawing its JSON as markup', () => {
    // §13.5: declining to format is conformant; interpreting the body as markup
    // is what is forbidden. Nothing writes one of these yet — a real renderer is
    // RIC-5 — so the guarantee that matters is that no `#` inside the JSON
    // becomes a heading.
    //
    // The JSON is deliberately shaped so that parsing it as marker text would
    // be *visible*: a line beginning `# ` and a `**bold**` run. A document
    // whose braces merely sit on one line passes this test either way, which is
    // no test at all.
    const doc = [
      '{"type":"doc","content":[',
      '# {"type":"paragraph","id":"b1","content":[',
      '{"type":"text","text":"**stet**"}]}]}',
    ].join('\n')
    const { container } = render(<ForeignBody slot={slot(doc, 'blocks')} />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('.font-semibold')).toBeNull()
    expect(container.textContent).toContain('**stet**')
  })

  it('refuses to parse a format it does not know', () => {
    // The whole point of interop reporting `unknown` rather than guessing. This
    // body is valid marker text and must still not be rendered as any.
    const { container } = render(<ForeignBody slot={slot('# Heading\n**bold**', 'unknown')} />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('.font-semibold')).toBeNull()
    expect(container.textContent).toContain('# Heading')
  })

  it('decides by the declaration, not by what the text looks like', () => {
    // The §13.4 case, stated as a test: JSON-shaped marker text is marker text.
    const { container } = render(<ForeignBody slot={slot('{ "looks": "like json" }', 'marker')} />)
    expect(container.querySelector('p')?.textContent).toBe('{ "looks": "like json" }')
  })

  it('renders none of Peek’s private token vocabulary', () => {
    // `PEE-8` means something in Peek's corpus and nothing in Ship's. A
    // reference chip here would be Peek inventing meaning in another app's
    // content — and `[Topic]` would resolve against a directory that does not
    // describe the writer.
    //
    // The tokens are chosen to be ones Peek *does* recognise — `PEEK-12`
    // matches its Linear pattern and `PR #34` its GitHub one — because a token
    // Peek would ignore anyway proves nothing about whether the layer ran. A
    // Ship description mentioning `PR #34` means a PR in Ship's repo, and a
    // chip linking it to `github.com/peek/peek` would be a wrong answer stated
    // confidently.
    const { container } = render(
      <ForeignBody slot={slot('Fixed by PEEK-12 in PR #34', 'marker')} />,
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toBe('Fixed by PEEK-12 in PR #34')
  })

  it('does not open a widget for an address in the body', () => {
    // A widget inside a widget's body: two objects referencing each other would
    // render until something ran out. `list` has a depth budget; prose has none.
    const naddr =
      'nostr:naddr1qqrxymnvw43hy6twvusszythwden5te0dehhxarj9emkjmn99uq3uamnwvaz7tmwdaehgu3wvfskuep0qy2hwumn8ghj7un9d3shjtnyv9kh2uewd9hj7qgcwaehxw309aex2mrp0yhxxmmd9uq3wamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet59upzq'
    const { container } = render(<ForeignBody slot={slot(`Context: ${naddr}`, 'marker')} />)
    expect(container.querySelector('[data-foreign-object]')).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })
})
