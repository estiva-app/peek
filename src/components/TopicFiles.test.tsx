/**
 * A topic's Files section (TOP-3, TOPI-5): Add file on the heading; each file in
 * the topic's order, as a row or a card, dragged to its place, with a "…" that
 * shows it as a row or a card or removes it (with Undo); none of that on an
 * archived topic, nor for someone who cannot add a file here.
 *
 * The list's read and writes are `useTopicFiles`'s: the entries at the wire in
 * `nostr/topicFiles.test.ts`, the arrangement's changes in interop's
 * `topicArrangement.test.ts`. Here they are stubbed so the test is about what
 * the person can press and what they see. The card is stubbed to its shape,
 * since drawing it reads the relay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

type Entry = { file: string; address: string; archived?: boolean; listed?: Record<string, unknown>; object?: unknown }
const hook = vi.hoisted(() => ({
  state: { files: [] } as unknown,
  setListed: vi.fn(async (..._: unknown[]) => ({ ok: true as const }) as { ok: true } | { ok: false; reason: string }),
  move: vi.fn(async (..._: unknown[]) => ({ ok: true as const }) as { ok: true } | { ok: false; reason: string }),
  setLook: vi.fn(async (..._: unknown[]) => ({ ok: true as const }) as { ok: true } | { ok: false; reason: string }),
  putBack: vi.fn(async (..._: unknown[]) => ({ ok: true as const }) as { ok: true } | { ok: false; reason: string }),
  choices: [] as Array<{ id: string; title: string; kind: number }>,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  fileChoices: () => hook.choices,
}))
vi.mock('@/components/ui/MessageLinks', () => ({
  MessageCard: ({ uri, compact }: { uri: string; compact?: boolean }) => <div data-testid={compact ? 'row' : 'card'} data-uri={uri} />,
}))

import { ToastProvider } from '@/lib/toast'
import { TopicFiles as Section } from './TopicFiles'

/** The section as the topic's view draws it, handed the list's read (`useTopicFiles`, stubbed above). */
const TopicFiles = ({ readOnly = false, mayChange }: { readOnly?: boolean; mayChange?: boolean }) => (
  <ToastProvider>
    <Section
      topic={TOPIC}
      title="Widgets"
      readOnly={readOnly}
      {...(mayChange === undefined ? {} : { mayChange })}
      files={{ state: hook.state as never, busy: new Set<string>(), setListed: hook.setListed, move: hook.move, setLook: hook.setLook, putBack: hook.putBack }}
    />
  </ToastProvider>
)

const AUTHOR = 'a'.repeat(64)
const TOPIC = `30840:${AUTHOR}:topic`
const entry = (file: string, kind: number, title: string, more: Partial<Entry> = {}): Entry => ({
  file,
  address: `${kind}:${AUTHOR}:${file}`,
  listed: { file, prev: { order: 'r', look: 'r' }, prevAt: 0, ...(more.listed ?? {}) },
  object: { slots: { title: { value: title } }, widget: kind === 30851 ? 'row' : 'card' },
  ...(more.archived === undefined ? {} : { archived: more.archived }),
})
const PLAN = entry('plan', 30850, 'Plan')
const BUG = entry('bug', 30851, 'Bug')
const DOC = entry('doc', 30842, 'Doc')

/** Each file's wrapper, in the order drawn. */
const drawn = () => [...document.querySelectorAll<HTMLElement>('[data-topic-file]')].filter((el) => !el.closest('[hidden]'))

/** Drag `from` over the top or bottom half of `over`, then drop it there. */
function dragOnto(from: HTMLElement, over: HTMLElement, half: 'top' | 'bottom') {
  over.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0, x: 0, y: 100, toJSON: () => ({}) })
  const dataTransfer = { setData: () => {}, setDragImage: () => {}, effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(from, { dataTransfer })
  // jsdom has no DragEvent, so the pointer's height is set on the event by hand.
  const dragOver = createEvent.dragOver(over, { dataTransfer })
  Object.defineProperty(dragOver, 'clientY', { value: half === 'top' ? 105 : 135 })
  fireEvent(over, dragOver)
  fireEvent.drop(over, { dataTransfer })
}

beforeEach(() => {
  hook.state = { files: [PLAN, BUG, DOC] }
  for (const fn of [hook.setListed, hook.move, hook.setLook, hook.putBack]) {
    fn.mockReset()
    fn.mockResolvedValue({ ok: true })
  }
  hook.choices = []
})

describe('TopicFiles', () => {
  it('draws the files in the order read, each as the look chosen, else as its own app draws it: an issue a row, a project a card', () => {
    hook.state = { files: [entry('doc', 30842, 'Doc', { listed: { look: 'row' } }), BUG, PLAN] }
    render(<TopicFiles />)

    expect(drawn().map((el) => el.dataset.topicFile)).toEqual([`30842:${AUTHOR}:doc`, `30851:${AUTHOR}:bug`, `30850:${AUTHOR}:plan`])
    expect(drawn().map((el) => el.querySelector('[data-uri]')?.getAttribute('data-testid'))).toEqual(['row', 'row', 'card'])
  })

  it('heads the files with “Files” and no count', () => {
    render(<TopicFiles />)
    const heading = screen.getByText('Files').parentElement!
    expect(heading.textContent).not.toMatch(/\d/)
  })

  it('a drop on the top half of the first file moves the dragged one first', () => {
    render(<TopicFiles />)
    const [plan, , doc] = drawn()
    dragOnto(doc, plan, 'top')
    expect(hook.move).toHaveBeenCalledWith('doc', null)
  })

  it('a drop on the bottom half of a file moves the dragged one just after it', () => {
    render(<TopicFiles />)
    const [plan, bug] = drawn()
    dragOnto(plan, bug, 'bottom')
    expect(hook.move).toHaveBeenCalledWith('plan', 'bug')
  })

  it('a drop where the file already is moves nothing', () => {
    render(<TopicFiles />)
    const [plan, bug] = drawn()
    dragOnto(bug, bug, 'top')
    dragOnto(bug, plan, 'bottom')
    expect(hook.move).not.toHaveBeenCalled()
  })

  it('says so when a move does not save', async () => {
    hook.move.mockResolvedValue({ ok: false, reason: 'Couldn’t move the file. It’s back where it was.' })
    render(<TopicFiles />)
    const [plan, , doc] = drawn()
    dragOnto(doc, plan, 'top')
    expect((await screen.findAllByText('Couldn’t move the file. It’s back where it was.')).length).toBeGreaterThan(0)
  })

  it('“…” shows a card as a row, and the look in use asks for nothing', async () => {
    const user = userEvent.setup()
    render(<TopicFiles />)
    await user.click(screen.getByRole('button', { name: 'More options for Plan' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Row' }))
    expect(hook.setLook).toHaveBeenCalledWith('plan', 'row')

    await user.click(screen.getByRole('button', { name: 'More options for Plan' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Card' }))
    expect(hook.setLook).toHaveBeenCalledTimes(1)
  })

  it('“…” Remove takes the file off, and Undo puts it back after the file it followed, with its place and look', async () => {
    const user = userEvent.setup()
    render(<TopicFiles />)
    await user.click(screen.getByRole('button', { name: 'More options for Bug' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    expect(hook.setListed).toHaveBeenCalledWith('bug', false)

    const toast = await screen.findByText('Removed “Bug”')
    await act(async () => {
      fireEvent.click(within(toast.closest('[role]') ?? document.body).getByRole('button', { name: 'Undo' }))
    })
    expect(hook.putBack).toHaveBeenCalledWith(BUG.listed, 'plan')
  })

  it('Undo of the first file puts it back first', async () => {
    const user = userEvent.setup()
    render(<TopicFiles />)
    await user.click(screen.getByRole('button', { name: 'More options for Plan' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    const toast = await screen.findByText('Removed “Plan”')
    await act(async () => {
      fireEvent.click(within(toast.closest('[role]') ?? document.body).getByRole('button', { name: 'Undo' }))
    })
    expect(hook.putBack).toHaveBeenCalledWith(PLAN.listed, null)
  })

  it('Add file lists the picked file by its id, not its whole address — what the entry names', async () => {
    hook.choices = [{ id: `30851:${AUTHOR}:issue-d`, title: 'Live widget', kind: 30851 }]
    render(<TopicFiles />)

    fireEvent.click(screen.getByRole('button', { name: 'Add file' }))
    fireEvent.click(await screen.findByText('Live widget'))
    expect(hook.setListed).toHaveBeenCalledWith('issue-d', true)
  })

  for (const [why, props] of [
    ['on an archived topic', { readOnly: true }],
    ['for someone who cannot add a file here', { mayChange: false }],
  ] as const) {
    it(`draws the files with no Add file, no “…” and no drag ${why}`, () => {
      render(<TopicFiles {...props} />)

      expect(drawn()).toHaveLength(3)
      expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
      expect(screen.queryByRole('button', { name: /^More options/ })).toBeNull()
      expect(drawn().every((el) => el.getAttribute('draggable') !== 'true')).toBe(true)
      const [plan, , doc] = drawn()
      dragOnto(doc, plan, 'top')
      expect(hook.move).not.toHaveBeenCalled()
    })
  }

  it('puts the archived files at the end behind one closed “Archived · n” line, with no “…” and no drag (TOPI-10)', () => {
    hook.state = { files: [entry('bug', 30851, 'Bug', { archived: true }), { ...PLAN, archived: false }, entry('doc', 30842, 'Doc', { archived: true })] }
    render(<TopicFiles />)

    const line = screen.getByRole('button', { name: /Archived · 2/ })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(drawn()).toHaveLength(1)
    fireEvent.click(line)
    expect(drawn()).toHaveLength(3)
    // Only the live one is arranged: an archived file is read-only.
    expect(screen.getAllByRole('button', { name: /^More options/ })).toHaveLength(1)
    expect(drawn().filter((el) => el.getAttribute('draggable') === 'true')).toHaveLength(1)
  })

  it('draws no Archived line when nothing listed is archived', () => {
    render(<TopicFiles />)
    expect(screen.queryByRole('button', { name: /Archived/ })).toBeNull()
  })

  it('says so when the topic lists nothing, and when the read failed — never an empty list for a refused read', () => {
    hook.state = { files: [] }
    const { rerender } = render(<TopicFiles />)
    expect(screen.getByText(/^None yet\./)).toBeTruthy()

    hook.state = { failed: true }
    rerender(<TopicFiles />)
    expect(screen.queryByText(/^None yet\./)).toBeNull()
    expect(screen.getByText(/Couldn’t load the files/)).toBeTruthy()
  })
})
