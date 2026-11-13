/**
 * A reaction to your message in a DM, from the relay to the People list's row (ACT-7): the tab's one source reads it
 * through Peek's real query path from the fake relay, the DM's row draws an orange dot and its card the line, and
 * leaving the card writes the DM channel's `reactions:<channel>` key, read back off the relay as the decrypted
 * `kind:30078` slot. The DM's own messages (the channel fold) are stood in for: nothing unread there. Real timers, as
 * the Topics column's card test: Base UI's hover card does not open under fake timers in jsdom; only Date is faked.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { REACTIONS_TO_ME_FROM } from '@estiva-app/conversation'
import { installWireRelay, ME, signed, type WireRelay } from '@/test/wireRelay'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
// No socket: the requests kept open are the reactions wire test's.
vi.mock('@/nostr/liveTopics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/liveTopics')>()),
  getLiveClient: () => null,
}))
vi.mock('@/nostr/relayInfo', () => ({ peekRelay: () => ({ info: async () => ({ supported_extensions: ['buzz-live-as-stored'] }) }) }))
// One DM, with Katerina, on its channel.
vi.mock('@/api/internal/dms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/internal/dms')>()),
  useDmChannels: () => ({ partners: ['b'.repeat(64)], channelOf: () => '0f1e2d3c-4b5a-4968-8776-655443322110' }),
}))
// The DM's own messages: nothing unread there, so the reaction is all that is new.
vi.mock('@/api/useTopicUnread', () => ({ useTopicUnread: () => ({ unread: {}, urgent: {}, news: {} }) }))
vi.mock('@/api/useFolderContents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/useFolderContents')>()),
  heldFolderIds: () => [],
}))
vi.mock('@/api/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/people')>()),
  useMentionNames: () => [{ pubkey: 'b'.repeat(64), name: 'Katerina' }],
}))

import { ReadStateSync, flushReadState, resetReadStateQueueForTests } from '@/nostr/useReadStateSync'
import { resetReactionsToMeForTests } from '@/api/useReactionsToMe'
import { useUnread } from '@/api/unread'
import { PeekSetup } from '@/lib/PeekSetup'
import { PersonItem } from '@/components/ui/PersonItem'

const KATERINA = 'b'.repeat(64)
const CHANNEL = '0f1e2d3c-4b5a-4968-8776-655443322110'
const NOW = REACTIONS_TO_ME_FROM + 24 * 60 * 60

const message = signed({ kind: 9, created_at: NOW - 3600, content: 'Sent the draft', tags: [['h', CHANNEL]] }, ME)
const thumbs = signed({ kind: 7, created_at: NOW - 60, content: '👍', tags: [['e', message.id], ['p', ME], ['k', '9'], ['h', CHANNEL]] }, KATERINA)

let relay: WireRelay
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW * 1000)
  relay = installWireRelay()
  resetReadStateQueueForTests()
  resetReactionsToMeForTests()
  window.localStorage.clear()
})
afterEach(() => vi.useRealTimers())
afterAll(() => vi.unstubAllGlobals())

/** Katerina's row in the People list, as the page draws it from `useUnread`. */
function KaterinaRow() {
  const { dmHasUnread, dmNews, dmTone } = useUnread()
  return <PersonItem id={KATERINA} name="Katerina" unread={dmHasUnread(KATERINA)} news={dmNews(KATERINA)} unreadTone={dmTone(KATERINA)} active={false} />
}

const dot = () => document.querySelector('[data-unread]')
const slots = () => relay.sentOf(30078)
const blobOf = (event: { content: string }) => JSON.parse(relay.decrypt(event.content)) as { contexts: Record<string, number> }

describe('a reaction to your message in a DM, on the People list (ACT-7)', () => {
  it('turns the DM’s row orange, its card names who reacted with what on which message, and leaving the card sees it in the DM’s channel', async () => {
    relay.seed(message, thumbs)
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/app/people']}>
        <PeekSetup>
          <ReadStateSync />
          <KaterinaRow />
        </PeekSetup>
      </MemoryRouter>,
    )
    await waitFor(() => expect(dot()?.getAttribute('data-tone')).toBe('reaction'))

    const row = screen.getByText('Katerina')
    await user.hover(row)
    const line = (await screen.findByText('reacted 👍 to your message')).closest('[data-reaction]')
    expect(line?.textContent).toContain('Katerina')
    expect(line?.textContent).toContain('Sent the draft')
    await act(() => flushReadState())
    expect(slots().filter((slot) => blobOf(slot).contexts[`reactions:${CHANNEL}`] !== undefined)).toHaveLength(0)

    await user.unhover(row)
    await user.hover(document.body)
    await waitFor(() => expect(dot()).toBeNull())
    await act(() => flushReadState())
    expect(blobOf(slots().at(-1)!).contexts[`reactions:${CHANNEL}`]).toBe(thumbs.created_at)
  })
})
