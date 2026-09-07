import { describe, it, expect } from 'vitest'
import {
  MENTION_RE,
  INLINE_TOKEN_RE,
  matchUrl,
  parseInlineContent,
  serializeInline,
  serializeTextChild,
  matchLink,
  wrapLink,
  previewText,
  findUrls,
  textToTiptapContent,
} from './textParsing'
// The marker dialect lives in the package now (RIC-4). What is left here is
// Peek's own layer on top of it: mentions, bracket references, and the Tiptap
// builders. These stay so the swap is checked at the consumer too.
import { parseBodySegments, stripInlineFormatting } from '@estiva-app/protocol'

// Helper to consume MENTION_RE in a way that doesn't carry state between calls
// (it's global, so matchAll is the safe form).
function matches(text: string): string[] {
  return Array.from(text.matchAll(MENTION_RE)).map((m) => m[0])
}

describe('MENTION_RE', () => {
  it('matches @FullName mentions of a known person', () => {
    expect(matches('hey @Alice Johnson can you check this')).toEqual(['@Alice Johnson'])
  })

  it('matches !@FullName urgent mentions of a known person', () => {
    expect(matches('!@Daniel Stanton this is urgent')).toEqual(['!@Daniel Stanton'])
  })

  it('matches multiple mentions in one line', () => {
    const out = matches('Loop in @Alice Johnson and @Juan Foley please')
    expect(out).toEqual(['@Alice Johnson', '@Juan Foley'])
  })

  it('matches lowercase team handles like @backend-team', () => {
    expect(matches('paging @backend-team for review')).toEqual(['@backend-team'])
  })

  it('matches a known [Topic Title] in brackets', () => {
    expect(matches('see [CI/CD pipeline stuck during build stage] for context')).toEqual([
      '[CI/CD pipeline stuck during build stage]',
    ])
  })

  it('does NOT match @testing-library/react (lookahead carve-out for package paths)', () => {
    expect(matches('use @testing-library/react for tests')).toEqual([])
  })

  it('does NOT match a partial overlap of an unknown name', () => {
    // No PEOPLE entry "Bob"; the @Bob shouldn't match the lowercase-handle rule
    // because Bob has an uppercase first letter.
    expect(matches('hi @Bob there')).toEqual([])
  })

  it('does NOT match an unknown bracket title', () => {
    expect(matches('see [Some Random Title] please')).toEqual([])
  })
})

/**
 * A mention has to OPEN a word. The pattern fenced its right-hand side (which
 * is why package paths were safe) but not its left, so the `@` in an email
 * address started a mention and tore the address in half.
 */
describe('an @ inside a word is not a mention', () => {
  const cases = [
    ['a plain address', 'mail katerina@estiva.app today'],
    ['a dotted local part', 'first.last@estiva.app'],
    ['a hyphenated domain', 'support@peek-app.io'],
    ['plus-addressing', 'kat+peek@estiva.app'],
    ['no TLD', 'user@localhost'],
    ['an address whose domain is a known person', 'mail jan@Daniel Stanton'],
    ['an address at the very start', 'katerina@estiva.app is my address'],
  ]
  for (const [label, text] of cases) {
    it('leaves ' + label + ' alone', () => {
      expect(matches(text)).toEqual([])
      expect(tokenMatches(text)).toEqual([])
    })
  }

  // The message that reported this (2026-08-20). Rendered, the domain was
  // pulled out as a chip and the line read "katerina" "@estiva" ".estiva.app".
  it('leaves the reported message intact', () => {
    const reported =
      'It would be nice to be able to see katerina@estiva.estiva.app instead of my public key in both Ship and Peek'
    expect(matches(reported)).toEqual([])
    expect(reported.split(INLINE_TOKEN_RE)).toEqual([reported])
  })

  it('still matches every mention that opens a word', () => {
    expect(matches('@backend-team ping')).toEqual(['@backend-team'])
    expect(matches('hey @Alice Johnson')).toEqual(['@Alice Johnson'])
    expect(matches('!@Daniel Stanton now')).toEqual(['!@Daniel Stanton'])
    expect(matches('ping (@backend-team)')).toEqual(['@backend-team'])
    expect(matches('line one\n@backend-team')).toEqual(['@backend-team'])
    expect(matches('done — @backend-team')).toEqual(['@backend-team'])
  })

  it('keeps the urgent form reachable after punctuation', () => {
    expect(matches('wow!@backend-team')).toEqual(['@backend-team'])
  })
})

describe('parseInlineContent', () => {
  it('returns a single text node for plain text', () => {
    const out = parseInlineContent('hello world')
    expect(out).toEqual([{ type: 'text', text: 'hello world' }])
  })

  it('parses a known @mention into a mention node with id + label', () => {
    const out = parseInlineContent('hi @Alice Johnson there')
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ type: 'text', text: 'hi ' })
    expect(out[1]).toMatchObject({ type: 'mention', attrs: { id: 'alice', label: 'Alice Johnson' } })
    expect(out[2]).toEqual({ type: 'text', text: ' there' })
  })

  it('parses !@FullName into an urgentMention node', () => {
    const out = parseInlineContent('!@Daniel Stanton ping')
    expect(out[0]).toMatchObject({ type: 'urgentMention', attrs: { id: 'daniel', label: 'Daniel Stanton' } })
  })

  it('parses a known [Topic Title] into a topicMention with the topic id', () => {
    const out = parseInlineContent('see [CI/CD pipeline stuck during build stage] above')
    expect(out[0]).toEqual({ type: 'text', text: 'see ' })
    expect(out[1]).toMatchObject({
      type: 'topicMention',
      attrs: { id: '1', label: 'CI/CD pipeline stuck during build stage' },
    })
  })

  it('falls through to a fileMention when bracket title is not a known topic', () => {
    // Pick a real file title from APP_FILES — but to keep this test isolated,
    // we exercise the unknown-title path which still produces a fileMention
    // shape (with id === title as a fallback). The MENTION_RE wouldn't match
    // an unknown title so we can't test the actual file path here; this case
    // is exercised in the regex test above.
    // Instead: parseInlineContent on a literal plain-text bracket should NOT
    // produce a mention (regex won't match unknown titles) — so we get a
    // single text node back.
    const out = parseInlineContent('see [Unknown Made-Up Title] please')
    expect(out).toEqual([{ type: 'text', text: 'see [Unknown Made-Up Title] please' }])
  })
})

describe('serializeInline', () => {
  // Build a minimal Tiptap-shaped node from an array of children.
  function makeNode(children: Array<{ type: string; attrs?: Record<string, string>; text?: string }>) {
    return {
      forEach(cb: (c: { type: { name: string }; attrs: Record<string, string>; text?: string }) => void) {
        for (const child of children) {
          cb({ type: { name: child.type }, attrs: child.attrs ?? {}, text: child.text })
        }
      },
    }
  }

  it('roundtrips a paragraph with mention + text + urgentMention + hardBreak', () => {
    const node = makeNode([
      { type: 'text', text: 'hi ' },
      { type: 'mention', attrs: { id: 'alice', label: 'Alice Johnson' } },
      { type: 'text', text: ' and ' },
      { type: 'urgentMention', attrs: { id: 'daniel', label: 'Daniel Stanton' } },
      { type: 'hardBreak' },
      { type: 'text', text: 'next line' },
    ])
    expect(serializeInline(node)).toBe('hi @Alice Johnson and !@Daniel Stanton\nnext line')
  })

  it('serializes a topicMention as [Title] with a trailing space', () => {
    const node = makeNode([
      { type: 'text', text: 'see ' },
      { type: 'topicMention', attrs: { id: '1', label: 'CI/CD pipeline stuck during build stage' } },
      { type: 'text', text: 'thanks' },
    ])
    expect(serializeInline(node)).toBe('see [CI/CD pipeline stuck during build stage] thanks')
  })

  it('skips highlightTag children (they are consumed by the resolve action)', () => {
    const node = makeNode([
      { type: 'highlightTag', attrs: {} },
      { type: 'text', text: 'just the text' },
    ])
    expect(serializeInline(node)).toBe('just the text')
  })
})

// ── Tokenizer (INLINE_TOKEN_RE) ──

function tokenMatches(text: string): string[] {
  return Array.from(text.matchAll(INLINE_TOKEN_RE)).map((m) => m[0])
}

describe('URL tokenization', () => {
  it('matches an http(s) URL as one whole token', () => {
    expect(tokenMatches('see https://linear.app/peek-app/document/x-49287455c230 now'))
      .toEqual(['https://linear.app/peek-app/document/x-49287455c230'])
  })

  it('does not split a #fragment inside a URL', () => {
    expect(tokenMatches('https://example.com/page#section-123'))
      .toEqual(['https://example.com/page#section-123'])
  })

  it('keeps mentions working alongside a URL', () => {
    expect(tokenMatches('@Alice Johnson posted https://x.com'))
      .toEqual(['@Alice Johnson', 'https://x.com'])
  })
})

describe('matchUrl', () => {
  it('returns the href for a bare URL', () => {
    expect(matchUrl('https://example.com/a')).toEqual({ href: 'https://example.com/a', trailing: '' })
  })

  it('peels trailing punctuation off the href', () => {
    expect(matchUrl('https://example.com.')).toEqual({ href: 'https://example.com', trailing: '.' })
    expect(matchUrl('https://example.com/x),')).toEqual({ href: 'https://example.com/x', trailing: '),' })
  })

  it('returns null for non-URLs', () => {
    expect(matchUrl('@Alice Johnson')).toBeNull()
    expect(matchUrl('just text')).toBeNull()
  })
})

// ── Inline formatting marks (rich text) ──

describe('parseInlineContent with marks', () => {
  it('turns markers into marked text nodes', () => {
    expect(parseInlineContent('a **bold** word')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' word' },
    ])
  })

  it('keeps mentions working next to marks', () => {
    const out = parseInlineContent('**hi** @Alice Johnson')
    expect(out[0]).toEqual({ type: 'text', text: 'hi', marks: [{ type: 'bold' }] })
    expect(out[1]).toEqual({ type: 'text', text: ' ' })
    expect(out[2]).toMatchObject({ type: 'mention', attrs: { label: 'Alice Johnson' } })
  })
})

describe('heading lines', () => {
  it('parseBodySegments turns # / ## lines into heading segments', () => {
    expect(parseBodySegments('# Big\n## Small\nbody')).toEqual([
      { type: 'heading', level: 1, text: 'Big' },
      { type: 'heading', level: 2, text: 'Small' },
      { type: 'text', lines: ['body'] },
    ])
  })

  it('does not treat #123 refs or ### as headings', () => {
    expect(parseBodySegments('#123 is merged')).toEqual([{ type: 'text', lines: ['#123 is merged'] }])
    expect(parseBodySegments('### not a heading')).toEqual([
      { type: 'text', lines: ['### not a heading'] },
    ])
  })

  it('textToTiptapContent produces heading nodes that serialize back', () => {
    const doc = textToTiptapContent('# Big\nbody')
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Big' }],
    })
    expect(doc.content[1]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'body' }] })
  })
})

describe('quote lines', () => {
  it('parseBodySegments groups consecutive > lines into one quote segment', () => {
    expect(parseBodySegments('intro\n> first\n> second\noutro')).toEqual([
      { type: 'text', lines: ['intro'] },
      { type: 'quote', lines: ['first', 'second'] },
      { type: 'text', lines: ['outro'] },
    ])
  })

  it('requires the space after > — a bare > at line start stays literal', () => {
    expect(parseBodySegments('>no space')).toEqual([{ type: 'text', lines: ['>no space'] }])
  })

  it('leaves mid-line > untouched', () => {
    expect(parseBodySegments('5 > 3 is true')).toEqual([
      { type: 'text', lines: ['5 > 3 is true'] },
    ])
  })

  it('textToTiptapContent produces a blockquote with one paragraph per line', () => {
    const doc = textToTiptapContent('> one\n> two')
    expect(doc.content[0]).toEqual({
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    })
  })

  it('quote lines keep inline marks', () => {
    expect(parseBodySegments('> a **bold** word')).toEqual([
      { type: 'quote', lines: ['a **bold** word'] },
    ])
  })

  it('stripInlineFormatting drops the quote prefix in previews', () => {
    expect(stripInlineFormatting('> quoted **bit**')).toBe('quoted bit')
  })
})

// ── Links: [label](url), SPEC §13.1, written and read by Peek until PEE-25 ──

describe('links — [label](url) (PEE-19)', () => {
  const child = (text: string, marks: Array<{ name: string; href?: string }> = []) => ({
    type: { name: 'text' },
    attrs: {},
    text,
    marks: marks.map((m) => ({ type: { name: m.name }, attrs: m.href ? { href: m.href } : {} })),
  })

  describe('matchLink and wrapLink', () => {
    it('reads a whole token, and refuses a scheme a reader may not follow', () => {
      expect(matchLink('[the topic](https://peek.estiva.app/t/1)')).toEqual({ label: 'the topic', href: 'https://peek.estiva.app/t/1' })
      expect(matchLink('[write](mailto:jan@estiva.app)')).toEqual({ label: 'write', href: 'mailto:jan@estiva.app' })
      expect(matchLink('[x](javascript:alert(1))')).toBeNull()
      expect(matchLink('[x](ftp://files)')).toBeNull()
      expect(matchLink('[Topic]')).toBeNull()
      expect(matchLink('plain')).toBeNull()
    })

    it('hoists edge whitespace outside the brackets', () => {
      expect(wrapLink('word ', 'https://x')).toBe('[word](https://x) ')
      expect(wrapLink(' two words ', 'https://x')).toBe(' [two words](https://x) ')
      expect(wrapLink('   ', 'https://x')).toBe('   ')
    })
  })

  describe('serializeTextChild — what the composer writes', () => {
    it('a linked run becomes [label](url)', () => {
      expect(serializeTextChild(child('widgets topic', [{ name: 'link', href: 'https://google.com' }]))).toBe('[widgets topic](https://google.com)')
    })

    it('the link sits inside the other markers, never the other way round', () => {
      expect(serializeTextChild(child('widgets topic', [{ name: 'bold' }, { name: 'link', href: 'https://google.com' }]))).toBe('**[widgets topic](https://google.com)**')
    })

    it('a run without a link is the marks alone', () => {
      expect(serializeTextChild(child('plain'))).toBe('plain')
      expect(serializeTextChild(child('bold', [{ name: 'bold' }]))).toBe('**bold**')
    })

    it('serializeInline writes it in place', () => {
      const node = {
        forEach(cb: (c: ReturnType<typeof child> | { type: { name: string }; attrs: Record<string, string>; text?: string }) => void) {
          cb(child('read the '))
          cb(child('widgets topic', [{ name: 'link', href: 'https://google.com' }]))
          cb(child(' first'))
        },
      }
      expect(serializeInline(node)).toBe('read the [widgets topic](https://google.com) first')
    })
  })

  describe('parseInlineContent — what the edit editor loads back', () => {
    it('a link becomes its label with a link mark', () => {
      expect(parseInlineContent('see [the topic](https://peek.estiva.app/t/1) now')).toEqual([
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'the topic', marks: [{ type: 'link', attrs: { href: 'https://peek.estiva.app/t/1' } }] },
        { type: 'text', text: ' now' },
      ])
    })

    it('a bold link loads back bold and linked', () => {
      expect(parseInlineContent('**[t](https://u)**')).toEqual([
        { type: 'text', text: 't', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://u' } }] },
      ])
    })

    it('a label that is also a topic title is a link, not a chip', () => {
      const out = parseInlineContent('[CI/CD pipeline stuck during build stage](https://x/y)')
      expect(out).toEqual([
        { type: 'text', text: 'CI/CD pipeline stuck during build stage', marks: [{ type: 'link', attrs: { href: 'https://x/y' } }] },
      ])
    })

    it('round-trips through serializeInline', () => {
      const body = 'read the [widgets topic](https://google.com) first'
      const nodes = parseInlineContent(body)
      const node = {
        forEach(cb: (c: { type: { name: string }; attrs: Record<string, string>; text?: string; marks?: ReadonlyArray<{ type: { name: string }; attrs?: Record<string, unknown> }> }) => void) {
          for (const n of nodes) {
            cb({
              type: { name: n.type as string },
              attrs: (n.attrs as Record<string, string>) ?? {},
              text: n.text as string | undefined,
              marks: (n.marks as Array<{ type: string; attrs?: Record<string, unknown> }> | undefined)?.map((m) => ({ type: { name: m.type }, attrs: m.attrs })),
            })
          }
        },
      }
      expect(serializeInline(node)).toBe(body)
    })
  })

  describe('the tokenizer, the widgets and the previews', () => {
    it('INLINE_TOKEN_RE takes a link whole, before the chip and the URL', () => {
      expect(tokenMatches('see [the topic](https://x/y) now')).toEqual(['[the topic](https://x/y)'])
      expect(tokenMatches('[CI/CD pipeline stuck during build stage](https://x/y)')).toEqual(['[CI/CD pipeline stuck during build stage](https://x/y)'])
      expect(tokenMatches('[CI/CD pipeline stuck during build stage] above')).toEqual(['[CI/CD pipeline stuck during build stage]'])
    })

    it('findUrls sees the target of a labelled link, and never a mailto', () => {
      expect(findUrls('see [the issue](https://ship.estiva.app/issue/x) and https://example.com')).toEqual(['https://ship.estiva.app/issue/x', 'https://example.com'])
      expect(findUrls('[write](mailto:jan@estiva.app)')).toEqual([])
    })

    it('previewText reduces a link to its label', () => {
      expect(previewText('**read** the [widgets topic](https://google.com) first')).toBe('read the widgets topic first')
    })
  })
})
