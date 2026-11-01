/**
 * An agent's face (Katerina, 1 November): the kit's robot where a person's initials would be, on Peek's message and
 * reply cards and in the faces of the replies row. The profile says it is an agent (NIP-24 `bot`), never its name: a
 * person whose name reads like an agent's keeps their initials.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'
import { ReplyCard } from './ReplyCard'

const AGENT = 'Claude (steered by Katerina Kelepouri)'

function draw(node: React.ReactElement) {
  return render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>{node}</PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  ).container
}

/** The kit's robot is one drawing (Remix's robot-2-fill); this is the start of its path. */
const robots = (container: HTMLElement) => container.querySelectorAll('svg path[d^="M13.5 2C13.5 2.44425"]').length

describe('an agent on a message card', () => {
  it('is the robot', () => {
    const c = draw(<ConversationCard authorName={AGENT} authorBot timestamp="11:08 AM" body="Done." />)
    expect(robots(c)).toBe(1)
  })

  it('a person with an agent-like name is no robot', () => {
    const c = draw(<ConversationCard authorName={AGENT} timestamp="11:08 AM" body="Done." />)
    expect(robots(c)).toBe(0)
  })

  it('is the robot among the replies row faces', () => {
    const c = draw(
      <ConversationCard
        authorName="Ana Duarte"
        timestamp="11:08 AM"
        body="Who checks this?"
        replyCount={2}
        replyAuthors={[{ name: 'Ana Duarte' }, { name: AGENT, bot: true }]}
        lastReplyTime="11:20 AM"
      />,
    )
    expect(robots(c)).toBe(1)
  })
})

describe('an agent on a reply card', () => {
  it('is the robot', () => {
    const c = draw(<ReplyCard authorName={AGENT} authorBot timestamp="11:08 AM" body="Done." />)
    expect(robots(c)).toBe(1)
  })
})
