/**
 * Why a reaction was refused, kept for the message's card (PEEKM-5).
 *
 * The line under the message is for the card on screen when the relay
 * answers. With none drawn, the view says it in a note instead, and the line
 * must not wait for the card to come back: that would say it twice, the
 * second time long after.
 */
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { refuseReaction, useRefusedReaction } from './reactions'

function Line({ id }: { id: string }) {
  const refused = useRefusedReaction(id)
  return <p>{refused ? `Not reacted: ${refused}.` : 'nothing'}</p>
}

describe('a refused reaction', () => {
  it('is said under the message whose card is on screen — the control', () => {
    render(<Line id="m1" />)
    act(() => {
      expect(refuseReaction('m1', 'the relay did not take it')).toBe(true)
    })
    expect(screen.getByText('Not reacted: the relay did not take it.')).toBeInTheDocument()
  })

  it('with no card on screen, is left to the note and not said again when the card comes back', () => {
    expect(refuseReaction('m2', 'the relay did not take it')).toBe(false)
    render(<Line id="m2" />)
    expect(screen.getByText('nothing')).toBeInTheDocument()
  })

  it('goes with the last card that drew it', () => {
    const first = render(<Line id="m3" />)
    act(() => {
      refuseReaction('m3', 'the relay did not take it')
    })
    first.unmount()
    render(<Line id="m3" />)
    expect(screen.getByText('nothing')).toBeInTheDocument()
  })
})
