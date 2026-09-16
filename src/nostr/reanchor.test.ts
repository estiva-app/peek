import { describe, it, expect } from 'vitest'
import { reanchorable } from './useReadStateSync'

const A = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const B = 'c8d2f1b5-3a4e-4b97-8d26-9e1f7a3b5c02'

/**
 * Found by CRO-9 check 3, not by review.
 *
 * A second browser profile came up with a slot holding 67 contexts — identical
 * to the first device's — because Convex is per *deployment* and not per device.
 * Every new Peek install read the shared horizon cache and republished the whole
 * thing as its own slot. Nothing is lost (the merge is a maximum), but every
 * slot grows toward the 65,535-byte plaintext ceiling together and `client_id`
 * stops meaning "the installation that read this".
 */
describe('reanchorable', () => {
  it('re-anchors a marker the relay has genuinely lost', () => {
    expect(reanchorable([{ context: A, atSeconds: 1000 }], {})).toEqual([
      { context: A, atSeconds: 1000 },
    ])
  })

  it('re-anchors one the relay holds at an older value', () => {
    expect(reanchorable([{ context: A, atSeconds: 5000 }], { [A]: 1000 })).toEqual([
      { context: A, atSeconds: 5000 },
    ])
  })

  /** The case that caused the bloat: the relay already has it. */
  it('leaves alone anything the relay already holds', () => {
    expect(reanchorable([{ context: A, atSeconds: 1000 }], { [A]: 1000 })).toEqual([])
    expect(reanchorable([{ context: A, atSeconds: 1000 }], { [A]: 9000 })).toEqual([])
  })

  /**
   * A fresh installation on a shared Convex deployment. Before the fix this
   * returned all of them and the new slot came up a clone of the old one.
   */
  it('gives a fresh install nothing to publish when the relay is already current', () => {
    const cached = [
      { context: A, atSeconds: 1000 },
      { context: B, atSeconds: 2000 },
    ]
    expect(reanchorable(cached, { [A]: 1000, [B]: 2000 })).toEqual([])
  })

  it('still re-anchors the subset the relay is missing', () => {
    const cached = [
      { context: A, atSeconds: 1000 },
      { context: B, atSeconds: 2000 },
    ]
    expect(reanchorable(cached, { [A]: 1000 })).toEqual([{ context: B, atSeconds: 2000 }])
  })

  it('is empty for an empty cache', () => {
    expect(reanchorable([], { [A]: 1000 })).toEqual([])
  })
})
