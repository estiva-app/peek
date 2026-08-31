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
