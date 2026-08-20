import { describe, expect, it } from 'vitest'
import { NEAR_BOTTOM_PX, isNearBottom } from './scrollPolicy'

/** A stand-in for the scroll container; only these three numbers matter. */
const el = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
  ({ scrollHeight, scrollTop, clientHeight }) as HTMLElement

describe('isNearBottom', () => {
  it('is true when pinned to the bottom', () => {
    expect(isNearBottom(el(1000, 600, 400))).toBe(true)
  })

  it('is false once you have scrolled up to read', () => {
    expect(isNearBottom(el(1000, 200, 400))).toBe(false)
  })

  /**
   * The reason this is not a strict equality check. Display scaling and
   * fractional device pixel ratios leave a sliver of a pixel while the last
   * message is squarely in view; `=== 0` would make following work on one
   * machine and not another.
   */
  it('tolerates the sub-pixel gap a strict check would trip on', () => {
    expect(isNearBottom(el(1000.4, 599.7, 400))).toBe(true)
  })

  it('holds exactly at the threshold, and lets go one pixel past it', () => {
    expect(isNearBottom(el(1000, 600 - NEAR_BOTTOM_PX, 400))).toBe(true)
    expect(isNearBottom(el(1000, 600 - NEAR_BOTTOM_PX - 1, 400))).toBe(false)
  })

  it('is true when there is nothing to scroll', () => {
    expect(isNearBottom(el(400, 0, 400))).toBe(true)
  })
})
