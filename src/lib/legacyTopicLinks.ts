/**
 * Where an old Convex topic link lands now — FOL-26.
 *
 * The Topics view is retired: every topic's conversation is on a file (CON-7's
 * census reads 0), so an old link opens that file instead of a view that reads
 * Convex. **The table is fixed and shipped in the bundle**, not looked up,
 * because the lookup it replaces was Convex's `topics.list` — and a redirect
 * that needs the service being removed would stop working the day it goes.
 *
 * Read from production by `scripts/fol26-topic-links.ts` on 2026-09-23, which
 * resolves each topic the way `shr8-migrate.ts` chose where its messages went:
 * the `30840` in a team whose title is the Convex title (CON-4), or else the
 * Ship project that lives in the topic's channel (CON-12). *For testing* was
 * discarded (CON-4, `scripts/con4-discarded.ts`) and has no file, so its link
 * lands on its team, Peek (FOL-25's triage).
 *
 * The shapes an old link came in, all answered here:
 *
 *   - `/topics/<id>`: the Convex `seedKey`, the only thing the oldest links carry.
 *   - `/topic-old/<slug>-<channel uuid>`: the canonical one since FOL-37.
 *   - `/topic/<slug>-<channel uuid>`: the same, from before FOL-37 moved it.
 *   - `39000:<pubkey>:<uuid>`: a channel's address, which is a topic's when
 *     the uuid is here and a Folder's otherwise (a team, since FOL-35 is
 *     deferred to Teams).
 */
import { filePath, identifierFromRef } from './objectUrl'

type LegacyTopic = {
  /** Convex `seedKey`, what `/topics/<id>` carried. */
  id: string
  /** The topic's NIP-29 channel uuid, what `/topic-old/` and `39000:` carry. */
  channel: string
  title: string
} & ({ file: string } | { team: string })

const PEEK_TEAM = 'fd03975a-eb00-49d6-a4b7-33ead1854672'

export const LEGACY_TOPICS: readonly LegacyTopic[] = [
  { id: 't_1784281236354_2', channel: '1ff7431b-f8cb-4fe5-a5f5-74a0cba2a652', title: 'Scenarios to demonstrate Nostr for Business', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:2279ce00-3467-4760-8c3c-2e9ca5ebdddf' },
  { id: 't_1784295402343_1', channel: '9d925c7e-9888-4b43-9317-5c48bfa23bcf', title: 'Pitch for Nostr for Business', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:ff2e41d1-7b9a-493a-bb80-93d70ac42548' },
  { id: 't_1784319879432_1', channel: '0e7cb6cd-0d80-4722-91a7-e0493b3bfb2d', title: 'Interesting Claude-generated docs - Renamed 4', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:43d280f9-da3e-4b94-a28f-6a3ee6d2e1ec' },
  { id: 't_1784707325273_1', channel: 'a4a7ace7-e97e-4570-bf99-3c7390088c39', title: 'Alternatives to Estiva / Peek', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:d2576ffc-c25f-4e22-a45e-a005bab4b7d7' },
  { id: 't_1784708243871_2', channel: '2303e8c1-c866-43b8-9b4c-e263f313a683', title: 'Feedback on Peek', file: '30850:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:2a5b8f13-0364-4a84-bdd4-fc0a6ddc259c' },
  { id: 't_1784901945304_1', channel: 'fde0b1f0-aae8-4531-8663-cbbb6ba1db92', title: 'Researching using Buzz "backend" to power Peek', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:303fc255-933e-4345-827e-e9e85e8f6a05' },
  { id: 't_1785329875099_1', channel: '2b69217e-866c-49c5-b16a-8f818ee4b792', title: 'Peek vision - initial notes', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:c1006cfb-d919-4516-8dcd-5f0d20ed49ea' },
  { id: 't_1785399904324_1', channel: '62efeded-b602-4e26-a4ef-5ff598cf4b14', title: 'Domain name - brainstorming', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:1483eaa7-4f1e-42d8-8a0d-18d86a77393a' },
  { id: 't_1786905890359_1', channel: 'a5f99f8b-d480-4439-8e3c-8fa915422809', title: 'Estiva Suits Updates', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:ccd28557-01ad-4546-a3b5-4705f4379ba7' },
  { id: 't_1786981698903_1', channel: '925897ad-796e-4bc6-999c-ca19df26c4aa', title: 'Claude on Estiva / Estiva Steer', file: '30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:f3652427-fcf5-4777-86a2-1dd4ee1f3808' },
  { id: 't_1787038103126_1', channel: 'e83471a7-cd98-4a62-ac5a-f21e0daedd24', title: 'Folders: Universal navigation concept', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:620929ad-2985-479b-a4b3-5d5d9cae9705' },
  { id: 't_1787062092089_1', channel: '95a9c7aa-33f4-4a28-8194-aaa8c7545439', title: 'Planning and sequencing', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:fd4257be-1ace-4710-9284-c620507c3278' },
  { id: 't_1787126730292_1', channel: 'ed625b4c-acb8-4bf5-866b-7a233c0a91f9', title: 'Local & AI development', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:d78a69d7-9e90-4d74-bce9-ff19112ce698' },
  { id: 't_1787133675660_1', channel: '9c69f247-be6a-4ae7-9703-71cb971f5f93', title: "Project: Peek's Intelligence", file: '30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:a39cafac-2b41-407b-860c-9761ded55a49' },
  { id: 't_1787426641532_1', channel: '2a059a2a-b1db-468b-8c5a-d75a7018c233', title: 'Project: DMs on Nostr (DM channels)', file: '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:7fc3c6f6-dc20-4e81-9894-a8123da53336' },
  { id: 't_1787426696970_2', channel: '1a0163b1-8bbd-4b23-8de4-04045f66eb36', title: 'Project: Cross-app read state', file: '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:62ad18f8-22bc-4a1f-a37a-f9a275d48d14' },
  { id: 't_1787430031846_1', channel: '24f5c271-3ed4-47f7-92e4-e9d6cf7f42d1', title: 'Project: Shared foundation packages', file: '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:8ef94f49-a095-4e61-9185-e506fd9b4fc1' },
  { id: 't_1787434193796_1', channel: 'b6dff859-d3c4-45d9-b8a1-84b171f3dd69', title: 'Project: Rewrite Ship with shared foundation', file: '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:732b746e-2d6a-4509-892d-d214c2acc4e2' },
  { id: 't_1787567929319_1', channel: '8eb734fa-6bf7-432a-9264-d85dfc98a797', title: 'Project: Catch up the Buzz fork', file: '30850:f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1:5b2701f3-da02-47f1-9ff5-14bdfb1dd822' },
  { id: 't_1788349562147_2', channel: '0542e0c9-7ee3-4d97-996e-1ae74a150ca9', title: 'Conversation across apps', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:de0f339b-f24e-4d3c-8932-459a11fc9f71' },
  { id: 't_1788464201556_1', channel: '3789d2ca-103c-40e5-906f-0490782db5fd', title: 'For testing', team: PEEK_TEAM },
  { id: 't_1788532283888_1', channel: 'aae9a8fa-b85e-44a3-8683-cb236f90ea74', title: 'Widgets', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:7a384136-31a6-4d91-80ac-1d599464d2f2' },
  { id: 't_1788532667947_2', channel: 'f1cf4e98-f674-4c2b-9a5e-6a309a8aa9e5', title: 'Intelligence in Peek', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:be341c31-5103-49c5-99dd-3c6b282d74fb' },
  { id: 't_1788790771299_1', channel: '0212db6d-bcbf-40d0-890e-f4f056db2f5d', title: 'Feedback on Ship', file: '30850:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:cf23dbca-64fb-4802-a804-e0119b0d8584' },
  { id: 't_1789157300252_1', channel: '11283465-e214-46e9-b343-04211040947b', title: 'AI Tips', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:8a0c98be-c86c-4aa1-a8dd-0dd63f5c5499' },
  { id: 't_1789645147020_1', channel: '1773675f-0060-4932-b360-4be6cf3594ef', title: 'Leaf planning', file: '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:f91f86d6-d903-47a9-85c0-46ebb356eecb' },
]

const byChannel = new Map(LEGACY_TOPICS.map((t) => [t.channel, t]))
const byId = new Map(LEGACY_TOPICS.map((t) => [t.id, t]))

const destinationOf = (topic: LegacyTopic): string =>
  'file' in topic ? filePath(topic.file, topic.title) : `/app/folders/${topic.team}`

/** The topic a channel uuid belonged to, or undefined for any other channel. */
export function legacyTopicByChannel(channel: string): LegacyTopic | undefined {
  return byChannel.get(channel.toLowerCase())
}

/**
 * Where a channel lands: its topic's file when it was a topic's, and the
 * Folder it is otherwise — a `39000:` address, or a message's `h`.
 */
export function channelDestination(channel: string): string {
  const topic = legacyTopicByChannel(channel)
  return topic ? destinationOf(topic) : `/app/folders/${channel.toLowerCase()}`
}

/**
 * Where an old topic route's parameter lands, or null when it names nothing.
 *
 * A trailing uuid is a channel's, and a uuid this table does not hold is still
 * a channel — a team's, reached through a `39000:` reference — so it lands on
 * that Folder. Anything else is a `seedKey`, and one this table does not hold
 * was never a production topic.
 */
export function legacyTopicDestination(ref: string): string | null {
  const channel = identifierFromRef(ref)
  if (channel) return channelDestination(channel)
  const topic = byId.get(decodeURIComponent(ref))
  return topic ? destinationOf(topic) : null
}
