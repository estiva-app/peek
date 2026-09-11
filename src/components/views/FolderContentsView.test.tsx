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
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CONVERSATION_LIMIT } from '@estiva-app/interop'
import type { ForeignObject } from '@estiva-app/interop'
import { FolderContentsView } from './FolderContentsView'

/*
  Only the two relay-backed hooks the nested rows use. Everything else in the
  seam stays real, so the peer-rendering tests above are unaffected.
*/
const children = vi.hoisted(() => ({ state: [] as unknown }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useForeignChildren: () => ({ state: children.state, reload: async () => {} }),
  useConversationCounts: () => ({}),
}))

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

/*
  Nesting and counts, which are two answers to "what is worth my attention" in a
  list the folder read deliberately does not resolve.
*/
describe('a file that holds other files', () => {
  const project = (over: Partial<ForeignObject> = {}) =>
    file({ ref: 'proj', listsChildren: true, slots: { title: { value: 'Payments' } }, ...over })
  const topic = (over: Partial<ForeignObject> = {}) =>
    file({ ref: 'top', kind: 39000, appName: 'Peek', slots: { title: { value: 'Standup' } }, ...over })

  it('offers an expander only where the owning app declared a child list', () => {
    render(<FolderContentsView state={folder([project(), topic()])} />)

    expect(screen.getByRole('button', { name: /Show what is in Payments/ })).toBeInTheDocument()
    // A topic declares none. A disclosure here would open onto nothing, for ever.
    expect(screen.queryByRole('button', { name: /Show what is in Standup/ })).not.toBeInTheDocument()
  })

  it('draws the children under the parent rather than beside it', async () => {
    children.state = [file({ ref: 'iss1', kind: 30851, widget: 'row', slots: { title: { value: 'Refunds' } } })]
    render(<FolderContentsView state={folder([project()])} />)

    await userEvent.click(screen.getByRole('button', { name: /Show what is in Payments/ }))

    // Nested, not promoted to a peer: the issue lives inside the project's row.
    const nest = document.querySelector('[data-children-of="proj"]')
    expect(nest).not.toBeNull()
    expect(nest?.textContent).toContain('Refunds')
  })

  it('does not offer to expand a child, because the depth budget is one', async () => {
    children.state = [file({ ref: 'iss1', kind: 30851, listsChildren: true, slots: { title: { value: 'Refunds' } } })]
    render(<FolderContentsView state={folder([project()])} />)

    await userEvent.click(screen.getByRole('button', { name: /Show what is in Payments/ }))

    // `MAX_LIST_DEPTH` is 1 in interop, so a control here could never be served.
    expect(screen.queryByRole('button', { name: /Show what is in Refunds/ })).not.toBeInTheDocument()
  })

  it('says an unreadable expansion is unreadable, not empty', async () => {
    children.state = { failed: 'unreachable' }
    render(<FolderContentsView state={folder([project()])} />)

    await userEvent.click(screen.getByRole('button', { name: /Show what is in Payments/ }))

    expect(screen.getByText('What is in this could not be read.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing in this yet.')).not.toBeInTheDocument()
  })
})

describe('how many messages a file holds', () => {
  const project = file({ ref: 'proj', slots: { title: { value: 'Payments' } } })

  it('shows a count when there is one', () => {
    render(<FolderContentsView state={folder([project])} counts={{ proj: 12 }} />)
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('draws nothing when nobody asked, rather than a zero', () => {
    // A file absent from the map was never askable. "0" would be an assertion
    // nobody made.
    render(<FolderContentsView state={folder([project])} counts={{}} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('draws nothing for a real zero either, because a topic counts zero while busy', () => {
    /*
      A Peek topic's messages carry `h` and no `a`, so it counts zero however
      much has been said in it. Drawing "0 messages" over a live conversation
      would be worse than saying nothing.
    */
    render(<FolderContentsView state={folder([project])} counts={{ proj: 0 }} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('says "and more" at the cap instead of implying an exact total', () => {
    render(<FolderContentsView state={folder([project])} counts={{ proj: CONVERSATION_LIMIT }} />)
    expect(screen.getByText(`${CONVERSATION_LIMIT}+`)).toBeInTheDocument()
  })

  it('puts the count in the conversation control\'s name, not only on screen', () => {
    // The badge is a bare number; a screen reader needs the noun with it.
    render(
      <FolderContentsView state={folder([project])} counts={{ proj: 12 }} onSelect={() => {}} />,
    )
    expect(
      screen.getByRole('button', { name: /Conversation about Payments, 12 messages/ }),
    ).toBeInTheDocument()
  })
})


/*
  The duplication reported on production's "Feedback on Peek": that folder has
  no state event, so it is read by containment, and Ship writes the folder's `h`
  on an issue as well as on its project. Both arrive in one listing, and once a
  project expands to its issues every issue is drawn twice.
*/
describe('a child is not also a peer', () => {
  const PROJ = '30850:abc:p1'
  const project = file({ ref: PROJ, address: PROJ, listsChildren: true, slots: { title: { value: 'Payments' } } })
  const issueOf = (parent: string | undefined, title: string, ref = `30851:abc:${title}`) =>
    file({ ref, address: ref, kind: 30851, widget: 'row', parentRef: parent, slots: { title: { value: title } } })

  it('drops an issue whose project is in the same folder', () => {
    render(<FolderContentsView state={folder([project, issueOf(PROJ, 'Refunds')])} />)

    expect(screen.getByText('Payments')).toBeInTheDocument()
    // Reachable by expanding Payments, and only there.
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
  })

  it('keeps an issue whose project is NOT in this folder', () => {
    /*
      The qualifier is the whole rule. Hiding this would make it unreachable —
      a file the folder holds and does not show, which is the disclosure bug
      §4.2 argues against, reached from the other side.
    */
    render(<FolderContentsView state={folder([issueOf('30850:abc:elsewhere', 'Refunds')])} />)
    expect(screen.getByText('Refunds')).toBeInTheDocument()
  })

  it('keeps an issue that names no project at all', () => {
    // `via: 'a'` is optional on Ship's writer; such an issue is in nobody's list.
    render(<FolderContentsView state={folder([project, issueOf(undefined, 'Orphan')])} />)
    expect(screen.getByText('Orphan')).toBeInTheDocument()
  })

  it('still draws the project itself, which is nobody\'s child', () => {
    render(<FolderContentsView state={folder([project, issueOf(PROJ, 'Refunds')])} />)
    expect(screen.getByRole('button', { name: /Show what is in Payments/ })).toBeInTheDocument()
  })
})
