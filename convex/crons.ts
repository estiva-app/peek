/**
 * Scheduled jobs — there are none.
 *
 * The relay read path used to run here, authenticating with a custodial key
 * borrowed from whichever Peek user happened to have one. Peek holds no keys
 * now, and Buzz refuses a non-member with `403 relay_membership_required`, so
 * background work has no identity that can see anything at all.
 *
 * Reads happen as the signed-in viewer (`nostr/sync:syncTopicAsViewer`), because
 * only they are a member of their own channels. The consequence worth knowing:
 * a topic syncs when someone opens it, not continuously.
 *
 * Kept as a file rather than deleted so the next person adding a cron finds this
 * reasoning instead of rediscovering the 403s.
 */
import { cronJobs } from 'convex/server'

export default cronJobs()
