/**
 * Another app's body, rendered — PRO-2.
 *
 * The three branches are decided by the *declaration*, never by the text, which
 * is SPEC §13.4's rule and the reason it exists: a description that happens to
 * begin with `{` is marker text if it carries no tag. So each case here fixes
 * the format and varies the body, rather than the other way round.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ResolvedSlot } from '@estiva-app/interop'
import { blobObjectUrl } from '@/nostr/media'
import { ForeignBody } from './ForeignBody'

// The relay's signed media GET, answered: what is drawn is the card, not the fetch.
vi.mock('@/nostr/media', () => ({ blobObjectUrl: vi.fn(async () => 'blob:shot') }))

const slot = (value: string, format?: ResolvedSlot['format']): ResolvedSlot => ({ value, format })

/** A block document holding one picture, as Ship and the agent write it. */
const PICTURE_DOC = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'paragraph', id: 'b1', content: [{ type: 'text', text: 'Before' }] },
    {
      type: 'attachment',
      id: 'b2',
      attrs: { url: 'https://relay.example/a279.png', thumb: 'https://relay.example/thumb/a279.png', m: 'image/png', x: 'a279', size: 2048, filename: 'shot.png' },
    },
  ],
})

describe('a picture in another app’s text (affd152a)', () => {
  it('draws as its card with the relay’s thumbnail, not as its file name', async () => {
    render(<ForeignBody slot={slot(PICTURE_DOC, 'blocks')} />)
    expect(await screen.findByRole('button', { name: 'Preview shot.png' })).toBeInTheDocument()
    expect(blobObjectUrl).toHaveBeenCalledWith('https://relay.example/thumb/a279.png')
  })
})

describe('ForeignBody', () => {
  it('renders §13.2 structure for marker text', () => {
    const { container } = render(
      <ForeignBody slot={slot('# Goal\n\n- one\n- two\n\n`code` and **bold**', 'marker')} />,
    )
    expect(container.querySelector('h1')?.textContent).toBe('Goal')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
  })

  it('renders a block document as blocks, not as its JSON', () => {
    // The reason this file changed. It used to assert the opposite — a block
    // document drawn as raw JSON — which was conformant under §13.5's "may
    // render as plain text" and was still JSON in front of a person.
    // `toRenderTree` (RIC-6) resolves both models into one tree, so there is no
    // longer a trade between rendering it and not re-implementing §13.3.
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'heading', id: 'b1', attrs: { level: 1 }, content: [{ type: 'text', text: 'Goal' }] },
        {
          type: 'paragraph',
          id: 'b2',
          content: [{ type: 'text', text: 'Ship it', marks: [{ type: 'bold' }] }],
        },
      ],
    })
    const { container } = render(<ForeignBody slot={slot(doc, 'blocks')} />)
    expect(container.querySelector('h1')?.textContent).toBe('Goal')
    expect(container.querySelector('strong')?.textContent).toBe('Ship it')
    expect(container.textContent).not.toContain('"type"')
  })

  it('degrades a malformed block document to a paragraph rather than throwing', () => {
    // A body that claims `estiva-blocks-1` and is not one. Dropping it is the
    // PEE-10 failure — blank reads as "that app is broken" — and throwing takes
    // the whole card with it.
    const { container } = render(<ForeignBody slot={slot('{"type":"doc", not json', 'blocks')} />)
    expect(container.querySelector('p')?.textContent).toBe('{"type":"doc", not json')
  })

  it('renders an unknown block type’s text rather than dropping it', () => {
    // §13.3: "A reader encountering an unknown block type MUST render that
    // block's inline text rather than dropping it, and MUST NOT drop the block
    // silently." Peek has no design for a `table`, and that is not a licence to
    // show nothing.
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'kanban', id: 'b1', content: [{ type: 'text', text: 'still readable' }] }],
    })
    const { container } = render(<ForeignBody slot={slot(doc, 'blocks')} />)
    expect(container.textContent).toContain('still readable')
    expect(container.querySelector('[data-block-type]')?.getAttribute('data-block-type')).toBe('kanban')
  })

  it('refuses to parse a format it does not know', () => {
    // The whole point of interop reporting `unknown` rather than guessing. This
    // body is valid marker text and must still not be rendered as any.
    const { container } = render(<ForeignBody slot={slot('# Heading\n**bold**', 'unknown')} />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('strong')).toBeNull()
    expect(container.textContent).toContain('# Heading')
  })

  it('decides by the declaration, not by what the text looks like', () => {
    // The §13.4 case, stated as a test: JSON-shaped marker text is marker text.
    const { container } = render(<ForeignBody slot={slot('{ "looks": "like json" }', 'marker')} />)
    expect(container.querySelector('p')?.textContent).toBe('{ "looks": "like json" }')
  })

  it('renders none of Peek’s private token vocabulary', () => {
    // Peek's tokens mean something in Peek's corpus and nothing in Ship's:
    // a mention here would name someone out of Peek's directory, and
    // `[Topic]` would resolve against a corpus that does not describe the
    // writer.
    //
    // The tokens are chosen to be ones Peek *does* recognise — `[Ongoing
    // onboarding issues]` is a real topic title and `@Alice Johnson` a real
    // directory name — because a token Peek would ignore anyway proves nothing
    // about whether the layer ran. (Until 2026-09-03 this test used `PEEK-12`
    // and `PR #34`; Peek retired those chips, so they now prove nothing here.)
    const body = 'Raised by @Alice Johnson in [Ongoing onboarding issues]'
    const { container } = render(<ForeignBody slot={slot(body, 'marker')} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
    // The two things Peek's layer would add: a mention pill, and a topic
    // chip (which draws a status icon).
    // Inside the text: the box around it names `bg-accent-muted` for an Important callout (RIC-19).
    expect(container.querySelector('[data-rich-text] [class*="bg-accent-muted"]')).toBeNull()
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    expect(container.textContent).toBe(body)
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
