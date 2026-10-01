import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from '@estiva-app/interop'
import { streamHasUnread } from './streamUnread'

const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const FILE = `30851:${'b'.repeat(64)}:file`
const NOW = 1_800_000_000
const HORIZON = 90 * 24 * 60 * 60

const said = (id: string, at: number, by = THEM, root = id): ConversationMessage => ({ id, at, by, root })
const frontier = (merged: Record<string, number> = {}) => ({ merged, me: ME, nowSeconds: NOW, horizonSeconds: HORIZON })
const never = () => false

describe('streamHasUnread — SPEC §11.8 over Peek’s message projection', () => {
  it('lights for a member when somebody else said something newer than the marker', () => {
    const terms = { member: true, muted: false }
    expect(streamHasUnread([said('m', NOW - 10)], FILE, terms, frontier({ [FILE]: NOW - 20 }), never)).toBe(true)
    expect(streamHasUnread([said('m', NOW - 10)], FILE, terms, frontier({ [FILE]: NOW }), never)).toBe(false)
  })

  it('is the dot Ship clears: reading the file’s marker puts it out', () => {
    const terms = { member: true, muted: false }
    const messages = [said('m', NOW - 10)]
    expect(streamHasUnread(messages, FILE, terms, frontier(), never)).toBe(true)
    expect(streamHasUnread(messages, FILE, terms, frontier({ [FILE]: NOW - 10 }), never)).toBe(false)
  })

  it('never lights for a person who is not a member', () => {
    const terms = { member: false, muted: false }
    expect(streamHasUnread([said('m', NOW - 10)], FILE, terms, frontier(), never)).toBe(false)
  })

  it('counts only what was said from the second the person joined', () => {
    const terms = { member: true, since: NOW - 50, muted: false }
    expect(streamHasUnread([said('old', NOW - 60)], FILE, terms, frontier(), never)).toBe(false)
    expect(streamHasUnread([said('at', NOW - 50)], FILE, terms, frontier(), never)).toBe(true)
  })

  it('never counts the viewer’s own message', () => {
    const terms = { member: true, muted: false }
    expect(streamHasUnread([said('m', NOW - 10, ME)], FILE, terms, frontier(), never)).toBe(false)
  })

  it('lets a mention through a mute and through a missing membership, and nothing else', () => {
    const messages = [said('quiet', NOW - 20), said('named', NOW - 10)]
    const mentioned = (id: string) => id === 'named'
    expect(streamHasUnread([messages[0]], FILE, { member: true, muted: true }, frontier(), mentioned)).toBe(false)
    expect(streamHasUnread(messages, FILE, { member: true, muted: true }, frontier(), mentioned)).toBe(true)
    expect(streamHasUnread(messages, FILE, { member: false, muted: false }, frontier(), mentioned)).toBe(true)
  })

  it('judges a reply against its thread’s marker as well as the stream’s', () => {
    const terms = { member: true, muted: false }
    const root = 'a'.repeat(64)
    const thread = [said(root, NOW - 100), said('reply', NOW - 10, THEM, root)]
    expect(streamHasUnread(thread, FILE, terms, frontier({ [FILE]: NOW - 100 }), never)).toBe(true)
    expect(streamHasUnread(thread, FILE, terms, frontier({ [FILE]: NOW - 100, [`thread:${root}`]: NOW }), never)).toBe(false)
  })

  it('lights nothing without a viewer', () => {
    const terms = { member: true, muted: false }
    expect(streamHasUnread([said('m', NOW - 10)], FILE, terms, { ...frontier(), me: undefined }, never)).toBe(false)
  })
})
