import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SizeReadout } from './ReadStatePanel'

/**
 * The visible half of the byte cap (SHR-4).
 *
 * The done-when asks for the failure to be visible "rather than a `console.warn`
 * nobody reads", so what it looks like when read state is being dropped is worth
 * a test of its own: a count nobody renders is the same as a log line nobody
 * reads. The numbers themselves are `readStateCap.test.ts`.
 */
const measured = {
  contexts: 287,
  bytes: 24379,
  pctOfCeiling: 37.2,
  ceilingBytes: 65535,
  slotBytes: undefined,
  evicted: 0,
}

describe('SizeReadout', () => {
  it('names the size against the ceiling, not just a context count', () => {
    render(<SizeReadout {...measured} />)
    expect(screen.getByText(/287 contexts/)).toBeInTheDocument()
    expect(screen.getByText(/24,379 of 65,535 bytes/)).toBeInTheDocument()
    expect(screen.getByText('37.2% of the ceiling')).toBeInTheDocument()
  })

  it('says nothing alarming while there is headroom', () => {
    render(<SizeReadout {...measured} />)
    expect(screen.queryByText(/dropped/)).not.toBeInTheDocument()
    expect(document.querySelector('.text-warning-default')).toBeNull()
  })

  it('warns before anything is lost, once the blob is close', () => {
    render(<SizeReadout {...measured} bytes={56180} pctOfCeiling={85.7} contexts={690} />)
    expect(screen.getByText(/the oldest markers will start dropping/)).toHaveClass(
      'text-warning-default',
    )
  })

  it('says how many markers were dropped once the cap has evicted', () => {
    render(<SizeReadout {...measured} pctOfCeiling={99.9} evicted={14} />)
    expect(screen.getByText(/14 oldest markers dropped to stay under it/)).toHaveClass(
      'text-warning-default',
    )
  })

  it('reads as English for a single marker', () => {
    render(<SizeReadout {...measured} pctOfCeiling={99.9} evicted={1} />)
    expect(screen.getByText(/1 oldest marker dropped to stay under it/)).toBeInTheDocument()
  })

  it('names this slot separately once the queue has hydrated', () => {
    render(<SizeReadout {...measured} slotBytes={18004} />)
    expect(screen.getByText(/this slot 18,004/)).toBeInTheDocument()
  })
})
