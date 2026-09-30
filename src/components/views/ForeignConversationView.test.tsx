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

  /*
    The affordance FOL-19 added and FOL-25 had to fix. It shipped with neither a
    story nor a test, and what that cost was nine migrated conversations whose
    replies were real, correctly threaded and counted, and which every reader
    reported as flat with most of their messages missing. The count had always
    been right; it was drawn as a bare number against the far margin beside an
    unlabelled icon, and nothing on the row said the word "replies".
  */
  describe('says what is under a comment', () => {
    const two = object({
      comments: [
        { id: 'c1', author: CATH, body: 'Renamed and rescoped.', createdAt: at(3600) },
        { id: 'c2', author: SHIP, body: 'Accepted.', createdAt: at(60) },
      ],
    })

    it('spells the count out, and gets the singular right', () => {
      render(
        <ForeignConversationView
          people={PEOPLE}
          state={two}
          onOpenThread={() => {}}
          replyCounts={{ c1: 9, c2: 1 }}
        />,
      )

      expect(screen.getByRole('button', { name: '9 replies' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '1 reply' })).toBeInTheDocument()
    })

    it('offers a reply, not a nought, where nobody has replied', () => {
      render(
        <ForeignConversationView
          people={PEOPLE}
          state={two}
          onOpenThread={() => {}}
          replyCounts={{ c1: 2 }}
        />,
      )

      // A missing entry is "nobody asked", and a "0" would be an assertion
      // nobody made — so the row says what it can offer instead.
      expect(screen.getByRole('button', { name: '2 replies' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
      expect(screen.queryByText('0')).not.toBeInTheDocument()
    })

    it('offers no thread control at all where the caller opens none', () => {
      // Inside a topic's own conversation there is no third pane to open into.
      render(<ForeignConversationView people={PEOPLE} state={two} />)

      expect(screen.queryByRole('button', { name: /repl/i })).not.toBeInTheDocument()
    })

    it('marks the comment whose thread is open', () => {
      render(
        <ForeignConversationView
          people={PEOPLE}
          state={two}
          onOpenThread={() => {}}
          replyCounts={{ c1: 9 }}
          openThreadId="c1"
        />,
      )

      expect(screen.getByRole('button', { name: '9 replies', current: true })).toBeInTheDocument()
    })

    it('draws a comment deleted under its replies where it stood, with its thread (PEE-40)', () => {
      const opened: string[] = []
      const { container } = render(
        <ForeignConversationView
          people={PEOPLE}
          state={two}
          onOpenThread={(id) => opened.push(id)}
          replyCounts={{ gone: 2 }}
          deletedRoots={[{ id: 'gone', createdAt: at(600) }]}
        />,
      )

      const rows = [...container.querySelectorAll('[data-comment]')].map((r) => r.getAttribute('data-comment'))
      expect(rows).toEqual(['c1', 'gone', 'c2'])
      expect(screen.getByText('This comment was deleted.')).toBeInTheDocument()
      screen.getByRole('button', { name: '2 replies' }).click()
      expect(opened).toEqual(['gone'])
    })

    it('draws the stand-ins when every comment was deleted', () => {
      render(
        <ForeignConversationView
          state={object()}
          onOpenThread={() => {}}
          replyCounts={{ gone: 1 }}
          deletedRoots={[{ id: 'gone', createdAt: at(600) }]}
        />,
      )

      expect(screen.getByText('This comment was deleted.')).toBeInTheDocument()
      expect(screen.queryByText('Nothing said about this yet.')).not.toBeInTheDocument()
    })
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
