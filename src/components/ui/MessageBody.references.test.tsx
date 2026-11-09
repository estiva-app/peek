/**
 * A topic and a message mentioned in a body — RIC-11.
 *
 * The chip is the kit's; what this guards is the plumbing around it. An
 * `naddr` and an `nevent` written mid-sentence are handed to the resolver, and
 * the bracket form every older message carries is still drawn from the
 * fixture. And a message alone on its line is drawn as its row where it was
 * written (SPEC §13.2), rather than hidden from the prose and drawn by nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'

const RELAY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const TOPIC = `39000:${RELAY}:b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91`
const NADDR = `nostr:${addrToNaddr(TOPIC, [])}`
const EVENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const NEVENT = `nostr:${encodeNevent({ id: EVENT, relays: [], kind: 9 })}`

const asked: string[][] = []

vi.mock('@/api', () => ({
  // Whether a file that came back as nothing was deleted, and the links in a message's words: neither asked here.
  useDeleted: () => false,
  useLinksIn: () => {},
  TOPICS: [{ id: '7', title: 'Updates on the new office layout', isResolved: false }],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  useLinkResolver: () => () => undefined,
  useResolvedReferences: (refs: string[]) => {
    asked.push(refs)
    return Object.fromEntries(
      refs.map((ref) => [
        ref,
        ref === NADDR
          ? { ref: TOPIC, eventId: 'e'.repeat(64), kind: 39000, widget: 'card', slots: { title: { value: 'Office layout (renamed)' } }, meta: [], comments: [], actions: [], viaRecommendation: true }
          : null,
      ]),
    )
  },
  // A row's comment count, which these rows do not look at.
  useConversationBadges: () => ({ counts: {}, unread: {} }),
}))
vi.mock('@/api/mentions', () => ({
  personByPubkey: () => undefined,
  subscribeMentions: () => () => {},
  mentionsVersion: () => 0,
}))

import { MessageBody } from './MessageBody'

const show = (body: string) =>
  render(<MessageBody body={body} />).container

describe('a topic or a message in a message body', () => {
  it('draws a topic address as the title the topic has now', () => {
    const c = show(`see ${NADDR} for the plan`)
    expect(asked.at(-1)).toContain(NADDR)
    expect(c.textContent).toContain('Office layout (renamed)')
    expect(c.textContent).not.toContain('naddr1')
  })

  it('asks the resolver about a message pointer written mid-sentence', () => {
    const c = show(`as ${NEVENT} said`)
    expect(asked.at(-1)).toContain(NEVENT)
    // Resolved to nothing here; still a chip, saying so, and never a 60-character pointer.
    // Changed on purpose: kit 0.103.0 (a chip says what a row and a card say): "You can't open this message", not
    // "Message not available".
    expect(c.textContent).toContain("as You can't open this message said")
    expect(c.querySelector('[data-link-row]')).toBeNull()
    expect(c.textContent).not.toContain(NEVENT)
  })

  it('draws a message that stands alone on its line as its row, rather than losing it', () => {
    const c = show(`Look at this.\n\n${NEVENT}`)
    expect(asked.at(-1)).toContain(NEVENT)
    expect(c.textContent).toContain('Look at this.')
    // Changed on purpose: kit 0.102.0 (ALO-4): "You can't open this message", not "Message not available".
    expect(c.querySelector('[data-link-row]')?.textContent).toBe("You can't open this message")
    expect(c.textContent).not.toContain(NEVENT.replace(/^nostr:/, ''))
  })

  it('still draws the old bracket form from the fixture, for ever', () => {
    const c = show('as discussed in [Updates on the new office layout]')
    expect(c.textContent).toContain('Updates on the new office layout')
    expect(c.textContent).not.toContain('[')
  })
})

// ONE-11 (Miky, 2026-11-09): Ship ended every issue comment with a line linking its own issue, which Peek drew as a row.
describe('a comment’s line that only links the file it is on', () => {
  const ISSUE = `30851:${RELAY}:5e783319-e6f4-4436-9f4c-5310ce37074d`
  const ISSUE_NADDR = `nostr:${addrToNaddr(ISSUE, [])}`
  const onIssue = (body: string, ownFile: string[] = [ISSUE]) => render(<MessageBody body={body} ownFile={ownFile} here={ISSUE} />).container

  it('draws nothing, leaving the comment’s words', () => {
    const c = onIssue(`Looks right.\n\n${ISSUE_NADDR}`)
    expect(c.textContent).toBe('Looks right.')
  })

  it('still draws a link alone on its line to another file, as its row', () => {
    const c = render(<MessageBody body={`Looks right.\n\n${ISSUE_NADDR}`} ownFile={[`30851:${RELAY}:another-issue`]} />).container
    expect(c.querySelector('[data-link-row]')?.textContent).toBe("You can't open this issue")
  })

  it('draws the link when the comment has no other words', () => {
    const c = onIssue(ISSUE_NADDR)
    expect(c.textContent).toBe("You can't open this issue")
  })
})
