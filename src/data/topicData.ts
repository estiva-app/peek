export interface Topic {
  id: string
  title: string
  isResolved: boolean
  /** Names of people invited to the topic when it was created. Surfaces in the members pill. */
  invitees?: string[]
  /** Optional Folder id (NIP-29 channel UUID) when this topic is published / synced with the relay. */
  folderId?: string | null
}

export const TOPICS: Topic[] = [
  { id: '1', title: 'CI/CD pipeline stuck during build stage',       isResolved: false },
  { id: '2', title: 'Launch checklist for v2 of the mobile app',     isResolved: false },
  { id: '3', title: 'Ongoing onboarding issues',                     isResolved: false },
  { id: '4', title: 'Remote work policy clarifications',             isResolved: true  },
  { id: '5', title: 'Usability test results for the dashboard redesign', isResolved: true  },
  { id: '6', title: 'Show your pet!',                                isResolved: false },
  { id: '7', title: 'Updates on the new office layout',              isResolved: false },
  { id: '8', title: 'Quick fix needed for staging deployment issue', isResolved: false },
  { id: '9', title: 'Feedback on mobile onboarding flow',            isResolved: false },
  { id: '10', title: 'Payment integration',                          isResolved: false },
]

export type HighlightType = 'insight' | 'concern' | 'conclusion' | 'question' | 'summary'

export const HIGHLIGHT_META: Record<HighlightType, { color: string; label: string }> = {
  insight:    { color: 'var(--warning-default)', label: 'Insight' },
  concern:    { color: 'var(--error-default)',   label: 'Concern' },
  conclusion: { color: 'var(--success-default)', label: 'Conclusion' },
  question:   { color: 'var(--info-default)',    label: 'Question' },
  summary:    { color: 'var(--accent-primary)',  label: 'Summary' },
}

export interface ReactionData {
  emoji: string
  count: number
  owner: 'yours' | 'others'
  /** Reactors in reaction order, the viewer as 'You' (drives the pill
   *  tooltip). Absent on static mock reactions — the tooltip then shows
   *  just the reaction name. */
  names?: string[]
}

/** A real uploaded file attached to a message/reply (Phase 5). `url` is the
 *  resolved storage URL; `previewUrl` is a local object URL used only during
 *  the optimistic window before the server round-trips (images render
 *  instantly). Distinct from `attachments` (Figma frame ids). */
export interface FileAttachment {
  storageId?: string
  url?: string
  previewUrl?: string
  name: string
  contentType: string
  size: number
}

export interface ConversationData {
  id: string
  authorName: string
  /** The author's face, resolved server-side (PEEK-43). Additive: `Avatar`
   *  falls back to the name-keyed portraits when this is absent, so static
   *  mocks and Storybook render exactly as they did. It exists because an
   *  author with no Peek account is absent from the people directory the
   *  name lookup reads, so that lookup could never find them. */
  authorAvatarSrc?: string
  timestamp: string
  body: string
  reactions?: ReactionData[]
  replyCount?: number
  hasNewMessage?: boolean
  hasNewReply?: boolean
  isUrgent?: boolean
  highlightType?: HighlightType
  isResolved?: boolean
  resolvedBy?: string
  resolutionMessage?: string
  /** Figma frame ids attached to the message (see figmaData.ts). */
  attachments?: string[]
  /** Real uploaded files (Phase 5) — separate lane from Figma `attachments`. */
  files?: FileAttachment[]
  /** Numeric send time (ms). Convex rows + runtime sends carry it; static
   *  mocks don't — consumers must treat it as a sort hint, not a given. */
  createdAtMs?: number
  /** Distinct reply authors in first-reply order — the reply row's facepile
   *  (signal theme). Server rows carry it; mock rows derive it from REPLIES. */
  replyAuthors?: { name: string; avatarSrc?: string }[]
  /** Formatted time of the newest reply, shown next to the reply count. */
  lastReplyTime?: string
  /** NIP-27 `a` tag addresses from imported events (references to other apps' objects). */
  nostrReferences?: string[]
}

export interface ConvGroup {
  dateLabel: string
  convs: ConversationData[]
}

export const TOPIC_CONVERSATIONS: Record<string, ConvGroup[]> = {

  // Topic 1: CI/CD pipeline stuck during build stage
  '1': [
    {
      dateLabel: 'Mon, September 2',
      convs: [
        {
          id: 't1_c1',
          authorName: 'Juan Foley',
          timestamp: '9:14 AM',
          body: "Hey everyone, our CI/CD pipeline has been failing at the build stage since this morning.\n\nThe error is thrown during the Docker image build step. Logs show it can't resolve some dependencies. Anyone else seeing this? Build #4821 is the latest failure.",
          replyCount: 3,
        },
        {
          id: 't1_c2',
          authorName: 'Daniel Stanton',
          timestamp: '11:08 AM',
          body: "Found the root cause. `@testing-library/react` was bumped to 15.x in the last merge but `react-scripts` on our current version doesn't support it yet.\n\nPinning it back to 14.x now. Will update once build is confirmed green.",
          reactions: [{ emoji: '🙏', count: 3, owner: 'others' }],
          replyCount: 2,
        },
      ],
    },
    {
      dateLabel: 'Tue, September 3',
      convs: [
        {
          id: 't1_c3',
          authorName: 'Daniel Stanton',
          timestamp: '10:05 AM',
          body: "Build #4826 passed. Pipeline is green again.\n\nI've also added a `.npmrc` rule to block major version bumps on that package without a manual override so we don't hit this again.",
          reactions: [{ emoji: '🚀', count: 4, owner: 'yours' }, { emoji: '💯', count: 2, owner: 'others' }],
          replyCount: 4,
          isResolved: true,
          resolvedBy: 'Daniel Stanton',
          resolutionMessage: 'Pinned @testing-library/react to 14.x. Builds passing, npmrc guard added.',
        },
        {
          id: 't1_c4',
          authorName: 'Juan Foley',
          timestamp: '11:42 AM',
          body: "There's a second issue now, separate from the dependency fix. The staging deploy step health check is timing out after 30s.\n\nMight be related to the memory limits we adjusted last week. @devops can you take a look at the health check config on staging?",
          replyCount: 2,
        },
        {
          id: 't1_c5',
          authorName: 'Amie Miles',
          timestamp: '2:17 PM',
          body: "Health check timeout root cause found. Memory limit was bumped to 512 MB but the health check timeout was never updated to account for the longer startup time.\n\nBumping the timeout to 60s. PR up for review.",
          replyCount: 1,
        },
      ],
    },
  ],

  // Topic 2: Launch checklist for v2 of the mobile app (private)
  '2': [
    {
      dateLabel: 'Wed, August 28',
      convs: [
        {
          id: 't2_c1',
          authorName: 'Hallie Pratt',
          timestamp: '10:00 AM',
          body: "V2 launch checklist is drafted. Items that need to be cleared before we go live:\n\n- QA sign-off on all P0 and P1 bugs\n- App Store build submitted and in review\n- Feature flags set to 10% rollout on day one\n- Support team briefed on known edge cases\n- Analytics events verified end-to-end in the production mirror\n- Marketing assets live on the landing page\n\nLet's use this topic to surface blockers. Assign yourselves to items you own.",
          replyCount: 6,
        },
        {
          id: 't2_c2',
          authorName: 'Greg Bothman',
          timestamp: '10:45 AM',
          body: "App Store submission timeline needs attention. Apple review is typically 7 days but can stretch to 10 if they flag anything.\n\nIf we're targeting the 15th as the public launch date, the build needs to be submitted by the 5th at the absolute latest. Looking at our current P0 backlog, that feels very tight.",
          replyCount: 3,
        },
      ],
    },
    {
      dateLabel: 'Thu, August 29',
      convs: [
        {
          id: 't2_c3',
          authorName: 'Hallie Pratt',
          timestamp: '9:22 AM',
          body: "QA flagged two P0s this morning that block submission:\n\n- P0-1: Face ID fallback crashes on iOS 16.1, affects roughly 12% of our installed base\n- P0-2: Push notifications not arriving in the EU region, suspect it's the Frankfurt SNS endpoint config\n\nNeither is optional. @Zack Bright on P0-1, @backend-team on P0-2.",
          replyCount: 5,
        },
        {
          id: 't2_c4',
          authorName: 'Zack Bright',
          timestamp: '1:14 PM',
          body: "P0-1 is fixed and PR is up. It was a missing null check in the biometrics handler when device auth returns nil instead of a typed error.\n\nPR #892 is ready for review and should be mergeable today.",
          reactions: [{ emoji: '👍', count: 2, owner: 'others' }],
          replyCount: 2,
        },
        {
          id: 't2_c5',
          authorName: 'Greg Bothman',
          timestamp: '4:30 PM',
          body: "Pushing the timeline back while P0-2 is still open. New dates: submission on the 10th, public launch on the 17th. Marketing has been updated.\n\nLet's not rush the EU fix. A notification failure on launch day in that region would be a much bigger problem than a short delay.",
          replyCount: 2,
          hasNewReply: true,
        },
      ],
    },
    {
      dateLabel: 'Fri, August 30',
      convs: [
        {
          id: 't2_c6',
          authorName: 'Hallie Pratt',
          timestamp: '11:00 AM',
          body: "P0-2 cleared overnight. It was a misconfigured SNS topic ARN for EU-West-1. Notifications are flowing correctly in the staging environment now.\n\nBoth P0s resolved. Submitting the build to App Store this afternoon.",
          reactions: [{ emoji: '🎉', count: 5, owner: 'yours' }, { emoji: '🚀', count: 3, owner: 'others' }],
          replyCount: 4,
        },
        {
          id: 't2_c7',
          authorName: 'Greg Bothman',
          timestamp: '3:45 PM',
          body: "Build is in the App Store review queue as of 3:30pm. Confirmation email received.\n\nI'll track status here and flag immediately if Apple comes back with anything. Barring a rejection, we're on track for the 17th.",
          replyCount: 2,
        },
      ],
    },
  ],

  // Topic 3: Ongoing onboarding issues
  '3': [
    {
      dateLabel: 'Mon, August 18',
      convs: [
        {
          id: 't3_c1',
          authorName: 'Jake Walter',
          timestamp: '9:08 AM',
          body: "@Greg Bothman we wrapped up the Finance Weekly and the onboarding numbers are alarming. Drop-off rate is up 34% in the past two weeks.\n\nCS is also fielding significantly more onboarding-related tickets than usual. Do you have data on where exactly users are falling off in the flow?",
          replyCount: 3,
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 't3_c2',
          authorName: 'Greg Bothman',
          timestamp: '10:22 AM',
          body: "Funnel data is in. The biggest drop-off is at the liveness check step: 41% of users who reach it don't complete it.\n\nSession recordings show a mix of confusion about face positioning, degraded performance on older Android devices, and error messages that are way too technical for regular users.\n\nNone of this is a surprise honestly. We've been on SDK 3.1.0 for over a year.",
          reactions: [{ emoji: '👍', count: 3, owner: 'yours' }],
          replyCount: 3,
          isResolved: true,
          resolvedBy: 'Greg Bothman',
          resolutionMessage: 'Root cause confirmed: liveness check UX. SDK upgrade and UX rework underway.',
        },
        {
          id: 't3_c3',
          authorName: 'Greg Bothman',
          timestamp: '11:15 AM',
          body: "SDK 3.4.2 comparison is done. The improvement over our current 3.1.0 is substantial: better face detection in low light, real-time positioning feedback that actually works, and much cleaner error states.\n\nProposing we ship the SDK upgrade as a quick win before tackling the full UX rewrite. @Zack Bright can you own this sprint?",
          replyCount: 2,
        },
        {
          id: 't3_c4',
          authorName: 'Alice Johnson',
          timestamp: '1:45 PM',
          body: "Two directions in Figma for the face scan guidance screen.\n\nOption A is a 3-step static illustration sequence. Option B is a short looping animation. I'm leaning toward A: simpler to ship and no autoplay accessibility concerns.\n\nLink in thread. Thoughts?",
          replyCount: 4,
        },
        {
          id: 't3_c5',
          authorName: 'Jake Walter',
          timestamp: '3:00 PM',
          body: "One UX improvement I want to flag independently: the current error screen routes users all the way back to the start of the flow.\n\nA simple 'Try again' shortcut directly on that screen could recover a meaningful chunk of drop-offs without much eng effort. Worth adding to the spec.",
          replyCount: 2,
        },
        {
          id: 't3_c6',
          authorName: 'Alice Johnson',
          timestamp: '4:10 PM',
          body: "Spec is updated and ready for QA handoff:\n\n- SDK 3.4.2 upgrade\n- Illustration option A for guidance screen\n- 'Try again' shortcut on error screen\n- Error copy rewritten for non-technical users\n\nTargeting next sprint. @Zack Bright flagging you for the joint review once the SDK PR is merged.",
          replyCount: 2,
          isResolved: true,
          resolvedBy: 'Alice Johnson',
          resolutionMessage: 'Spec updated: SDK 3.4.2 + illustration option A + retry shortcut. Going to QA next sprint.',
        },
      ],
    },
  ],

  // Topic 4: Remote work policy clarifications (private, resolved)
  '4': [
    {
      dateLabel: 'Tue, July 16',
      convs: [
        {
          id: 't4_c1',
          authorName: 'Amie Miles',
          timestamp: '11:00 AM',
          body: "Official remote work policy clarification following the All Hands questions:\n\n- Up to 3 days remote per week for all employees\n- Core hours are 10am to 3pm in your local timezone\n- International remote work requires manager approval, capped at 30 days per calendar year\n- Home office equipment reimbursable up to £500 per year\n\nFull updated policy is in the HR portal.",
          replyCount: 4,
          isResolved: true,
          resolvedBy: 'Amie Miles',
          resolutionMessage: 'Policy published in HR portal and acknowledged by all teams.',
        },
        {
          id: 't4_c2',
          authorName: 'Zack Bright',
          timestamp: '2:30 PM',
          body: "Question on the summer months specifically: does the 3-day limit apply in July and August as well?\n\nA few of us were hoping for a bit more flexibility during that period, especially with kids out of school.",
          replyCount: 2,
          isResolved: true,
          resolvedBy: 'Amie Miles',
          resolutionMessage: 'Confirmed: 4 days remote in July and August for the current year.',
        },
      ],
    },
    {
      dateLabel: 'Wed, July 17',
      convs: [
        {
          id: 't4_c3',
          authorName: 'Amie Miles',
          timestamp: '9:45 AM',
          body: "Summer flexibility confirmed with leadership: July and August are extended to 4 days remote per week.\n\nThis applies for the current year and will be reviewed in the Q4 policy refresh. HR portal document has been updated.",
          replyCount: 1,
          isResolved: true,
          resolvedBy: 'Amie Miles',
          resolutionMessage: 'Summer flexibility confirmed: 4 days remote in July and August. HR portal updated.',
        },
      ],
    },
  ],

  // Topic 5: Usability test results for the dashboard redesign (resolved)
  '5': [
    {
      dateLabel: 'Thu, August 8',
      convs: [
        {
          id: 't5_c1',
          authorName: 'Alice Johnson',
          timestamp: '3:00 PM',
          body: "8 usability sessions on the dashboard redesign completed this week. Summary:\n\n- Date range filtering: intuitive for all 8 participants\n- Card layout: all 8 preferred it over the previous table view\n- Export button: 6 of 8 couldn't find it (hidden in overflow menu)\n- Chart legend: font too small at 100% zoom, 4 participants zoomed in\n- Notification badge: 3 participants thought it was a button\n\nFull report with recordings in Notion.",
          replyCount: 5,
          isResolved: true,
          resolvedBy: 'Alice Johnson',
          resolutionMessage: 'Findings reviewed; all five issues converted into Jira tickets.',
        },
        {
          id: 't5_c2',
          authorName: 'Daniel Stanton',
          timestamp: '4:15 PM',
          body: "Export button discoverability is a fast fix this sprint. Moving it to the primary toolbar requires no design changes, Jira ticket raised.\n\nFor the legend: what's the target font size? 12px or 13px?",
          reactions: [{ emoji: '👍', count: 2, owner: 'others' }],
          replyCount: 2,
          isResolved: true,
          resolvedBy: 'Daniel Stanton',
          resolutionMessage: 'Export button moved; legend size confirmed at 12px.',
        },
      ],
    },
    {
      dateLabel: 'Fri, August 9',
      convs: [
        {
          id: 't5_c3',
          authorName: 'Alice Johnson',
          timestamp: '10:30 AM',
          body: "Legend size answer: 12px is fine. The real issue was line height being too tight rather than the size itself. Figma spec updated.\n\nAlso repositioning the notification badge to the top-right corner of the card header to match the standard pattern we use everywhere else.",
          replyCount: 3,
          isResolved: true,
          resolvedBy: 'Alice Johnson',
          resolutionMessage: 'Legend line-height fixed; notification badge repositioned in Figma.',
        },
        {
          id: 't5_c4',
          authorName: 'Alice Johnson',
          timestamp: '2:00 PM',
          body: "Design changes finalized and handed off to engineering:\n\n1. Export button moved to primary toolbar\n2. Legend: 12px font, 1.4 line-height\n3. Notification badge repositioned to card top-right\n4. Tooltip added to date range picker for first-time users\n\nFour Jira tickets raised, all targeting next sprint.",
          replyCount: 1,
          isResolved: true,
          resolvedBy: 'Alice Johnson',
          resolutionMessage: 'All findings actioned. Design specs updated and handed off to engineering.',
        },
      ],
    },
  ],

  // Topic 6: Show your pet!
  '6': [
    {
      dateLabel: 'Fri, August 23',
      convs: [
        {
          id: 't6_c1',
          authorName: 'Hallie Pratt',
          timestamp: '9:05 AM',
          body: "It's Friday and I have decided we are doing this.\n\nIntroducing Mochi: 4-year-old shiba inu who has fully committed to the bit that he is a cat. Sits in boxes, knocks things off tables, ignores commands selectively. Somehow still the best.",
          reactions: [{ emoji: '🎉', count: 8, owner: 'yours' }, { emoji: '💯', count: 4, owner: 'others' }],
          replyCount: 12,
        },
        {
          id: 't6_c2',
          authorName: 'Jake Walter',
          timestamp: '9:32 AM',
          body: "Here's Pretzel: retired racing greyhound who operates exclusively at two speeds.\n\nFull sprint across the garden or completely unconscious on the sofa. No in between. We tried walking pace once. He looked offended.",
          reactions: [{ emoji: '🚀', count: 3, owner: 'others' }],
          replyCount: 8,
        },
        {
          id: 't6_c3',
          authorName: 'Hallie Pratt',
          timestamp: '10:11 AM',
          body: "Meet Biscuit: she's 14, completely deaf, and somehow still alerts us to the postman before we hear anything.\n\nSenior dogs are undefeated and I will die on this hill.",
          replyCount: 6,
        },
        {
          id: 't6_c4',
          authorName: 'Alice Johnson',
          timestamp: '11:45 AM',
          body: "Here's Noodle: a rescue tabby who decided my laptop keyboard is her preferred napping spot.\n\nShe joined a client call last Thursday uninvited. The client said 'can she stay?' She stayed.",
          reactions: [{ emoji: '💯', count: 6, owner: 'yours' }, { emoji: '🙏', count: 2, owner: 'others' }],
          replyCount: 9,
        },
      ],
    },
    {
      dateLabel: 'Mon, August 26',
      convs: [
        {
          id: 't6_c5',
          authorName: 'Daniel Stanton',
          timestamp: '9:00 AM',
          body: "Coming back to this after the weekend, it's genuinely the highlight of my Mondays.\n\nHere's Kafka: yes named after the framework, yes intentionally. He sits beside my monitor during standups and evaluates the quality of my pull request descriptions. Usually unimpressed.",
          replyCount: 7,
        },
        {
          id: 't6_c6',
          authorName: 'Greg Bothman',
          timestamp: '10:30 AM',
          body: "Here's Dumpling: corgi, 3 years old.\n\nShe has appointed herself personally responsible for the structural integrity of the house and patrols accordingly at 3am. Every night. Without fail.",
          replyCount: 5,
        },
        {
          id: 't6_c7',
          authorName: 'Zack Bright',
          timestamp: '1:15 PM',
          body: "Late to the thread but couldn't let it close without contributing.\n\nThis is Theorem: 2-year-old golden retriever, named by my daughter during her maths phase. He is extremely enthusiastic about everything and has zero concept of personal space. I work from home.",
          replyCount: 4,
        },
        {
          id: 't6_c8',
          authorName: 'Juan Foley',
          timestamp: '3:00 PM',
          body: "Final entry: this is Sudo.\n\nYes the command. Yes my partner drew the line at `rm -rf`. Yes he has root access to the sofa. He's a rescue border collie and he's faster than any build pipeline I've ever run.",
          hasNewMessage: true,
        },
      ],
    },
  ],

  // Topic 7: Updates on the new office layout
  '7': [
    {
      dateLabel: 'Mon, September 9',
      convs: [
        {
          id: 't7_c1',
          authorName: 'Hallie Pratt',
          timestamp: '10:00 AM',
          body: "New office layout goes live this Monday the 16th. Key changes:\n\n- Floor 2: Open collaboration zone replacing the old cubicle bank, 120 hot desks with monitors\n- Floor 3: Two new bookable focus rooms, max 4 people, bookable via the office app\n- Zone C: 24 standing desks on a first-come basis\n- Kitchen: Second coffee station and additional fridge space\n\nFull floor plan linked in the facilities channel.",
          replyCount: 5,
        },
        {
          id: 't7_c2',
          authorName: 'Greg Bothman',
          timestamp: '11:30 AM',
          body: "Parking situation needs addressing before the 16th. The construction on the adjacent building has eaten into our usual lot and several people on my team have been struggling to find a spot before 9am.\n\nIs there a plan in place for this?",
          replyCount: 3,
        },
        {
          id: 't7_c3',
          authorName: 'Zack Bright',
          timestamp: '2:15 PM',
          body: "Question on the new focus rooms: is there a minimum booking duration or can you grab one for a quick 20-minute call?\n\nAlso will same-day booking be available or does it need to be done in advance?",
          replyCount: 1,
        },
      ],
    },
    {
      dateLabel: 'Tue, September 10',
      convs: [
        {
          id: 't7_c4',
          authorName: 'Hallie Pratt',
          timestamp: '9:15 AM',
          body: "Parking and focus room questions answered:\n\n- 40 additional spots secured in the Meridian garage two blocks east, company-covered from day one\n- Shuttle every 20 minutes between 8-10am and 4-7pm, full schedule in this morning's all-staff email\n- Focus rooms: no minimum duration, book from 15 minutes up to 3 hours\n- Same-day booking is fine. If a room shows as booked but is visibly empty after 10 minutes, you're free to use it",
          replyCount: 2,
        },
      ],
    },
  ],

  // Topic 8: Quick fix needed for staging deployment issue
  '8': [
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 't8_c1',
          authorName: 'You',
          timestamp: '2:03 PM',
          body: "Staging is down. The deployment from 20 minutes ago didn't come up healthy, health checks failing across all three instances.\n\nWe have a client demo at 4pm. @Amie Miles @Juan Foley anyone available right now?",
          replyCount: 1,
        },
        {
          id: 't8_c2',
          authorName: 'Amie Miles',
          timestamp: '2:19 PM',
          body: "Found and fixed. The new env variable `FEATURE_FLAG_NEW_AUTH` wasn't set in the staging environment config. Service was crashing on startup trying to read it as a required value.\n\nAdded the variable and redeployed. Health checks are green across all instances. Good for the demo.",
          reactions: [{ emoji: '🙏', count: 4, owner: 'yours' }, { emoji: '🚀', count: 2, owner: 'others' }],
          replyCount: 2,
          isResolved: true,
          resolvedBy: 'Amie Miles',
          resolutionMessage: 'Missing env var added. Staging back online. Pre-deploy env check being added to pipeline.',
        },
        {
          id: 't8_c3',
          authorName: 'Amie Miles',
          timestamp: '2:45 PM',
          body: "To prevent this class of issue going forward, I'm adding a pre-deploy validation step to the pipeline that checks all required env variables are present in the target environment before the deployment starts.\n\nPR for that is up as well.",
          replyCount: 1,
        },
      ],
    },
  ],

  // Topic 9: Feedback on mobile onboarding flow
  '9': [
    {
      dateLabel: 'Wed, September 4',
      convs: [
        {
          id: 't9_c1',
          authorName: 'Alice Johnson',
          timestamp: '11:00 AM',
          body: "Ran an informal review of the mobile onboarding flow with 3 first-time users yesterday. Main friction points found:\n\n1. The 'Allow notifications' prompt fires too early. Users haven't seen any value yet and reflexively dismiss it\n2. Progress indicator disappears on steps 3 and 4, looks like a regression from last sprint\n3. 'You're all set' screen has no clear next action. All 3 users paused and weren't sure what to do\n\nHappy to share session recordings if useful.",
          replyCount: 3,
        },
        {
          id: 't9_c2',
          authorName: 'Zack Bright',
          timestamp: '12:30 PM',
          body: "Notifications trigger point needs to move. Best practice is to delay it until after the first aha moment, for us that's completing their first task.\n\nThis is a small config change on our end. I can get it done this week.",
          replyCount: 2,
        },
        {
          id: 't9_c3',
          authorName: 'Jake Walter',
          timestamp: '2:00 PM',
          body: "Progress indicator fix is straightforward, I can see exactly where it got dropped in the last PR and will patch it today.\n\n'You're all set' is the bigger problem. The screen currently has no primary action at all which is a real dead end for new users.",
          replyCount: 1,
        },
      ],
    },
    {
      dateLabel: 'Thu, September 5',
      convs: [
        {
          id: 't9_c4',
          authorName: 'Alice Johnson',
          timestamp: '10:00 AM',
          body: "Updated mockups are in Figma covering all three issues:\n\n1. Notifications prompt moved to trigger after first completed task\n2. Progress bar now visible on all 6 steps\n3. 'You're all set' screen has a primary 'Go to dashboard' CTA and a secondary 'Take a tour' option\n\nLink in thread.",
          replyCount: 4,
        },
        {
          id: 't9_c5',
          authorName: 'Jake Walter',
          timestamp: '11:45 AM',
          body: "Found a separate layout issue while testing the mockups. On sub-5.5\" Android devices the 'Next' button gets pushed off screen when the keyboard is open.\n\nWe should fix the layout to account for keyboard height or go with a floating button pattern. Worth deciding before this goes to eng.",
          replyCount: 2,
        },
        {
          id: 't9_c6',
          authorName: 'Zack Bright',
          timestamp: '2:30 PM',
          body: "Keyboard overlap is fixed. Using `adjustResize` with a scroll wrapper around the form so the button stays reachable regardless of keyboard state. PR up.\n\n@Alice Johnson if you prefer the floating button from a design standpoint I'm happy to swap it, just let me know.",
          replyCount: 1,
        },
      ],
    },
  ],

  // Topic 10: Payment integration (Peek x Stripe). Cross-org: Bob Chen is the
  // Stripe engineer. Leaves a reserved seam after the kickoff message where the
  // post-call highlights card will later render (condensed design, TBD).
  '10': [
    {
      dateLabel: 'Mon, September 9',
      convs: [
        {
          id: 't10_c1',
          authorName: 'You',
          timestamp: '11:05 AM',
          body: "Kickoff with the Stripe team just wrapped. Good session, we're aligned on scope and @Bob Chen is our main contact on their side going forward.\n\nShort version for anyone who missed it: we're going with Stripe Checkout, and the failure and retry paths are where we need to be careful. Full notes below.",
          replyCount: 1,
        },

        // ── Post-call highlights card renders here (auto summary from the
        //    kickoff call). New condensed design, not one row per point.
        //    Designed later once the Meet highlights layout is chosen. ──

        {
          id: 't10_c2',
          authorName: 'Daniel Stanton',
          timestamp: '2:40 PM',
          body: "Confirmed we're using Stripe Checkout rather than building our own card form. It keeps us out of most of the PCI scope and we get 3DS and wallets for free.\n\nTradeoff is less control over the exact UI, but for v1 that's the right call. We can revisit a custom flow later if there's a real need.",
          reactions: [{ emoji: '👍', count: 4, owner: 'others' }, { emoji: '🚀', count: 2, owner: 'yours' }],
          replyCount: 2,
        },
      ],
    },
    {
      dateLabel: 'Wed, September 11',
      convs: [
        {
          id: 't10_c3',
          authorName: 'Alice Johnson',
          timestamp: '10:20 AM',
          body: "First pass at the payment flow is in Figma. Happy path plus the states we talked about: processing, success, and a first cut of the failure screen.\n\nThe error copy is still rough. I want to get the failure and 3DS-declined states right before this goes to eng, so feedback welcome.",
          attachments: ['fg-frame-7', 'fg-frame-8'],
          replyCount: 2,
        },
        {
          id: 't10_c4',
          authorName: 'You',
          timestamp: '11:35 AM',
          body: "@Bob Chen quick one on the failed payment screen. When a charge fails after the customer completes 3DS, what does Stripe actually return, and what should we be showing them?\n\nTrying to avoid a dead end where the customer has no idea whether to retry or reach for a different card.",
          replyCount: 3,
        },
        {
          id: 't10_c5',
          authorName: 'Bob Chen',
          timestamp: '12:12 PM',
          body: "Good question. After a 3DS challenge the charge can still fail, most often as a plain card decline from the issuer. You get a `payment_intent.payment_failed` event with a decline code and a human readable message you can surface.\n\nMy advice: show the issuer's message when it's safe to, keep the customer on the same screen, and offer both retry and a different payment method. Sending them back to the start of checkout is where you lose people.",
        },
        {
          id: 't10_c6',
          authorName: 'Amie Miles',
          timestamp: '3:05 PM',
          body: "One thing we can't skip is reconciliation. If the webhook that confirms a payment is delayed or dropped, we can mark an order paid when it isn't, or the other way around.\n\nWe need idempotent handling keyed on the event id, plus a fallback job that reconciles against Stripe on a schedule. I'd treat this as launch blocking, not a nice to have.",
          highlightType: 'concern',
          replyCount: 2,
        },
      ],
    },
    {
      dateLabel: 'Today',
      convs: [
        {
          id: 't10_c7',
          authorName: 'Daniel Stanton',
          timestamp: '9:30 AM',
          body: "Reconciliation approach is settled. We store the payment intent id on the order, handle webhooks idempotently by event id, and run a job every 15 minutes that reconciles anything still pending against Stripe.\n\nWriting it up as the first PR now.",
          reactions: [{ emoji: '🙌', count: 3, owner: 'yours' }],
          replyCount: 2,
          isResolved: true,
          resolvedBy: 'Daniel Stanton',
          resolutionMessage: 'Stripe Checkout, idempotent webhooks by event id, 15 min reconciliation job. First PR in progress.',
        },
        {
          id: 't10_c8',
          authorName: 'Juan Foley',
          timestamp: '10:48 AM',
          body: "Heads up before we lock the flow. On mobile Safari the redirect back from Checkout occasionally lands on a blank page if the tab was backgrounded during the 3DS step.\n\nIt's intermittent but it's a real drop-off. @Bob Chen have you run into this, and is there a return handling you'd recommend?",
          isUrgent: true,
          replyCount: 1,
        },
      ],
    },
  ],
}

/**
 * A topic is unread when any non-urgent conversation has a new message or reply.
 * Urgent unreads are surfaced via the dedicated Urgent section / warning pill
 * indicator, not the regular accent-dot unread indicator.
 */
export function topicHasUnread(topicId: string): boolean {
  const groups = TOPIC_CONVERSATIONS[topicId]
  if (!groups) return false
  for (const g of groups) {
    for (const c of g.convs) {
      if (c.isUrgent) continue
      if (c.hasNewMessage || c.hasNewReply) return true
    }
  }
  return false
}
