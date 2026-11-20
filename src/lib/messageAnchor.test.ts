// @vitest-environment node
/**
 * A wait for a message to be drawn gives up when the page is gone, as it does
 * at its deadline, instead of throwing from its timer. A Desk test that opened
 * a message ended inside the 10 s wait and its next attempt threw "document is
 * not defined" after the page was torn down, failing peek#677's CI run.
 */
import { describe, expect, it } from 'vitest'
import { scrollToEventWhenReady, showConversationItemWhenDrawn } from './messageAnchor'

describe('a wait for a message on a page that is gone', () => {
  it('showing a conversation item gives up with false', async () => {
    await expect(showConversationItemWhenDrawn('a-comment', 200)).resolves.toBe(false)
  })

  it('showing a reply found by search gives up with false', async () => {
    await expect(scrollToEventWhenReady('e'.repeat(64), 200)).resolves.toBe(false)
  })
})
