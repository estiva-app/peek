import { describe, it, expect } from 'vitest'
import { extractResolutionFromText } from './resolution'

describe('extractResolutionFromText', () => {
  it('extracts a start-of-line "-> message" and removes the line from the body', () => {
    expect(extractResolutionFromText('fixed the flaky test\n-> pinned the dep to 14.x')).toEqual({
      body: 'fixed the flaky test',
      resolutionMessage: 'pinned the dep to 14.x',
    })
  })

  it('accepts the → glyph form too', () => {
    expect(extractResolutionFromText('→ shipped')).toEqual({ body: '', resolutionMessage: 'shipped' })
  })

  it('sentinel words resolve with an empty message', () => {
    expect(extractResolutionFromText('all good\n-> done')).toEqual({ body: 'all good', resolutionMessage: '' })
  })

  it('does NOT fire on mid-line arrows (prose stays intact)', () => {
    expect(extractResolutionFromText('renamed a -> b in the config')).toBeNull()
    expect(extractResolutionFromText('# + space -> Heading')).toBeNull()
  })

  it('does NOT fire inside list items', () => {
    expect(extractResolutionFromText('- ## + space -> Subheading\n- next item')).toBeNull()
    expect(extractResolutionFromText('1. step one -> step two')).toBeNull()
  })

  it('returns null when no arrow line exists', () => {
    expect(extractResolutionFromText('plain message')).toBeNull()
  })
})
