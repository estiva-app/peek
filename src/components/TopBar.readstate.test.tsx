import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DebugMenu } from './DebugMenu'

/**
 * The dual-run readout has to be reachable on the real app.
 *
 * CRO-7 put it in the debug menu, and the debug BUTTON is hidden when Convex is
 * configured (issue #6) because the menu's other sections drive the mock
 * dataset. So the panel existed in production and nothing could open it — it
 * computed all day with no way to look at it. Found when somebody went looking
 * for the button and it was not there.
 */
vi.mock('@/api', () => ({ hasConvex: true }))
vi.mock('@/lib/debug', () => ({
  useDebug: () => ({
    state: { readState: { dualRun: true }, desk: {}, unreads: {} },
    setDesk: vi.fn(), setUnreads: vi.fn(), setReadState: vi.fn(),
    readStateDiff: null,
  }),
}))

describe('the debug menu on the real app', () => {
  const anchor = () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('shows Read state', () => {
    render(<DebugMenu anchorEl={anchor()} onClose={() => {}} />)
    expect(screen.getByText('Read state')).toBeTruthy()
  })

  /** They toggle the mock fixture, so on the real app they would suggest a
   *  control that does nothing. That was #6's point and it still holds. */
  it('hides the mock-dataset sections', () => {
    render(<DebugMenu anchorEl={anchor()} onClose={() => {}} />)
    expect(screen.queryByText('Desk')).toBeNull()
    expect(screen.queryByText('Unreads')).toBeNull()
    expect(screen.queryByText('Huddles')).toBeNull()
  })
})
