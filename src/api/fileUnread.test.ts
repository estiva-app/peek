import { describe, it, expect } from 'vitest'
import type { ConversationMessage } from '@estiva-app/interop'
import { fileHasUnread } from './fileUnread'

const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const ROOT = 'a'.repeat(64)
const NOW = 1_800_000_000
const HORIZON = 90 * 24 * 60 * 60

const root = (id: string, at: number, by = THEM): ConversationMessage => ({ id, at, by, root: id })
const reply = (id: string, at: number, inThread: string, by = THEM): ConversationMessage => ({
  id,
  at,
  by,
  root: inThread,
})

const frontier = (over: { file?: number; threads?: Record<string, number>; floor?: number; me?: string } = {}) => ({
  file: over.file,
  thread: (r: string) => over.threads?.[r],
  floor: over.floor,
  me: over.me ?? ME,
  nowSeconds: NOW,
  horizonSeconds: HORIZON,
})

/*
  SPEC §11.1–§11.3, FOL-16. A file's conversation answers to the file's own
  marker; the channel's is not an input here at all, which is the whole
  design — there is no way to hand it in.
*/
describe("fileHasUnread — a file's own marker decides", () => {
  it('is new when a root is later than the file marker', () => {
    expect(fileHasUnread([root(ROOT, 2000)], frontier({ file: 1000 }))).toBe(true)
  })

  it('is not new when every message predates the file marker', () => {
    expect(fileHasUnread([root(ROOT, 500), reply('r', 900, ROOT)], frontier({ file: 1000 }))).toBe(false)
  })

  it('never counts your own message as new to you', () => {
    expect(fileHasUnread([root(ROOT, 2000, ME)], frontier({ file: 1000 }))).toBe(false)
    expect(fileHasUnread([root(ROOT, 500), reply('r', 2000, ROOT, ME)], frontier({ file: 1000 }))).toBe(false)
  })

  it('is quiet with nothing in the conversation', () => {
    expect(fileHasUnread([], frontier({ file: 1000 }))).toBe(false)
    expect(fileHasUnread([], frontier())).toBe(false)
  })
})

describe('§11.3 — the thread rule, judged by the package', () => {
  // The cut-over ships unset (THREAD_RULE_FROM = MAX_TIMESTAMP), so the file
  // frontier still reaches every reply here; @estiva-app/conversation's own
  // tests hold the rule with a real cut-over.
  it("clears a reply the file marker covers even when the thread's own marker is behind", () => {
    const f = frontier({ file: 9000, threads: { [ROOT]: 1000 } })
    expect(fileHasUnread([root(ROOT, 100), reply('r', 1500, ROOT)], f)).toBe(false)
  })

  it('uses the thread marker when it is the later one', () => {
    const f = frontier({ file: 1000, threads: { [ROOT]: 9000 } })
    expect(fileHasUnread([root(ROOT, 100), reply('r', 5000, ROOT)], f)).toBe(false)
  })

  it('still shows a reply newer than both', () => {
    const f = frontier({ file: 9000, threads: { [ROOT]: 1000 } })
    expect(fileHasUnread([root(ROOT, 100), reply('r', 9500, ROOT)], f)).toBe(true)
  })

  it('reads a reply at or before the reply floor, and not one after it', () => {
    expect(fileHasUnread([root(ROOT, 100), reply('r', 5000, ROOT)], frontier({ file: 200, floor: 5000 }))).toBe(false)
    expect(fileHasUnread([root(ROOT, 100), reply('r', 5001, ROOT)], frontier({ file: 200, floor: 5000 }))).toBe(true)
  })

  it('does not let the reply floor read a root', () => {
    expect(fileHasUnread([root(ROOT, 300)], frontier({ file: 200, floor: 5000 }))).toBe(true)
  })

  it('does not let a thread marker clear a root — a root is not in its own thread', () => {
    const f = frontier({ threads: { [ROOT]: NOW } })
    expect(fileHasUnread([root(ROOT, NOW - 10)], f)).toBe(true)
  })
})

/*
  §11.6, as Peek reads it: no marker means never read *or* aged out of the
  horizon, and the message's own age tells the two apart. Nothing is written to
  settle it.
*/
describe('absence — new inside the horizon, quiet beyond it', () => {
  it('is new when a message inside the horizon has no marker at all', () => {
    expect(fileHasUnread([root(ROOT, NOW - 60)], frontier())).toBe(true)
  })

  it('is quiet when the only messages are older than the horizon', () => {
    expect(fileHasUnread([root(ROOT, NOW - HORIZON - 1)], frontier())).toBe(false)
  })

  it('a reply with only a thread marker is judged against that marker, not the horizon', () => {
    const f = frontier({ threads: { [ROOT]: NOW - 30 } })
    expect(fileHasUnread([root(ROOT, NOW - HORIZON - 1), reply('r', NOW - 60, ROOT)], f)).toBe(false)
    expect(fileHasUnread([root(ROOT, NOW - HORIZON - 1), reply('r', NOW - 10, ROOT)], f)).toBe(true)
  })
})
