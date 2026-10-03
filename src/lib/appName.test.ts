import { describe, expect, it } from 'vitest'
import { elsewhereAppName, fileHeading } from './appName'

// A bare file is named by the app that opens it since interop 0.44 — Peek, for a topic (MAN-17, PRO-24).
describe('elsewhereAppName', () => {
  it('names another app, and never Peek inside Peek', () => {
    expect(elsewhereAppName({ appName: 'Estiva Ship' })).toBe('Estiva Ship')
    expect(elsewhereAppName({ appName: 'Peek' })).toBeUndefined()
    expect(elsewhereAppName(null)).toBeUndefined()
  })
})

describe('fileHeading', () => {
  it('is the file’s type first, then the app it is in, then "File"', () => {
    expect(fileHeading({ noun: 'topic', appName: 'Peek' })).toBe('Topic')
    expect(fileHeading({ appName: 'Estiva Ship' })).toBe('Estiva Ship')
    expect(fileHeading({ appName: 'Peek' })).toBe('File')
  })
})
