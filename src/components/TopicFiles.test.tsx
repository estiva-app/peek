/**
 * A topic's Files section (TOP-3): Add file on the heading and Remove on each
 * card, and neither on an archived topic, which is read-only in every app.
 *
 * The list's read and write are `useTopicFiles`'s, whose entries are asserted
 * at the wire in `nostr/topicFiles.test.ts`; here it is stubbed so the test is
 * about what the person can press. The card is stubbed to its ✕ alone, since
 * drawing it reads the relay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const hook = vi.hoisted(() => ({
  state: { files: [] as Array<{ file: string; address: string }> } as unknown,
  setListed: vi.fn(async () => ({ ok: true as const })),
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useTopicFiles: () => ({ state: hook.state, busy: new Set<string>(), setListed: hook.setListed }),
  fileChoices: () => [],
}))
vi.mock('@/components/ui/MessageLinks', () => ({
  MessageCard: ({ uri, onRemove }: { uri: string; onRemove?: () => void }) => (
    <div data-testid="card" data-uri={uri}>
      {onRemove && (
        <button type="button" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  ),
}))

import { ToastProvider } from '@/lib/toast'
import { TopicFiles as Section } from './TopicFiles'

const TopicFiles = (props: Parameters<typeof Section>[0]) => (
  <ToastProvider>
    <Section {...props} />
  </ToastProvider>
)

const AUTHOR = 'a'.repeat(64)
const TOPIC = `30840:${AUTHOR}:topic`
const PROJECT = `30850:${AUTHOR}:proj`

beforeEach(() => {
  hook.state = { files: [{ file: 'proj', address: PROJECT }] }
  hook.setListed.mockClear()
})

describe('TopicFiles', () => {
  it('shows each listed file as a card, with Add file and Remove on an open topic', () => {
    render(<TopicFiles topic={TOPIC} folder="f" title="Widgets" readOnly={false} />)

    expect(screen.getAllByTestId('card')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Add file' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(hook.setListed).toHaveBeenCalledWith('proj', false)
  })

  it('shows the cards with no Add file and no Remove on an archived topic', () => {
    render(<TopicFiles topic={TOPIC} folder="f" title="Widgets" readOnly />)

    expect(screen.getAllByTestId('card')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('says so when the topic lists nothing, and when the read failed — never an empty list for a refused read', () => {
    hook.state = { files: [] }
    const { rerender } = render(<TopicFiles topic={TOPIC} folder="f" title="Widgets" readOnly={false} />)
    expect(screen.getByText('None yet.')).toBeTruthy()

    hook.state = { failed: true }
    rerender(<TopicFiles topic={TOPIC} folder="f" title="Widgets" readOnly={false} />)
    expect(screen.queryByText('None yet.')).toBeNull()
    expect(screen.getByText(/Couldn’t load the files/)).toBeTruthy()
  })
})
