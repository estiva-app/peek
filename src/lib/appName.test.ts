import { describe, expect, it } from 'vitest'
import { elsewhereAppName, fileHeading, objectLabel, openInAppUrl } from './appName'

// A bare file is named by the app that opens it since interop 0.44 — Peek, for a topic (MAN-17, PRO-24).
describe('elsewhereAppName', () => {
  it('names another app, and never Peek inside Peek', () => {
    expect(elsewhereAppName({ appName: 'Estiva Ship' })).toBe('Estiva Ship')
    expect(elsewhereAppName({ appName: 'Peek' })).toBeUndefined()
    expect(elsewhereAppName(null)).toBeUndefined()
  })
})

describe('objectLabel', () => {
  it('is the type, else another app, else nothing — never "Peek" or "File" (PEE-45)', () => {
    expect(objectLabel({ noun: 'issue', appName: 'Estiva Ship' })).toBe('Issue')
    expect(objectLabel({ appName: 'Estiva Ship' })).toBe('Estiva Ship')
    expect(objectLabel({ appName: 'Peek' })).toBeUndefined()
  })
})

describe('openInAppUrl', () => {
  it('is the manifest’s URL when it is a web page, and nothing otherwise', () => {
    expect(openInAppUrl({ openUrl: 'https://leaf.estiva.app/f/naddr1x' })).toBe('https://leaf.estiva.app/f/naddr1x')
    expect(openInAppUrl({ openUrl: 'HTTP://example.com/x' })).toBe('HTTP://example.com/x')
    expect(openInAppUrl({ openUrl: 'javascript:alert(1)' })).toBeUndefined()
    expect(openInAppUrl({ openUrl: 'data:text/html,hi' })).toBeUndefined()
    expect(openInAppUrl({})).toBeUndefined()
  })

  it('is nothing when http(s):// appears only later in the string, so a script never hides behind it', () => {
    expect(openInAppUrl({ openUrl: 'javascript:alert(1)//https://x' })).toBeUndefined()
    expect(openInAppUrl({ openUrl: 'data:text/html,<a href="http://x">' })).toBeUndefined()
  })
})

describe('fileHeading', () => {
  it('is the file’s type first, then the app it is in, then "File"', () => {
    expect(fileHeading({ noun: 'topic', appName: 'Peek' })).toBe('Topic')
    expect(fileHeading({ appName: 'Estiva Ship' })).toBe('Estiva Ship')
    expect(fileHeading({ appName: 'Peek' })).toBe('File')
  })
})
