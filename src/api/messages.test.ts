/**
 * The author's face crossing the seam (PEEK-43).
 *
 * `Avatar` resolves `src ?? avatarSrcFor(name)`, so this mapping has to stay
 * *additive*: carry a server-resolved avatar when there is one, and leave the
 * field undefined when there is not, so the name-keyed demo portraits still win
 * for seeded rows. Getting that backwards would not fail loudly — it would
 * silently blank every mock portrait in Storybook and the demo dataset.
 */
import { describe, expect, it } from 'vitest'
import { toConversationData, type RemoteMessage } from './messages'

const base: RemoteMessage = {
  id: 'm1',
  authorId: 'u_stranger',
  authorName: 'linear-lite-7cc069',
  createdAt: 1_785_232_285_397,
  body: 'shipped the thing',
}

describe('toConversationData — author avatar', () => {
  it('carries a foreign author’s resolved avatar through as authorAvatarSrc', () => {
    // The case the ticket exists for: someone with no Peek account, whose only
    // face is the kind:0 `picture` the relay published.
    const conv = toConversationData({ ...base, authorAvatarUrl: 'https://cdn.test/face.png' }, 'u_me')
    expect(conv.authorAvatarSrc).toBe('https://cdn.test/face.png')
  })

  it('leaves authorAvatarSrc undefined when the server resolved no face', () => {
    // Not a cosmetic detail: Avatar falls through to the name-keyed portrait
    // here, which is what keeps the seeded demo dataset pixel-identical.
    expect(toConversationData(base, 'u_me').authorAvatarSrc).toBeUndefined()
  })

  it('still carries your own avatar when the row is yours', () => {
    // The viewer renders as 'You' by id, but the face should not disappear.
    const conv = toConversationData(
      { ...base, authorId: 'u_me', authorAvatarUrl: 'https://cdn.test/me.png' },
      'u_me',
    )
    expect(conv.authorName).toBe('You')
    expect(conv.authorAvatarSrc).toBe('https://cdn.test/me.png')
  })

  it('fills the reply facepile from the server, falling back per author', () => {
    const conv = toConversationData(
      {
        ...base,
        replyAuthors: [
          { id: 'u_stranger', name: 'linear-lite-7cc069', avatarUrl: 'https://cdn.test/face.png' },
          { id: 'u_seeded', name: 'Alice Johnson' },
        ],
      },
      'u_me',
    )
    expect(conv.replyAuthors).toEqual([
      { name: 'linear-lite-7cc069', avatarSrc: 'https://cdn.test/face.png' },
      { name: 'Alice Johnson', avatarSrc: undefined },
    ])
  })
})
