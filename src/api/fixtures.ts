/**
 * Sample data for Storybook stories ONLY.
 *
 * Stories need realistic args without reaching into '@/data/*' directly
 * (the Phase 1 exit criterion bans mock imports from components, and
 * stories live there). Nothing in the app runtime may import this module.
 */
export { TOPIC_HUDDLES } from '@/data/huddleData'
export { SCREENER_ITEMS } from '@/data/screenerData'
export { TOPICS, TOPIC_CONVERSATIONS } from '@/data/topicData'
export { REPLIES } from '@/data/replyData'

/**
 * Not invented, unlike everything above it: one real Ship issue, resolved from
 * 1,074 recorded production events through Peek's own `resolveObjectAsViewer`.
 * It is here so no story reaches into '@/data/*' by hand (UIG-17), and because
 * a recording is the one fixture that cannot drift from what the relay sends.
 */
export { default as RECORDED_SHIP_ISSUE } from '@/data/recordedShipIssue.json'
