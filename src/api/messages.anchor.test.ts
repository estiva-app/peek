/**
 * The one hop in the anchor's path that typecheck cannot enforce.
 *
 * `nostrBlockId` is optional on `RemoteMessage` and on `ConversationData`, so
 * deleting `nostrBlockId: r.nostrBlockId` from the mapper compiles cleanly and
 * silently drops every anchor before it reaches a component.
 */
import { describe, expect, it } from 'vitest'
import { toConversationData, type RemoteMessage } from './messages'

describe('toConversationData carries the block anchor', () => {
  const row = {
    id: 'k1', authorId: 'u1', author: { id: 'u1', name: 'Maya' },
    body: 'this paragraph is out of date', createdAt: 1788451153829,
    nostrReferences: ['30851:cd:an-issue'], nostrBlockId: '64f3a61cd7e3',
  } as unknown as RemoteMessage

  it('passes it through', () => {
    expect(toConversationData(row, 'u2').nostrBlockId).toBe('64f3a61cd7e3')
  })

  it('leaves it absent when the comment has none', () => {
    const { nostrBlockId, ...without } = row as unknown as Record<string, unknown>
    void nostrBlockId
    expect(toConversationData(without as unknown as RemoteMessage, 'u2').nostrBlockId).toBeUndefined()
  })
})
