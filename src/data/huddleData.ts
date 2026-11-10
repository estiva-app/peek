import type { ConversationData } from './topicData'

export interface Huddle {
  id: string
  topicId: string
  members: string[]           // author names (matches ConversationData.authorName)
  state: 'active' | 'resolved'
  lastActivity: string        // display timestamp
  /** Numeric last-activity time (ms). Convex-provided; static mocks don't
   *  carry it. Drives date interleaving in the V3 unified topic stream. */
  lastActivityMs?: number
  /** The opening message - same shape as a conversation. Used as the card preview.
   *  Optional: huddles started via the V2 dialog (members-only, no first message) have no seed. */
  conversation?: ConversationData
  /** Top-level messages posted inside the huddle after the seed. Drives the V2 huddle main-view body.
   *  Empty/undefined → empty huddle (just compose box). */
  extraConvs?: ConversationData[]
  /** When set, this huddle was promoted from a DM — the partner's person key (§2.4). */
  originDmId?: string
  /** Display timestamp for when the DM was promoted into this huddle. Used to render the "Started topic" divider. */
  promotedAt?: string
  /** Numeric promotion time (ms since epoch). Drives chronological partitioning of replies around the divider. */
  promotedAtMs?: number
  /** The DM message id that was used as the seed when starting the topic. The huddle anchor renders above this specific message. */
  seedMessageId?: string
}

/**
 * Mock Huddle data keyed by topicId.
 * Each topic can have zero or more Huddles.
 */
export const TOPIC_HUDDLES: Record<string, Huddle[]> = {

  // Topic 1: CI/CD pipeline stuck during build stage
  '1': [
    {
      id: 'h1_1',
      topicId: '1',
      members: ['You', 'Daniel Stanton', 'Juan Foley'],
      state: 'resolved',
      lastActivity: 'Mon, September 2',
      conversation: {
        id: 'h1_1_c1',
        authorName: 'Daniel Stanton',
        timestamp: '9:40 AM',
        body: "Liam, before I post to the main thread I want to double-check something. The dep conflict looks like it's @testing-library/react 15.x but I'm also seeing a transitive resolution issue with jest-dom.\n\nCan you confirm which lockfile you're seeing the mismatch in? I don't want to pin the wrong package.",
        replyCount: 3,
        isResolved: true,
        resolvedBy: 'Daniel Stanton',
        resolutionMessage: 'Confirmed it was only @testing-library/react. Pinned to 14.x.',
      },
    },
  ],

  // Topic 2: Launch checklist for v2 of the mobile app
  '2': [
    {
      id: 'h2_1',
      topicId: '2',
      members: ['You', 'Hallie Pratt', 'Greg Bothman'],
      state: 'resolved',
      lastActivity: 'Thu, August 29',
      conversation: {
        id: 'h2_1_c1',
        authorName: 'Hallie Pratt',
        timestamp: '9:30 AM',
        body: "Carlos, the EU push notification issue is more complex than I initially thought. The Frankfurt SNS endpoint is configured correctly but the topic ARN has a region mismatch.\n\nI want to align with you before escalating to the backend team. Can we walk through the AWS config together?",
        replyCount: 5,
      },
    },
    {
      id: 'h2_2',
      topicId: '2',
      members: ['You', 'Hallie Pratt', 'Zack Bright'],
      state: 'active',
      lastActivity: 'Fri, August 30',
      conversation: {
        id: 'h2_2_c1',
        authorName: 'Zack Bright',
        timestamp: '10:15 AM',
        body: "Nina, quick flag before the build goes to App Store review. The Face ID fix I shipped works on iOS 16.1 but I haven't been able to test on 16.0.\n\nDo we have a 16.0 device in the office or should I spin up a simulator? Don't want to risk a rejection.",
        replyCount: 2,
      },
    },
  ],

  // Topic 3: Ongoing onboarding issues
  '3': [
    {
      id: 'h3_1',
      topicId: '3',
      members: ['You', 'Greg Bothman', 'Amie Miles'],
      state: 'active',
      lastActivity: 'Today',
      conversation: {
        id: 'h3_1_c1',
        authorName: 'Greg Bothman',
        timestamp: '10:00 AM',
        body: "I need to think through the liveness check alternatives before proposing anything to the team.\n\nThe current SDK (3.1.0) has known issues with low-light face detection and unclear error states. SDK 3.4.2 fixes most of this but I want to explore whether there are other options worth considering.\n\nWhat are the main approaches to liveness verification in mobile onboarding flows?",
        replyCount: 4,
      },
      // Two extra messages — different scope from the topic's main convs.
      extraConvs: [
        {
          id: 'h3_1_e1',
          authorName: 'Amie Miles',
          timestamp: '11:42 AM',
          body: "Quick aside before we loop the team in — should we benchmark Onfido against the SDK 3.4.2 numbers? I have last quarter's pilot data sitting in a Notion page.",
          replyCount: 2,
        },
        {
          id: 'h3_1_e2',
          authorName: 'You',
          timestamp: '12:15 PM',
          body: "Yes please. If the Onfido numbers are within 5% of 3.4.2, the upgrade case writes itself. Drop the link here when you have a sec.",
          replyCount: 0,
        },
      ],
    },
    {
      id: 'h3_2',
      topicId: '3',
      members: ['You', 'Greg Bothman', 'Alice Johnson'],
      state: 'active',
      lastActivity: 'Today',
      conversation: {
        id: 'h3_2_c1',
        authorName: 'Greg Bothman',
        timestamp: '11:30 AM',
        body: "Alice, before we share the UX spec with the wider group I want to align on the guidance screen approach.\n\nYou mentioned Option A (static illustrations) and Option B (looping animation). I'm leaning A but want to hear your perspective on whether the animation could actually help users position their face correctly.",
        replyCount: 6,
      },
      // One extra message — a private aside before publishing the decision back to the topic.
      extraConvs: [
        {
          id: 'h3_2_e1',
          authorName: 'Alice Johnson',
          timestamp: '2:05 PM',
          body: "Re-tested with three users on the looping animation prototype this morning — two of them treated the loop as 'still loading' and waited. Strong signal for Option A.",
          replyCount: 1,
        },
      ],
    },
  ],

  // Topic 9: Feedback on mobile onboarding flow
  '9': [
    {
      id: 'h9_1',
      topicId: '9',
      members: ['You', 'Alice Johnson', 'Jake Walter'],
      state: 'active',
      lastActivity: 'Wed, September 4',
      conversation: {
        id: 'h9_1_c1',
        authorName: 'Alice Johnson',
        timestamp: '11:30 AM',
        body: "Jake, I want to get your take on the 'You\'re all set' screen before I finalize the mockups. The current version is a dead end with no CTA.\n\nI'm considering two options:\n- Primary 'Go to dashboard' button with a secondary 'Take a tour'\n- Single 'Continue' that leads to a contextual onboarding overlay\n\nWhich feels more aligned with how users actually behave after onboarding?",
        replyCount: 3,
      },
    },
    // Empty huddle (just members, no seed message). Demonstrates the "newly created via dialog" state.
    {
      id: 'h9_2',
      topicId: '9',
      members: ['You', 'Carlos Rivera'],
      state: 'active',
      lastActivity: 'Today',
    },
  ],

  // Topic 5: an empty huddle in a topic that has no other huddles
  '5': [
    {
      id: 'h5_1',
      topicId: '5',
      members: ['You', 'Maya Patel', 'Daniel Stanton'],
      state: 'active',
      lastActivity: 'Today',
    },
  ],
}

/** Find the huddle that was promoted from the given DM, if any. */
export function getHuddleByOriginDm(dmId: string): Huddle | undefined {
  for (const huddles of Object.values(TOPIC_HUDDLES)) {
    const match = huddles.find((h) => h.originDmId === dmId)
    if (match) return match
  }
  return undefined
}

/** Find the DM-origin huddle for a given topic (the one that seeded the topic), if any. */
export function getOriginHuddleForTopic(topicId: string): Huddle | undefined {
  return TOPIC_HUDDLES[topicId]?.find((h) => h.originDmId !== undefined)
}
