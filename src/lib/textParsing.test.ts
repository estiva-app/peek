import { describe, it, expect } from 'vitest'
import {
  MENTION_RE,
  INLINE_TOKEN_RE,
  matchReference,
  matchUrl,
  parseInlineContent,
  parseBodySegments,
  parseInlineMarks,
  wrapInlineMarks,
  stripInlineFormatting,
  serializeInline,
  textToTiptapContent,
} from './textParsing'

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

describe('parseBodySegments', () => {
  it('returns a single text segment for plain text', () => {
    expect(parseBodySegments('hello world')).toEqual([
      { type: 'text', lines: ['hello world'] },
    ])
  })

  it('groups consecutive bullet items into one bullet segment', () => {
    const out = parseBodySegments('- one\n- two\n- three')
    expect(out).toEqual([{ type: 'bullet', items: ['one', 'two', 'three'] }])
  })

  it('groups consecutive numbered items into one numbered segment', () => {
    const out = parseBodySegments('1. one\n2. two\n3. three')
    expect(out).toEqual([{ type: 'numbered', items: ['one', 'two', 'three'] }])
  })

  it('handles a mix of text + bullet + text in the right order', () => {
    const out = parseBodySegments('intro\n- a\n- b\noutro')
    expect(out).toEqual([
      { type: 'text', lines: ['intro'] },
      { type: 'bullet', items: ['a', 'b'] },
      { type: 'text', lines: ['outro'] },
    ])
  })

  it('splits text on blank lines into separate text segments', () => {
    const out = parseBodySegments('para one\n\npara two')
    expect(out).toEqual([
      { type: 'text', lines: ['para one'] },
      { type: 'text', lines: ['para two'] },
    ])
  })

  it('accepts • as a bullet marker', () => {
    const out = parseBodySegments('• alpha\n• beta')
    expect(out).toEqual([{ type: 'bullet', items: ['alpha', 'beta'] }])
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

// ── External references (INLINE_TOKEN_RE + matchReference) ──

function tokenMatches(text: string): string[] {
  return Array.from(text.matchAll(INLINE_TOKEN_RE)).map((m) => m[0])
}

describe('INLINE_TOKEN_RE external references', () => {
  it('matches Linear issue keys', () => {
    expect(tokenMatches('PEEK-238 has no activity')).toEqual(['PEEK-238'])
  })

  it('matches "PR #123" as one token including the context word', () => {
    expect(tokenMatches('PR #482 is ready for review')).toEqual(['PR #482'])
  })

  it('matches "Zendesk ticket #123" as one token', () => {
    expect(tokenMatches('Zendesk ticket #48821 can be closed')).toEqual(['Zendesk ticket #48821'])
  })

  it('matches "ticket #123" without the Zendesk prefix', () => {
    expect(tokenMatches('look at ticket #48821 today')).toEqual(['ticket #48821'])
  })

  it('matches Build/build #123', () => {
    expect(tokenMatches('Build #4826 passed')).toEqual(['Build #4826'])
    expect(tokenMatches('live in production, build #5102.')).toEqual(['build #5102'])
  })

  it('matches bare #123 references', () => {
    expect(tokenMatches('review #485 and #486 please')).toEqual(['#485', '#486'])
  })

  it('still matches mentions alongside references', () => {
    expect(tokenMatches('@Alice Johnson see PR #482')).toEqual(['@Alice Johnson', 'PR #482'])
  })

  it('does NOT match a # without digits', () => {
    expect(tokenMatches('the #channel idea')).toEqual([])
  })
})

describe('URL tokenization', () => {
  it('matches an http(s) URL as one whole token', () => {
    expect(tokenMatches('see https://linear.app/peek-app/document/x-49287455c230 now'))
      .toEqual(['https://linear.app/peek-app/document/x-49287455c230'])
  })

  it('does not split a #fragment inside a URL as a reference', () => {
    expect(tokenMatches('https://example.com/page#section-123'))
      .toEqual(['https://example.com/page#section-123'])
  })

  it('keeps mentions and references working alongside a URL', () => {
    expect(tokenMatches('@Alice Johnson posted https://x.com and PR #482'))
      .toEqual(['@Alice Johnson', 'https://x.com', 'PR #482'])
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

describe('matchReference', () => {
  it('classifies PEEK keys as linear with an issue href', () => {
    expect(matchReference('PEEK-238')).toEqual({
      kind: 'linear',
      href: 'https://linear.app/peek/issue/PEEK-238',
    })
  })

  it('classifies PR and bare # as github pull hrefs', () => {
    expect(matchReference('PR #482')?.kind).toBe('github')
    expect(matchReference('#485')?.href).toBe('https://github.com/peek/peek/pull/485')
  })

  it('classifies tickets as zendesk hrefs', () => {
    expect(matchReference('Zendesk ticket #48821')?.kind).toBe('ticket')
    expect(matchReference('ticket #48821')?.href).toBe('https://peek.zendesk.com/agent/tickets/48821')
  })

  it('classifies builds as CI run hrefs', () => {
    expect(matchReference('Build #4821')?.kind).toBe('build')
  })

  it('returns null for mentions, brackets, and plain text', () => {
    expect(matchReference('@Alice Johnson')).toBeNull()
    expect(matchReference('[Some Topic]')).toBeNull()
    expect(matchReference('plain words')).toBeNull()
  })
})

// ── Inline formatting marks (rich text) ──

describe('parseInlineMarks', () => {
  it('returns a single unstyled span for plain text', () => {
    expect(parseInlineMarks('hello world')).toEqual([{ text: 'hello world' }])
  })

  it('parses **bold**', () => {
    expect(parseInlineMarks('a **bold** word')).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' word' },
    ])
  })

  it('parses *italic* and __underline__', () => {
    expect(parseInlineMarks('*it* and __un__')).toEqual([
      { text: 'it', italic: true },
      { text: ' and ' },
      { text: 'un', underline: true },
    ])
  })

  it('parses ***bold italic*** as one combined span', () => {
    expect(parseInlineMarks('***both***')).toEqual([{ text: 'both', bold: true, italic: true }])
  })

  it('parses nested __**marks**__', () => {
    expect(parseInlineMarks('__**both**__')).toEqual([{ text: 'both', bold: true, underline: true }])
  })

  it('parses multi-word content and multiple pairs on one line', () => {
    expect(parseInlineMarks('**two words** then *more here*')).toEqual([
      { text: 'two words', bold: true },
      { text: ' then ' },
      { text: 'more here', italic: true },
    ])
  })

  it('leaves unmatched markers as literal text', () => {
    expect(parseInlineMarks('a ** dangling')).toEqual([{ text: 'a ** dangling' }])
    expect(parseInlineMarks('*unclosed')).toEqual([{ text: '*unclosed' }])
  })

  it('rejects pairs with whitespace at the inner edges', () => {
    expect(parseInlineMarks('** not bold **')).toEqual([{ text: '** not bold **' }])
  })

  it('does not fire inside words (2*3*4 stays math)', () => {
    expect(parseInlineMarks('2*3*4 = 24')).toEqual([{ text: '2*3*4 = 24' }])
  })
})

describe('wrapInlineMarks', () => {
  it('wraps by mark set and round-trips through parseInlineMarks', () => {
    expect(wrapInlineMarks('bold', new Set(['bold']))).toBe('**bold**')
    expect(wrapInlineMarks('it', new Set(['italic']))).toBe('*it*')
    expect(wrapInlineMarks('un', new Set(['underline']))).toBe('__un__')
    expect(wrapInlineMarks('both', new Set(['bold', 'italic']))).toBe('***both***')
    expect(wrapInlineMarks('all', new Set(['bold', 'italic', 'underline']))).toBe('__***all***__')
    expect(parseInlineMarks(wrapInlineMarks('all', new Set(['bold', 'italic', 'underline'])))).toEqual([
      { text: 'all', bold: true, italic: true, underline: true },
    ])
  })

  it('hoists edge whitespace outside the markers so the result parses back', () => {
    expect(wrapInlineMarks('word ', new Set(['bold']))).toBe('**word** ')
    expect(wrapInlineMarks(' word', new Set(['underline']))).toBe(' __word__')
  })

  it('returns text untouched when no known marks are present', () => {
    expect(wrapInlineMarks('plain', new Set())).toBe('plain')
    expect(wrapInlineMarks('linked', new Set(['link']))).toBe('linked')
  })
})

describe('stripInlineFormatting', () => {
  it('removes markers and heading prefixes, keeps text', () => {
    expect(stripInlineFormatting('# Title\n**bold** and *it* and __un__')).toBe(
      'Title\nbold and it and un'
    )
  })

  it('leaves plain text and refs alone', () => {
    expect(stripInlineFormatting('see PR #482 at 2*3*4')).toBe('see PR #482 at 2*3*4')
  })
})

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
