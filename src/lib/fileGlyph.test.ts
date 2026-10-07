import { describe, expect, it } from 'vitest'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import { addrToNaddr, encodeNevent, encodeNpub } from '@estiva-app/protocol'
import { fileGlyph, fileGlyphOfAddress, referenceGlyph, referenceGlyphOfUri } from './fileGlyph'

describe('fileGlyph', () => {
  it('draws a bare file as a topic, and Ship files with Ship’s glyphs', () => {
    expect(fileGlyph(KIND_BARE_FILE)).toBe('topic')
    expect(fileGlyph(30850)).toBe('project')
    expect(fileGlyph(30851)).toBe('issue')
  })

  it('draws anything else, or nothing known, as a file', () => {
    expect(fileGlyph(31337)).toBe('file')
    expect(fileGlyph(undefined)).toBe('file')
  })

  it('reads the kind from an address', () => {
    expect(fileGlyphOfAddress(`30851:${'a'.repeat(64)}:d`)).toBe('issue')
    expect(fileGlyphOfAddress(`${KIND_BARE_FILE}:${'a'.repeat(64)}:d`)).toBe('topic')
    expect(fileGlyphOfAddress('not-an-address')).toBe('file')
  })
})

describe('referenceGlyph', () => {
  it('draws a message as a message and a channel as a topic, the rest as fileGlyph does', () => {
    expect(referenceGlyph(9)).toBe('message')
    expect(referenceGlyph(39000)).toBe('topic')
    expect(referenceGlyph(30850)).toBe('project')
    expect(referenceGlyph(undefined)).toBe('file')
  })
})

describe('referenceGlyphOfUri', () => {
  const key = 'a'.repeat(64)
  it('reads a chip’s URI: a message, or a file by its kind', () => {
    expect(referenceGlyphOfUri(`nostr:${encodeNevent({ id: 'e'.repeat(64), relays: [] })}`)).toBe('message')
    expect(referenceGlyphOfUri(`nostr:${addrToNaddr(`30850:${key}:p`)}`)).toBe('project')
    expect(referenceGlyphOfUri(`nostr:${addrToNaddr(`30851:${key}:i`)}`)).toBe('issue')
    expect(referenceGlyphOfUri(`nostr:${addrToNaddr(`${KIND_BARE_FILE}:${key}:t`)}`)).toBe('topic')
  })

  it('leaves a person, a broken URI or none to the caller', () => {
    expect(referenceGlyphOfUri(`nostr:${encodeNpub(key)}`)).toBeUndefined()
    expect(referenceGlyphOfUri('nostr:naddr1broken')).toBeUndefined()
    expect(referenceGlyphOfUri(null)).toBeUndefined()
  })
})
