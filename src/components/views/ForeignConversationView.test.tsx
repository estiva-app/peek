import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ForeignObject, People } from '@estiva-app/interop'
import { ForeignConversationView } from './ForeignConversationView'

/**
 * Peek draws another app's conversation — RFC 0.5 §10.
 *
 * The assertions worth having here are not "it renders a list". They are the
 * two things that would make the pivot's evidence worthless if they broke:
 *
 * 1. **An unreadable conversation never renders as an empty one.** The whole
 *    reason `unresolved` is a state of its own. A CORS-blocked read rendering
 *    as "nothing said" is the same defect that showed "No folders yet" about
 *    eighty-one folders, one level down.
 * 2. **No kind number decides anything.** A file from an app nobody has written
 *    draws exactly as a Ship project does, which is what makes aspects a model
 *    rather than an integration with Ship.
 */
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  // The panel asks whether a *topic* is resolved so `MessageBody` can strike
  // through a resolved one. Nothing here is a topic; the seam just has to exist.
  useIsTopicResolved: () => () => false,
  // RIC-10: a body resolves its inline references through the relay, which is
  // a Convex query and needs a provider these tests do not mount. None of the
  // comments here carries a pointer, so there is nothing to resolve.
  useResolvedReferences: () => ({}),
}))

const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const PEOPLE: People = { [CATH]: { displayName: 'Cath' } }

const object = (over: Partial<ForeignObject> = {}): ForeignObject =>
  ({
    ref: `30850:${SHIP}:proj`,
    address: `30850:${SHIP}:proj`,
    naddr: 'naddr1',
    eventId: 'e',
    kind: 30850,
    widget: 'card',
    appName: 'Estiva Ship',
    slots: { title: { value: 'Folders: navigation for the whole suite' } },
    meta: [],
    comments: [],
    actions: [],
    viaRecommendation: true,
    ...over,
  }) as ForeignObject

const at = (secondsAgo: number) => Math.floor(Date.now() / 1000) - secondsAgo

describe('ForeignConversationView', () => {
  it("draws a Ship project's comments in Peek", () => {
    render(
      <ForeignConversationView
        people={PEOPLE}
        state={object({
          comments: [
            { id: 'c1', author: CATH, body: 'Renamed and rescoped.', createdAt: at(3600) },
          ],
        })}
      />,
    )

    expect(screen.getByText('Renamed and rescoped.')).toBeInTheDocument()
    expect(screen.getByText('Cath')).toBeInTheDocument()
  })

  it('orders a conversation oldest first, not newest first', () => {
    render(
      <ForeignConversationView
        people={PEOPLE}
        state={object({
          comments: [
            { id: 'late', author: CATH, body: 'Second thing', createdAt: at(60) },
            { id: 'early', author: CATH, body: 'First thing', createdAt: at(7200) },
          ],
        })}
      />,
    )

    // A change log is read newest-first; a conversation is not. The resolved
    // order is the relay's, which is neither, so this must not be incidental.
    const bodies = screen.getAllByText(/thing$/).map((node) => node.textContent)
    expect(bodies).toEqual(['First thing', 'Second thing'])
  })

  it('does not call an unreadable conversation an empty one', () => {
    for (const state of [{ failed: 'unreachable' } as const, 'unresolved' as const]) {
      const { unmount } = render(<ForeignConversationView state={state} />)
      expect(screen.getByText('This conversation could not be read.')).toBeInTheDocument()
      expect(screen.queryByText('Nothing said about this yet.')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('says nothing was said only when the read actually succeeded', () => {
    render(<ForeignConversationView state={object({ comments: [] })} />)
    expect(screen.getByText('Nothing said about this yet.')).toBeInTheDocument()
  })

  it('draws an unknown app the same as it draws Ship', () => {
    // The claim aspects rest on. If this needed a branch, the model would be an
    // integration with Ship wearing a general name.
    render(
      <ForeignConversationView
        state={object({
          kind: 30911,
          appName: 'Tide table',
          widget: ['tideboard', 'card'],
          comments: [{ id: 'c1', author: SHIP, body: 'Spring tide at 06:12.', createdAt: at(60) }],
        })}
      />,
    )

    expect(screen.getByText('Spring tide at 06:12.')).toBeInTheDocument()
  })

  it('names an author with no profile by key rather than calling them Unknown', () => {
    render(
      <ForeignConversationView
        state={object({
          comments: [{ id: 'c1', author: SHIP, body: 'Accepted.', createdAt: at(60) }],
        })}
      />,
    )

    expect(screen.getByText(`${SHIP.slice(0, 8)}…`)).toBeInTheDocument()
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument()
  })
})
