import type { ConvGroup } from './topicData'

export const DM_CONVERSATIONS: Record<number, ConvGroup[]> = {

  // Alice Johnson (unread)
  1: [
    {
      dateLabel: 'Mon, August 26',
      convs: [
        {
          id: 'dm1_c1',
          authorName: 'Alice Johnson',
          timestamp: '9:45 AM',
          body: "Have you had a chance to look at Zendesk ticket #48821 that I flagged last week?\n\nThe customer is escalating and our SLA window closes tomorrow EOD. We need to give them something concrete.",
        },
        {
          id: 'dm1_c2',
          authorName: 'Alice Johnson',
          timestamp: '2:10 PM',
          body: "Separate issue worth flagging: the onboarding drop-off spike this week looks concentrated in the EU region specifically.\n\nI checked the Mixpanel funnel by geography and EU completions dropped 28% in 5 days while everywhere else held flat. Might be worth ruling out a regional infra issue before we assume it's a UX problem.",
        },
        {
          id: 'dm1_c3',
          authorName: 'You',
          timestamp: '3:30 PM',
          body: "Checked the error logs for EU-West-1. There's a noticeable uptick in 503s from the identity verification service between 9am and 11am CET.\n\nLooks like a capacity issue during peak hours rather than anything in the product flow. I'll share the log link so you can include it in the incident note.",
          reactions: [{ emoji: '👍', count: 1, owner: 'others' }],
          replyCount: 2,
        },
      ],
    },
    {
      dateLabel: 'Yesterday',
      convs: [
        {
          id: 'dm1_c4',
          authorName: 'You',
          timestamp: '10:05 AM',
          body: "Rate limiting fix from last week is now live in production, build #5102.\n\nExponential backoff is working as expected in the monitoring data, no more 429 loops showing up. Zendesk ticket #48821 can be closed on your end.",
          replyCount: 1,
        },
        {
          id: 'dm1_c5',
          authorName: 'You',
          timestamp: '1:45 PM',
          body: "One thing worth raising in the 2pm design review: the current export design assumes synchronous generation, but for datasets over 10k rows that's going to be a problem.\n\nWe'll need either a job queue with a download link or pagination on the export endpoint. I'll bring both options written up so we can decide in the room.",
          replyCount: 3,
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 'dm1_c6',
          authorName: 'Alice Johnson',
          timestamp: '9:10 AM',
          body: "Morning! The design team incorporated your async export feedback from yesterday, they're now going with the job queue approach. They've got a draft of the loading state and download-ready notification in Figma if you want to take a look before it goes to eng.\n\nAlso the customer on ticket #48821 confirmed the rate limiting fix resolved their issue. Closing it out now.",
          hasNewMessage: true,
        },
      ],
    },
  ],

  // Daniel Stanton
  2: [
    {
      dateLabel: 'Wed, August 21',
      convs: [
        {
          id: 'dm2_c1',
          authorName: 'Daniel Stanton',
          timestamp: '10:15 AM',
          body: "Hey, quick one. I'm putting together the Q3 board deck and need the key product metrics by Monday morning.\n\nSpecifically: MAU, DAU, 30-day retention rate, and trial-to-paid conversion if you can get it.",
        },
        {
          id: 'dm2_c2',
          authorName: 'Daniel Stanton',
          timestamp: '3:05 PM',
          body: "One more thing while I have you: do we have any data on feature adoption for the new dashboard?\n\nI'd like to show the board that users are actually engaging with it, not just logging in. Even a rough weekly active users breakdown for that feature would do it.",
        },
      ],
    },
    {
      dateLabel: 'Fri, August 23',
      convs: [
        {
          id: 'dm2_c3',
          authorName: 'You',
          timestamp: '4:30 PM',
          body: "Metrics doc is ready and shared in Notion. Highlights:\n\n- MAU is up 12% QoQ\n- 30-day retention at 68% overall (organic acquisition running 14 points above paid)\n- Trial-to-paid conversion at 23%, slightly below last quarter but absolute numbers are higher\n- Dashboard feature adoption at 41% of MAUs in first 30 days\n\nLet me know if you need any numbers reframed for the board context.",
          reactions: [{ emoji: '🙏', count: 1, owner: 'others' }, { emoji: '💯', count: 1, owner: 'others' }],
          replyCount: 1,
        },
      ],
    },
    {
      dateLabel: 'Mon, August 26',
      convs: [
        {
          id: 'dm2_c4',
          authorName: 'Daniel Stanton',
          timestamp: '9:00 AM',
          body: "Board presentation went well. The retention segmentation landed really well and a couple of board members asked follow-up questions specifically about the paid acquisition underperformance.\n\nWe're now running a proper attribution review in Q4 as a result. Good data drives good decisions.",
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 'dm2_c5',
          authorName: 'Daniel Stanton',
          timestamp: '8:42 AM',
          body: "Need your sign-off on the Q4 attribution methodology by 11am - exec review is at noon and they'll push back hard if we can't defend the paid-vs-organic split.\n\nDoc is in Notion under 'Q4 Attribution v2'. Flagging this as urgent because the slot won't move.",
          hasNewMessage: true,
          isUrgent: true,
        },
      ],
    },
  ],

  // Greg Bothman
  4: [
    {
      dateLabel: 'Mon, August 26',
      convs: [
        {
          id: 'dm4_c1',
          authorName: 'Greg Bothman',
          timestamp: '9:45 AM',
          body: "Have you had a chance to look at Zendesk ticket #48821 that I flagged last week?\n\nThe customer is escalating and our SLA window closes tomorrow EOD. We need to give them something concrete.",
        },
        {
          id: 'dm4_c2',
          authorName: 'Greg Bothman',
          timestamp: '3:30 PM',
          body: "Separate issue worth flagging: the onboarding drop-off spike this week looks concentrated in the EU region specifically.\n\nI checked the Mixpanel funnel by geography and EU completions dropped 28% in 5 days while everywhere else held flat. Might be worth ruling out a regional infra issue before we assume it's a UX problem.",
          reactions: [{ emoji: '👍', count: 1, owner: 'others' }, { emoji: '🙏', count: 1, owner: 'others' }],
          replyCount: 2,
        },
      ],
    },
    {
      dateLabel: 'Yesterday',
      convs: [
        {
          id: 'dm4_c3',
          authorName: 'You',
          timestamp: '10:05 AM',
          body: "Morning! The design team incorporated your async export feedback from yesterday, they're now going with the job queue approach. They've got a draft of the loading state and download-ready notification in Figma if you want to take a look before it goes to eng.\n\nAlso the customer on ticket #48821 confirmed the rate limiting fix resolved their issue. Closing it out now.",
          replyCount: 1,
        },
        {
          id: 'dm4_c4',
          authorName: 'Greg Bothman',
          timestamp: '1:45 PM',
          body: "One thing worth raising in the 2pm design review: the current export design assumes synchronous generation, but for datasets over 10k rows that's going to be a problem.\n\nWe'll need either a job queue with a download link or pagination on the export endpoint. I'll bring both options written up so we can decide in the room.",
          replyCount: 2,
        },
      ],
    },
  ],

  // Juan Foley
  5: [
    {
      dateLabel: 'Tue, August 27',
      convs: [
        {
          id: 'dm5_c1',
          authorName: 'Juan Foley',
          timestamp: '11:20 AM',
          body: "The new analytics dashboard is rolling out to the beta cohort tomorrow. Anything you want to flag before we hit the green light?\n\nMostly looking for any rough edges you noticed in the staging environment.",
        },
        {
          id: 'dm5_c2',
          authorName: 'You',
          timestamp: '2:15 PM',
          body: "Two things worth a look:\n\n1. The funnel chart filter resets every time you switch date ranges. Probably an effect dependency issue.\n2. The export-to-CSV button on the cohort table doesn't include the filter context, so users will get the unfiltered dataset.\n\nNeither is a launch blocker but worth fixing before broader rollout.",
          replyCount: 2,
          hasNewReply: true,
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 'dm5_c3',
          authorName: 'Juan Foley',
          timestamp: '8:30 AM',
          body: "Both fixes shipped to staging this morning, ready for verification. Beta release is on hold until you give it a once-over.\n\nLet me know when you've had a chance.",
        },
      ],
    },
  ],

  // Hallie Pratt
  3: [
    {
      dateLabel: 'Thu, August 29',
      convs: [
        {
          id: 'dm3_c1',
          authorName: 'Hallie Pratt',
          timestamp: '4:10 PM',
          body: "The demo you gave at the All Hands was genuinely impressive. Several stakeholders came up to me after and asked for a deeper session.\n\nWould you be up for a follow-up in October with a broader audience?",
          reactions: [{ emoji: '🚀', count: 1, owner: 'yours' }],
          replyCount: 1,
          hasNewReply: true,
          isUrgent: true,
        },
        {
          id: 'dm3_c2',
          authorName: 'You',
          timestamp: '4:32 PM',
          body: "Absolutely up for it. I was thinking a live walkthrough with a real use case might land better than a polished deck with that audience. More credibility and easier to pivot if questions come up mid-session.\n\nShould I coordinate directly with you or go through your EA?",
          replyCount: 1,
        },
        {
          id: 'dm3_c3',
          authorName: 'Hallie Pratt',
          timestamp: '4:50 PM',
          body: "It's primarily the Growth and RevOps leads, so something around analytics and reporting workflow would resonate most.\n\nI'm thinking second or third week of October, 45-minute slot. I'll send you a few calendar options early next week with that context included.",
        },
      ],
    },
  ],

  // Amie Miles
  6: [
    {
      dateLabel: 'Mon, August 26',
      convs: [
        {
          id: 'dm6_c1',
          authorName: 'Amie Miles',
          timestamp: '11:30 AM',
          body: "Heads up - I'm reshuffling on-call rotation for Q4 and wanted to flag that you'd be paired with Daniel for the first two weeks of October.\n\nLet me know if there's a conflict and I'll move things around.",
          replyCount: 1,
        },
      ],
    },
    {
      dateLabel: 'Tue, August 27',
      convs: [
        {
          id: 'dm6_c2',
          authorName: 'You',
          timestamp: '9:45 AM',
          body: "October works. The only week I have to dodge is the 21st - team offsite. Otherwise pairing with Daniel is fine, we already overlap on the auth migration.",
        },
        {
          id: 'dm6_c3',
          authorName: 'Amie Miles',
          timestamp: '10:02 AM',
          body: "Perfect, locked in. I'll skip you for the week of the 21st and shift Zack into that slot.",
          reactions: [{ emoji: '🙏', count: 1, owner: 'others' }],
        },
      ],
    },
  ],

  // Zack Bright
  7: [
    {
      dateLabel: 'Wed, August 28',
      convs: [
        {
          id: 'dm7_c1',
          authorName: 'Zack Bright',
          timestamp: '2:15 PM',
          body: "Pulled the activation funnel numbers you asked for. Top-line: signup-to-first-action dropped from 64% to 51% over the last three weeks.\n\nThe drop is concentrated in the email-onboarded cohort specifically. Paid and referral channels held steady.",
          replyCount: 2,
        },
        {
          id: 'dm7_c2',
          authorName: 'You',
          timestamp: '3:40 PM',
          body: "That timing lines up with the email template change we shipped on the 7th. Worth checking whether the new CTA is actually hitting the activation event we measure on, or if the analytics tag broke during the redesign.\n\nCan you check the event volume against pre-redesign baseline?",
          replyCount: 1,
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 'dm7_c3',
          authorName: 'Zack Bright',
          timestamp: '8:50 AM',
          body: "Confirmed - it's a tagging issue, not a real drop. The redesign moved the activation CTA outside the wrapper that fires the event. Real activation rate is steady around 63%.\n\nFix is queued with the engineering ticket from yesterday. I'll send a follow-up to anyone who saw the dashboard with the wrong number.",
        },
      ],
    },
  ],
}

/**
 * A DM is unread when any non-urgent conversation has a new message or reply.
 * Urgent unreads are surfaced via the dedicated Urgent section / warning pill
 * indicator, not the regular accent-dot unread indicator.
 */
export function dmHasUnread(dmId: number): boolean {
  const groups = DM_CONVERSATIONS[dmId]
  if (!groups) return false
  for (const g of groups) {
    for (const c of g.convs) {
      if (c.isUrgent) continue
      if (c.hasNewMessage || c.hasNewReply) return true
    }
  }
  return false
}
