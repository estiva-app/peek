import { describe, it, expect } from 'vitest'
import {
  PUBLISH_GRACE_SECONDS,
  buildDiffReport,
  detectRegressions,
  diffReadState,
  needsAttention,
} from './readStateDiff'

const A = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const B = 'c8d2f1b5-3a4e-4b97-8d26-9e1f7a3b5c02'
const THREAD = `thread:${'a'.repeat(64)}`

const NOW = 1_800_000_000 // seconds

describe('diffReadState — the two benign classes', () => {
  it('says nothing when the two agree', () => {
    expect(diffReadState({ [A]: 1000 }, { [A]: 1000 }, NOW)).toEqual([])
  })

  /** Read in Ship, or on a phone. This is the feature working, not a fault. */
  it('classifies relay-ahead as benign', () => {
    const [d] = diffReadState({ [A]: 1000 }, { [A]: 5000 }, NOW)
    expect(d.kind).toBe('relay-ahead')
    expect(d.ahead).toBe('relay')
    expect(d.deltaSeconds).toBe(4000)
  })

  it('treats a context only the relay has as relay-ahead', () => {
    const [d] = diffReadState({}, { [A]: 5000 }, NOW)
    expect(d.kind).toBe('relay-ahead')
    expect(d.localSeconds).toBeUndefined()
  })

  /** Just read here; the debounced publish has not landed yet. */
  it('classifies a fresh local read as benign', () => {
    const [d] = diffReadState({ [A]: NOW - 5 }, { [A]: 1000 }, NOW)
    expect(d.kind).toBe('local-ahead-recent')
    expect(d.ahead).toBe('local')
  })

  it('holds the benign verdict right up to the edge of the grace window', () => {
    const atEdge = diffReadState({ [A]: NOW - PUBLISH_GRACE_SECONDS }, { [A]: 1000 }, NOW)
    expect(atEdge[0].kind).toBe('local-ahead-recent')
    const pastEdge = diffReadState({ [A]: NOW - PUBLISH_GRACE_SECONDS - 1 }, { [A]: 1000 }, NOW)
    expect(pastEdge[0].kind).toBe('local-ahead-persistent')
  })
})

describe('diffReadState — the class worth investigating', () => {
  /**
   * A publish being lost, or a context id written under the wrong scheme. It is
   * indistinguishable from the benign case without checking the clock, which is
   * why the grace window exists rather than a plain "local is ahead" flag.
   */
  it('flags a local marker the publish has had every chance to land', () => {
    const [d] = diffReadState({ [A]: 1_000_000 }, { [A]: 1000 }, NOW)
    expect(d.kind).toBe('local-ahead-persistent')
  })

  it('flags a context the relay has never heard of', () => {
    const [d] = diffReadState({ [THREAD]: 1_000_000 }, {}, NOW)
    expect(d.kind).toBe('local-ahead-persistent')
    expect(d.relaySeconds).toBeUndefined()
  })

  it('reports every diverging context, sorted so a diff is readable', () => {
    const out = diffReadState({ [B]: 9000, [A]: 9000 }, { [A]: 1, [B]: 1 }, NOW)
    expect(out.map((d) => d.context)).toEqual([A, B].sort())
  })
})

describe('detectRegressions — the one that blocks the cutover', () => {
  /** §11.4 makes the merge a maximum, so its output can only grow. */
  it('catches the relay frontier moving backwards', () => {
    expect(detectRegressions({ [A]: 5000 }, { [A]: 1000 })).toEqual([
      { context: A, fromSeconds: 5000, toSeconds: 1000 },
    ])
  })

  it('is quiet when the frontier only advances', () => {
    expect(detectRegressions({ [A]: 1000 }, { [A]: 5000 })).toEqual([])
    expect(detectRegressions({ [A]: 1000 }, { [A]: 1000 })).toEqual([])
  })

  /** Aged out of the horizon, which is what CRO-6's cache covers — not a bug. */
  it('does not call a context disappearing a regression', () => {
    expect(detectRegressions({ [A]: 5000 }, {})).toEqual([])
  })

  it('has nothing to say on the first run', () => {
    expect(detectRegressions(undefined, { [A]: 1000 })).toEqual([])
  })
})

describe('buildDiffReport and needsAttention', () => {
  it('counts both sides and carries the divergences', () => {
    const report = buildDiffReport({
      local: { [A]: 9000, [B]: 1000 },
      relay: { [A]: 1000 },
      nowMs: NOW * 1000,
    })
    expect(report.localCount).toBe(2)
    expect(report.relayCount).toBe(1)
    expect(report.divergences).toHaveLength(2)
  })

  /**
   * The gate the cutover is judged on. A report full of the benign classes is
   * the expected steady state — if it counted those, nobody would read it.
   */
  it('stays quiet for a report that is only the benign classes', () => {
    const report = buildDiffReport({
      local: { [A]: NOW - 5 },
      relay: { [A]: 1000, [B]: 5000 },
      nowMs: NOW * 1000,
    })
    expect(report.divergences.map((d) => d.kind).sort()).toEqual([
      'local-ahead-recent',
      'relay-ahead',
    ])
    expect(needsAttention(report)).toBe(false)
  })

  it('asks for attention on a persistent local-ahead', () => {
    const report = buildDiffReport({
      local: { [A]: 1_000_000 },
      relay: { [A]: 1000 },
      nowMs: NOW * 1000,
    })
    expect(needsAttention(report)).toBe(true)
  })

  it('asks for attention on a regression, whatever the divergences say', () => {
    const report = buildDiffReport({
      local: { [A]: 1000 },
      relay: { [A]: 1000 },
      previousRelay: { [A]: 5000 },
      nowMs: NOW * 1000,
    })
    expect(report.divergences).toEqual([])
    expect(needsAttention(report)).toBe(true)
  })
})
