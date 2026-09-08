/**
 * The folder view — RFC 0.4 §4 and §5.
 *
 * The claim worth pinning is not that Peek can draw a Ship project. It is that
 * Peek draws a Folder's contents **without knowing what they are**: a project,
 * another topic and a record from an app nobody wrote come out as peers, each
 * through its owner's declared widget.
 *
 * The fixtures therefore include a kind neither app designed for. If this file
 * only ever tested 30850 and 39000 it would be testing an integration.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { FolderContentsView } from './FolderContentsView'

const file = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    ref: 'r',
    address: 'a',
    naddr: 'naddr1',
    eventId: 'e',
    kind: 30850,
    widget: 'card',
    appName: 'Estiva Ship',
    slots: {},
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: true,
    ...over,
  }) as ForeignObject

const folder = (files: ForeignObject[], over: Record<string, unknown> = {}) =>
  ({ id: 'f1', name: 'Onboarding', hasState: true, source: 'state', files, ...over }) as never

describe('FolderContentsView', () => {
  it('draws a Ship project and a Peek topic as peers', () => {
    render(
      <FolderContentsView
        state={folder([
          file({ ref: 'p', kind: 30850, appName: 'Estiva Ship', slots: { title: { value: 'Payment integration' } } }),
          file({ ref: 't', kind: 39000, appName: 'Peek', slots: { title: { value: 'Feedback on Ship' } } }),
        ])}
      />,
    )
    expect(screen.getByText('Payment integration')).toBeInTheDocument()
    expect(screen.getByText('Feedback on Ship')).toBeInTheDocument()
  })

  it('draws a kind neither app designed for, via the widget fallback chain', () => {
    // `tideboard` is a widget nothing implements. RFC 0.4 §13.3 closes every
    // chain in card/row/table/stat so there is always something left to draw,
    // and drawing nothing is the PEE-10 failure.
    render(
      <FolderContentsView
        state={folder([
          file({ ref: 'x', kind: 30911, appName: 'Tide table', widget: ['tideboard', 'card'], slots: { title: { value: 'Spring tides' } } }),
        ])}
      />,
    )
    expect(screen.getByText('Spring tides')).toBeInTheDocument()
  })

  it('says when the list came from channel containment rather than folder state', () => {
    render(<FolderContentsView state={folder([file({})], { source: 'channel', hasState: false })} />)
    expect(screen.getByText(/no folder state yet/i)).toBeInTheDocument()
  })

  it('an empty folder says so rather than rendering nothing', () => {
    render(<FolderContentsView state={folder([])} />)
    expect(screen.getByText('Nothing in this folder yet.')).toBeInTheDocument()
  })

  it('a refused read is a different sentence from an empty folder', () => {
    // The PEE-10 ambiguity, one level up: before this distinction existed, a
    // relay that refused the read produced the same words as a Folder with
    // nothing in it.
    render(<FolderContentsView state={{ failed: 'unreachable' }} />)
    expect(screen.getByText('This folder could not be read.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing in this folder yet.')).not.toBeInTheDocument()
  })
})
