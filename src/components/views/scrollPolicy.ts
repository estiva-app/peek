/**
 * Where a conversation sits when you arrive, and when Peek may move it.
 *
 * Shared by `useTopicView` and `useDmConversationView` on purpose: a DM and a
 * topic reading differently, because they happen to be different components,
 * is exactly the kind of divergence worth spending a module to prevent.
 */

/**
 * How close to the bottom still counts as "at the bottom".
 *
 * Not zero. `scrollHeight - scrollTop - clientHeight` is rarely exactly zero —
 * display scaling, browser zoom and fractional device pixel ratios routinely
 * leave a fraction of a pixel while you are looking squarely at the last
 * message. A strict check would make following work on one machine and not
 * another, which is a worse bug than the one it fixes and far harder to see.
 *
 * 80px is roughly one message, so glancing up at the line above still counts as
 * watching the conversation. Tighten it if that reads as too eager.
 */
export const NEAR_BOTTOM_PX = 80

/** Whether the viewport is close enough to the bottom to follow new messages. */
export function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
}
