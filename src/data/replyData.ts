import type { HighlightType, FileAttachment, ReactionData } from './topicData'

export interface ReplyData {
  id: string
  authorName: string
  /** The author's face, resolved server-side — see ConversationData (PEEK-43). */
  authorAvatarSrc?: string
  timestamp: string
  body: string
  isNew?: boolean
  isUrgent?: boolean
  highlightType?: HighlightType
  /** Figma frame ids attached to the reply (see figmaData.ts). */
  /** Real uploaded files (Phase 5). */
  files?: FileAttachment[]
  /**
   * Numeric creation time (ms since epoch). Used to chronologically partition replies
   * around a topic-promotion divider. Static mock replies omit this (treated as
   * pre-promotion). Runtime-sent replies set it at create time.
   */
  createdAtMs?: number
  /** NIP-27 `a` tag addresses from imported events (references to other apps' objects). */
  nostrReferences?: string[]
  /** The published event's id — what a message link names (PEE-17). Absent
   *  until the reply reaches the relay. */
  nostrEventId?: string
  /** Persisted per-reply reactions (PEE-12). */
  reactions?: ReactionData[]
}

/**
 * Static reply data keyed by conversation id.
 * Only conversations with replyCount > 0 need entries here.
 */
export const REPLIES: Record<string, ReplyData[]> = {
  // ── Topic 1: CI/CD pipeline ──
  t1_c1: [
    { id: 'r_t1c1_1', authorName: 'Amie Miles', timestamp: '9:22 AM', body: "Seeing the same thing on my branch. Looks like it started after the 8:50 AM merge to main." },
    { id: 'r_t1c1_2', authorName: 'Daniel Stanton', timestamp: '9:35 AM', body: "Checking the dependency diff now. Will report back shortly." },
    { id: 'r_t1c1_3', authorName: 'Juan Foley', timestamp: '9:41 AM', body: "Thanks @Daniel Stanton. I'll hold off on re-triggering until we know what changed." },
    { id: 'r_t1c1_4', authorName: 'You', timestamp: '9:48 AM', body: "Pausing the mainline build queue while you investigate so we don't pile up failed runs. Will reopen it once you've identified the bad dep." },
  ],
  t1_c2: [
    { id: 'r_t1c2_1', authorName: 'Juan Foley', timestamp: '11:15 AM', body: "Nice catch. That explains the resolution failures too." },
    { id: 'r_t1c2_2', authorName: 'Amie Miles', timestamp: '11:28 AM', body: "Confirmed - pinning to 14.x fixed it on my branch as well." },
  ],
  t1_c3: [
    { id: 'r_t1c3_1', authorName: 'Juan Foley', timestamp: '10:12 AM', body: "Great work. The npmrc guard is a smart preventive measure." },
    { id: 'r_t1c3_2', authorName: 'Amie Miles', timestamp: '10:20 AM', body: "Agreed. Should we add similar guards for other critical packages?" },
    { id: 'r_t1c3_3', authorName: 'Daniel Stanton', timestamp: '10:35 AM', body: "I'll create a list of packages that should have major-version pinning. Will share in the next standup." },
    { id: 'r_t1c3_4', authorName: 'Juan Foley', timestamp: '10:42 AM', body: "Perfect. Let's also add it to the onboarding doc so new devs know about the policy." },
  ],
  t1_c4: [
    { id: 'r_t1c4_1', authorName: 'Amie Miles', timestamp: '12:05 PM', body: "Looking at the health check config now. The timeout was never updated when we bumped memory." },
    { id: 'r_t1c4_2', authorName: 'Daniel Stanton', timestamp: '12:18 PM', body: "Makes sense. The container takes longer to start with the higher memory allocation." },
    { id: 'r_t1c4_3', authorName: 'You', timestamp: '12:30 PM', body: "Bumping the timeout to 60s and adding a startup probe so we don't get false negatives during the boot window. PR going up shortly." },
  ],
  t1_c5: [
    { id: 'r_t1c5_1', authorName: 'Juan Foley', timestamp: '2:30 PM', body: "PR approved and merged. Staging deploy is green now." },
  ],

  // ── Topic 2: Launch checklist for v2 of the mobile app ──
  t2_c1: [
    { id: 'r_t2c1_1', authorName: 'Greg Bothman', timestamp: '10:18 AM', body: "I'll own the App Store submission and the marketing assets coordination. Will track the Apple review status here." },
    { id: 'r_t2c1_2', authorName: 'Zack Bright', timestamp: '10:24 AM', body: "Taking QA sign-off on P0/P1. Will share the bug board snapshot daily until launch." },
    { id: 'r_t2c1_3', authorName: 'Daniel Stanton', timestamp: '10:32 AM', body: "I'll set up the feature flags at 10% and monitor the rollout dashboard. Easy to dial up or back depending on signal." },
    { id: 'r_t2c1_4', authorName: 'Amie Miles', timestamp: '10:41 AM', body: "Analytics verification on me. I'll do a full event walk-through against the production mirror Wednesday." },
    { id: 'r_t2c1_5', authorName: 'Alice Johnson', timestamp: '11:02 AM', body: "I can brief support and put together the edge-case doc. Can we get the known-issues list locked by Friday so I have time?" },
    { id: 'r_t2c1_6', authorName: 'Hallie Pratt', timestamp: '11:15 AM', body: "Friday works. I'll keep the known-issues doc up to date as QA progresses through the P1 list." },
    { id: 'r_t2c1_7', authorName: 'You', timestamp: '11:30 AM', body: "Tracking the rollout dashboard end-to-end with @Daniel Stanton on the eng side. I'll post the daily go/no-go summary here at 5pm UK time so EU and SF have context overnight." },
  ],
  t2_c2: [
    { id: 'r_t2c2_1', authorName: 'Hallie Pratt', timestamp: '11:00 AM', body: "Agreed it's tight. I'll push QA to prioritize the submission-blocking P0s above everything else this week." },
    { id: 'r_t2c2_2', authorName: 'Zack Bright', timestamp: '11:18 AM', body: "Two of the P0s are mine. I can have both ready for QA by end of day Wednesday if I drop the analytics refactor." },
    { id: 'r_t2c2_3', authorName: 'Greg Bothman', timestamp: '11:30 AM', body: "Drop the refactor. We can pick it up post-launch. Submission timeline is the priority." },
  ],
  t2_c3: [
    { id: 'r_t2c3_1', authorName: 'Zack Bright', timestamp: '9:40 AM', body: "On P0-1. The 16.1 crash is reproducible on my device, looking at the biometrics handler now." },
    { id: 'r_t2c3_2', authorName: 'Greg Bothman', timestamp: '9:55 AM', body: "P0-2 - pulling in Nina, this looks like the SNS topic ARN we suspected last sprint." },
    { id: 'r_t2c3_3', authorName: 'Hallie Pratt', timestamp: '10:10 AM', body: "Let's huddle on the SNS config. The Frankfurt endpoint should be configured but the routing needs another set of eyes." },
    { id: 'r_t2c3_4', authorName: 'Daniel Stanton', timestamp: '10:30 AM', body: "I can help with the EU notification debugging if it's useful. I worked on the original SNS setup." },
    { id: 'r_t2c3_5', authorName: 'Hallie Pratt', timestamp: '10:45 AM', body: "Tom that would help, thanks. Will pull you in once Carlos and I have narrowed it down." },
  ],
  t2_c4: [
    { id: 'r_t2c4_1', authorName: 'Hallie Pratt', timestamp: '1:25 PM', body: "Reviewing now. Looks clean - null check is in the right place." },
    { id: 'r_t2c4_2', authorName: 'Daniel Stanton', timestamp: '1:48 PM', body: "Approved. One nit on the test naming but nothing blocking. Good to merge." },
  ],
  t2_c5: [
    { id: 'r_t2c5_1', authorName: 'Hallie Pratt', timestamp: '4:45 PM', body: "Right call. Better to ship a quieter launch than a broken one. Marketing is realigned." },
    { id: 'r_t2c5_2', authorName: 'Zack Bright', timestamp: 'Just now', body: "P0-2 root cause confirmed: SNS topic was provisioned in the wrong AZ. Fix is a config change, no code. Should be ready by EOD.", isNew: true },
  ],
  t2_c6: [
    { id: 'r_t2c6_1', authorName: 'Greg Bothman', timestamp: '11:15 AM', body: "Huge relief. Thanks for the late hours on this Nina." },
    { id: 'r_t2c6_2', authorName: 'Zack Bright', timestamp: '11:22 AM', body: "Verified push notifications on my EU test device this morning. All flowing as expected." },
    { id: 'r_t2c6_3', authorName: 'Daniel Stanton', timestamp: '11:35 AM', body: "Great work team. I'll keep an eye on the SNS metrics for the first 48 hours post-launch just in case." },
    { id: 'r_t2c6_4', authorName: 'Hallie Pratt', timestamp: '11:50 AM', body: "Appreciate it. Submitting now - fingers crossed on a clean review." },
  ],
  t2_c7: [
    { id: 'r_t2c7_1', authorName: 'Hallie Pratt', timestamp: '4:00 PM', body: "Excellent. I'll add a status check to tomorrow's standup so we don't miss any updates from Apple." },
    { id: 'r_t2c7_2', authorName: 'Zack Bright', timestamp: '4:12 PM', body: "On standby for any quick fixes if the review surfaces something. Phone notifications on for App Store Connect." },
  ],

  // ── Topic 3: Ongoing onboarding issues ──
  t3_c1: [
    { id: 'r_t3c1_1', authorName: 'Jake Walter', timestamp: '9:30 AM', body: "As complaints requirements become more strict, we had to introduce additional steps in our onboarding flow.\nThese steps are creating lots of friction. As we were on tight schedule, we didn't have time to tweak it. The quality for sure went down." },
    { id: 'r_t3c1_2', authorName: 'Jake Walter', timestamp: '9:32 AM', body: "We need to review the whole flow, identify the biggest issues and then try to improve current state." },
    { id: 'r_t3c1_3', authorName: 'You', timestamp: '9:45 AM', body: "Understand. It was tight deadline.\nKeep me in the loop once you're done with the review." },
  ],
  t3_c2: [
    { id: 'r_t3c2_1', authorName: 'Jake Walter', timestamp: '10:30 AM', body: "41% drop-off is worse than I expected. The liveness check was always clunky but I didn't realize it had gotten this bad." },
    { id: 'r_t3c2_2', authorName: 'Alice Johnson', timestamp: '10:45 AM', body: "I've seen the session recordings. Users are literally giving up after the third failed attempt. The error copy doesn't help at all." },
    { id: 'r_t3c2_3', authorName: 'Greg Bothman', timestamp: '11:00 AM', body: "Agreed. I'll start scoping the SDK upgrade path today. Should have a timeline by EOD." },
  ],
  t3_c3: [
    { id: 'r_t3c3_1', authorName: 'Jake Walter', timestamp: '11:25 AM', body: "Makes sense to ship the SDK upgrade first. Quick win with measurable impact." },
    { id: 'r_t3c3_2', authorName: 'Alice Johnson', timestamp: '11:40 AM', body: "I'll start on the UX designs in parallel so we're ready to go right after." },
  ],
  t3_c4: [
    { id: 'r_t3c4_1', authorName: 'Greg Bothman', timestamp: '2:00 PM', body: "Option A is cleaner. Agree on the accessibility point too." },
    { id: 'r_t3c4_2', authorName: 'Jake Walter', timestamp: '2:10 PM', body: "Option A for sure. The animation in B might actually add confusion for users who are already struggling." },
    { id: 'r_t3c4_3', authorName: 'Alice Johnson', timestamp: '2:20 PM', body: "Going with A then. I'll finalize the assets today." },
    { id: 'r_t3c4_4', authorName: 'You', timestamp: '2:45 PM', body: "Looks great. Simple and clear - exactly what we need here." },
    // The unread tail.
    { id: 'r_t3c4_5', authorName: 'Daniel Stanton', timestamp: '2:50 PM', body: "Late to this - did we consider a hybrid? Static frames that advance on tap. Keeps it lightweight but still shows motion.", isNew: true },
    { id: 'r_t3c4_6', authorName: 'Alice Johnson', timestamp: '2:58 PM', body: "Considered it, but tap-to-advance adds an interaction step exactly where users are already failing. I want zero extra input on this screen.", isNew: true },
    { id: 'r_t3c4_7', authorName: 'Greg Bothman', timestamp: '3:05 PM', body: "Data point: 68% of the drop-off sessions are on devices older than 3 years. Whatever we pick has to render instantly.", isNew: true },
    { id: 'r_t3c4_8', authorName: 'Daniel Stanton', timestamp: '3:12 PM', body: "Fair. A static sequence wins on render cost, no contest.", isNew: true },
    { id: 'r_t3c4_9', authorName: 'Alice Johnson', timestamp: '3:30 PM', body: "Assets for Option A are done. Exported all three steps to the Onboarding v2 file, Guidance page.", isNew: true },
    { id: 'r_t3c4_10', authorName: 'Jake Walter', timestamp: '3:40 PM', body: "Reviewed. Step 2's caption still reads too technical: 'Align facial features within the boundary'. Can we humanize?", isNew: true },
    { id: 'r_t3c4_11', authorName: 'Alice Johnson', timestamp: '3:48 PM', body: "Changed to 'Center your face in the frame'. Also bumped the outline contrast per the accessibility check.", isNew: true },
    { id: 'r_t3c4_12', authorName: 'Greg Bothman', timestamp: '3:55 PM', body: "Perfect. This is ready to fold into the spec.", isNew: true },
  ],
  t3_c5: [
    { id: 'r_t3c5_1', authorName: 'Greg Bothman', timestamp: '3:15 PM', body: "Good catch. That redirect back to the start is probably responsible for a chunk of the drop-off on its own." },
    { id: 'r_t3c5_2', authorName: 'Alice Johnson', timestamp: '3:25 PM', body: "Adding it to the spec now. Should be a small change on the frontend." },
  ],
  t3_c6: [
    { id: 'r_t3c6_1', authorName: 'Jake Walter', timestamp: '4:20 PM', body: "Spec looks solid. Let's make sure QA has the older Android devices covered in the test matrix." },
    { id: 'r_t3c6_2', authorName: 'Greg Bothman', timestamp: '4:30 PM', body: "Will flag Raj on the SDK PR as soon as it's up. Should be ready for review tomorrow morning." },
  ],

  // ── Topic 4: Remote work policy clarifications ──
  t4_c1: [
    { id: 'r_t4c1_1', authorName: 'Zack Bright', timestamp: '11:25 AM', body: "Thanks for the clarity. The 30-day international cap is helpful - I've been getting questions from a few teammates about that specifically." },
    { id: 'r_t4c1_2', authorName: 'Hallie Pratt', timestamp: '12:10 PM', body: "Quick one on the equipment reimbursement: does it cover ergonomic chairs and monitors or only desk accessories?" },
    { id: 'r_t4c1_3', authorName: 'Amie Miles', timestamp: '12:30 PM', body: "Maya - chairs and monitors both qualify, as does any other ergonomic equipment with a manager sign-off. Receipts go to HR via the portal." },
    { id: 'r_t4c1_4', authorName: 'Daniel Stanton', timestamp: '1:15 PM', body: "Appreciate the policy refresh. Clear guidance makes this much easier to plan around." },
  ],
  t4_c2: [
    { id: 'r_t4c2_1', authorName: 'Hallie Pratt', timestamp: '2:48 PM', body: "Same question here. School holiday coverage is a real factor for me too." },
    { id: 'r_t4c2_2', authorName: 'Amie Miles', timestamp: '3:05 PM', body: "Good question. Let me check with leadership and come back tomorrow with a definitive answer." },
  ],
  t4_c3: [
    { id: 'r_t4c3_1', authorName: 'Zack Bright', timestamp: '10:00 AM', body: "Brilliant news, thanks for chasing this down so quickly Emma." },
  ],

  // ── Topic 5: Usability test results for the dashboard redesign ──
  t5_c1: [
    { id: 'r_t5c1_1', authorName: 'Daniel Stanton', timestamp: '3:25 PM', body: "Export button discoverability is the most actionable. We can move that to the toolbar this sprint." },
    { id: 'r_t5c1_2', authorName: 'Alice Johnson', timestamp: '3:40 PM', body: "The notification badge being mistaken for a button is interesting. We might want a visual treatment that signals 'status' rather than 'action'." },
    { id: 'r_t5c1_3', authorName: 'Juan Foley', timestamp: '3:52 PM', body: "Chart legend zoom behavior is concerning. If 4 of 8 needed to zoom, that's an accessibility issue not just a polish one." },
    { id: 'r_t5c1_4', authorName: 'Alice Johnson', timestamp: '4:05 PM', body: "Agreed Liam - I'll make the legend size change a priority alongside the export fix." },
    { id: 'r_t5c1_5', authorName: 'Amie Miles', timestamp: '4:18 PM', body: "Card-over-table preference is a great validation. Glad the redesign is landing on that point." },
  ],
  t5_c2: [
    { id: 'r_t5c2_1', authorName: 'Alice Johnson', timestamp: '4:30 PM', body: "Let me check the design tokens - I want to align it with the rest of the chart spec rather than picking a number in isolation." },
    { id: 'r_t5c2_2', authorName: 'Daniel Stanton', timestamp: '4:40 PM', body: "Sounds good. I'll hold off on the legend ticket until you confirm the size." },
  ],
  t5_c3: [
    { id: 'r_t5c3_1', authorName: 'Daniel Stanton', timestamp: '10:45 AM', body: "Updating the legend ticket now with 12px and the line-height fix. Should be quick." },
    { id: 'r_t5c3_2', authorName: 'Alice Johnson', timestamp: '11:00 AM', body: "Good call on the badge repositioning. Consistency with the rest of the app will help reduce that 'is this a button?' confusion." },
    { id: 'r_t5c3_3', authorName: 'Juan Foley', timestamp: '11:20 AM', body: "Nice. The line-height observation is a good catch - easy to miss when you're focused on font size." },
  ],
  t5_c4: [
    { id: 'r_t5c4_1', authorName: 'Daniel Stanton', timestamp: '2:15 PM', body: "Great summary. All four tickets pulled into the next sprint. We should be able to ship this together." },
  ],

  // ── Topic 6: Show your pet! ──
  t6_c1: [
    { id: 'r_t6c1_1', authorName: 'Jake Walter', timestamp: '9:12 AM', body: "Mochi is a national treasure. The cat-cosplay is unmatched." },
    { id: 'r_t6c1_2', authorName: 'Hallie Pratt', timestamp: '9:18 AM', body: "The selective listening is universal in shibas. Mine pretends she can't hear the word 'bath'." },
    { id: 'r_t6c1_3', authorName: 'Alice Johnson', timestamp: '9:25 AM', body: "He sits in boxes?? Iconic." },
    { id: 'r_t6c1_4', authorName: 'Daniel Stanton', timestamp: '9:30 AM', body: "Day made. Best kickoff to a Friday I've had in a while." },
    { id: 'r_t6c1_5', authorName: 'Greg Bothman', timestamp: '9:38 AM', body: "I'm endorsing this thread on principle. Need a Mochi in my life." },
    { id: 'r_t6c1_6', authorName: 'Zack Bright', timestamp: '9:45 AM', body: "Shibas in boxes is cinema. Send more." },
    { id: 'r_t6c1_7', authorName: 'Juan Foley', timestamp: '9:50 AM', body: "The committed bit is what makes it. He believes." },
    { id: 'r_t6c1_8', authorName: 'Amie Miles', timestamp: '10:02 AM', body: "Mochi's vibe is exactly what I needed before this 10am meeting." },
    { id: 'r_t6c1_9', authorName: 'Alice Johnson', timestamp: '10:15 AM', body: "Knocking things off tables is the cat tax he had to pay to keep up the bit." },
    { id: 'r_t6c1_10', authorName: 'Hallie Pratt', timestamp: '10:30 AM', body: "Stop I love him. We need a Mochi cam in the channel." },
    { id: 'r_t6c1_11', authorName: 'Greg Bothman', timestamp: '10:48 AM', body: "Excellent decision starting this thread Maya. Long overdue." },
    { id: 'r_t6c1_12', authorName: 'You', timestamp: '11:05 AM', body: "Officially the highlight of my week and it's only Friday morning." },
  ],
  t6_c2: [
    { id: 'r_t6c2_1', authorName: 'Hallie Pratt', timestamp: '9:40 AM', body: "Pretzel is a vibe. Greyhounds really are 90% nap, 10% rocket." },
    { id: 'r_t6c2_2', authorName: 'Alice Johnson', timestamp: '9:48 AM', body: "Retired racers are the sweetest. Look at that face." },
    { id: 'r_t6c2_3', authorName: 'Hallie Pratt', timestamp: '9:55 AM', body: "He looked offended - I am crying." },
    { id: 'r_t6c2_4', authorName: 'Daniel Stanton', timestamp: '10:05 AM', body: "Same energy as my standup attendance honestly." },
    { id: 'r_t6c2_5', authorName: 'Greg Bothman', timestamp: '10:18 AM', body: "Two-speed dog culture is the only culture." },
    { id: 'r_t6c2_6', authorName: 'Zack Bright', timestamp: '10:30 AM', body: "Pretzel is iconic. Bookmarking this thread." },
    { id: 'r_t6c2_7', authorName: 'Juan Foley', timestamp: '10:45 AM', body: "Look at the way he's lying there. That's a dog who has earned his retirement." },
    { id: 'r_t6c2_8', authorName: 'Amie Miles', timestamp: '11:02 AM', body: "All sprint, no walk. Big mood." },
  ],
  t6_c3: [
    { id: 'r_t6c3_1', authorName: 'Hallie Pratt', timestamp: '10:25 AM', body: "Senior dogs ARE undefeated. Biscuit is a queen." },
    { id: 'r_t6c3_2', authorName: 'Jake Walter', timestamp: '10:38 AM', body: "Postman radar through pure vibes alone. Incredible." },
    { id: 'r_t6c3_3', authorName: 'Alice Johnson', timestamp: '10:52 AM', body: "14 and still on duty. Respect Biscuit." },
    { id: 'r_t6c3_4', authorName: 'Daniel Stanton', timestamp: '11:05 AM', body: "There's a special kind of intuition that older dogs develop. She's tapped in." },
    { id: 'r_t6c3_5', authorName: 'Greg Bothman', timestamp: '11:18 AM', body: "Look at that grey muzzle. I'd protect Biscuit with my life." },
    { id: 'r_t6c3_6', authorName: 'Zack Bright', timestamp: '11:30 AM', body: "Senior dog supremacy. This is the hill." },
  ],
  t6_c4: [
    { id: 'r_t6c4_1', authorName: 'Hallie Pratt', timestamp: '11:55 AM', body: "Noodle on a client call is my ideal meeting structure." },
    { id: 'r_t6c4_2', authorName: 'Jake Walter', timestamp: '12:10 PM', body: "'Can she stay?' is the only correct response. Top tier client." },
    { id: 'r_t6c4_3', authorName: 'Hallie Pratt', timestamp: '12:25 PM', body: "Cats on keyboards is the universal designer experience." },
    { id: 'r_t6c4_4', authorName: 'Daniel Stanton', timestamp: '12:40 PM', body: "Noodle clearly understood the meeting was important and chose to attend." },
    { id: 'r_t6c4_5', authorName: 'Greg Bothman', timestamp: '12:55 PM', body: "Tabbies have a sixth sense for the warmest spot in any room." },
    { id: 'r_t6c4_6', authorName: 'Zack Bright', timestamp: '1:10 PM', body: "She joined uninvited and stayed. That's the move." },
    { id: 'r_t6c4_7', authorName: 'Juan Foley', timestamp: '1:25 PM', body: "Noodle is now technically a coworker. We need to onboard her properly." },
    { id: 'r_t6c4_8', authorName: 'Alice Johnson', timestamp: '1:40 PM', body: "I love this thread so much. Noodle is precious." },
    { id: 'r_t6c4_9', authorName: 'Amie Miles', timestamp: '2:00 PM', body: "Rescue tabbies are the best tabbies. So glad she found you." },
  ],
  t6_c5: [
    { id: 'r_t6c5_1', authorName: 'Hallie Pratt', timestamp: '9:15 AM', body: "Naming a cat after a streaming framework is exactly the energy I expected from you Tom." },
    { id: 'r_t6c5_2', authorName: 'Jake Walter', timestamp: '9:28 AM', body: "Kafka evaluating PR descriptions is the most accurate review process this team has." },
    { id: 'r_t6c5_3', authorName: 'Alice Johnson', timestamp: '9:42 AM', body: "Usually unimpressed is the correct stance on most PRs honestly." },
    { id: 'r_t6c5_4', authorName: 'Greg Bothman', timestamp: '9:55 AM', body: "I want Kafka on my next code review. Add him as a required approver." },
    { id: 'r_t6c5_5', authorName: 'Hallie Pratt', timestamp: '10:10 AM', body: "Cats sitting beside monitors is just remote work supervision and I respect it." },
    { id: 'r_t6c5_6', authorName: 'Juan Foley', timestamp: '10:25 AM', body: "Kafka has standards. We should learn from him." },
    { id: 'r_t6c5_7', authorName: 'Zack Bright', timestamp: '10:40 AM', body: "I would trust Kafka's code review over half the bots we have." },
  ],
  t6_c6: [
    { id: 'r_t6c6_1', authorName: 'Hallie Pratt', timestamp: '10:45 AM', body: "Corgis on patrol is a public service. Dumpling protects." },
    { id: 'r_t6c6_2', authorName: 'Jake Walter', timestamp: '11:00 AM', body: "3am structural integrity inspections are non-negotiable apparently." },
    { id: 'r_t6c6_3', authorName: 'Alice Johnson', timestamp: '11:15 AM', body: "Look at that little body. She is pure mission." },
    { id: 'r_t6c6_4', authorName: 'Daniel Stanton', timestamp: '11:30 AM', body: "Dumpling sounds like she could use a co-patroller. Kafka is available for night shifts." },
    { id: 'r_t6c6_5', authorName: 'Hallie Pratt', timestamp: '11:45 AM', body: "Every house needs a Dumpling. The 3am thing is a feature, not a bug." },
  ],
  t6_c7: [
    { id: 'r_t6c7_1', authorName: 'Hallie Pratt', timestamp: '1:30 PM', body: "Theorem!! Best name and best dog. Your daughter is brilliant." },
    { id: 'r_t6c7_2', authorName: 'Jake Walter', timestamp: '1:45 PM', body: "Goldens have zero concept of personal space and that's why we love them." },
    { id: 'r_t6c7_3', authorName: 'Greg Bothman', timestamp: '2:00 PM', body: "Working from home with a 2-year-old golden is its own form of cardio." },
    { id: 'r_t6c7_4', authorName: 'Juan Foley', timestamp: '2:15 PM', body: "Theorem looks like he has never had a single negative thought in his life." },
  ],
  t6_c8: [
    { id: 'r_t6c8_1', authorName: 'Hallie Pratt', timestamp: '3:15 PM', body: "Sudo is THE name. Your partner held the line on rm -rf and that's the right call." },
    { id: 'r_t6c8_2', authorName: 'Jake Walter', timestamp: '3:30 PM', body: "Border collie faster than any build pipeline checks out. They never stop." },
    { id: 'r_t6c8_3', authorName: 'Alice Johnson', timestamp: '3:45 PM', body: "Root access to the sofa is the correct level of permissions for Sudo." },
    { id: 'r_t6c8_4', authorName: 'Hallie Pratt', timestamp: '4:00 PM', body: "Best pet name in the thread, hands down. Closes it perfectly." },
    { id: 'r_t6c8_5', authorName: 'Daniel Stanton', timestamp: '4:15 PM', body: "Border collies need a job. Looks like Sudo's job is winning." },
    { id: 'r_t6c8_6', authorName: 'Zack Bright', timestamp: '4:30 PM', body: "What a thread. Going back to the top to scroll through every photo again." },
  ],

  // ── Topic 7: Updates on the new office layout ──
  t7_c1: [
    { id: 'r_t7c1_1', authorName: 'Zack Bright', timestamp: '10:30 AM', body: "Floor plan looks great. Good to see the focus rooms finally happening - those have been requested for ages." },
    { id: 'r_t7c1_2', authorName: 'Hallie Pratt', timestamp: '10:45 AM', body: "Excited about the standing desks. Will those be reservable or strictly first-come?" },
    { id: 'r_t7c1_3', authorName: 'Hallie Pratt', timestamp: '11:00 AM', body: "Standing desks are first-come for now. We'll reassess after a month based on usage data." },
    { id: 'r_t7c1_4', authorName: 'Daniel Stanton', timestamp: '11:15 AM', body: "Second coffee station is the real headline. Mornings are about to improve significantly." },
    { id: 'r_t7c1_5', authorName: 'Alice Johnson', timestamp: '11:25 AM', body: "Will there be any quiet zones on Floor 2 or is it all collaborative space?" },
  ],
  t7_c2: [
    { id: 'r_t7c2_1', authorName: 'Zack Bright', timestamp: '11:45 AM', body: "Same. I've been arriving at 8:30 just to find a spot, which is unsustainable." },
    { id: 'r_t7c2_2', authorName: 'Hallie Pratt', timestamp: '12:00 PM', body: "Working on it actively. Will have a parking update in the next post." },
    { id: 'r_t7c2_3', authorName: 'Hallie Pratt', timestamp: '12:20 PM', body: "Could we get a temporary deal with the Meridian garage two blocks away while construction finishes?" },
  ],
  t7_c3: [
    { id: 'r_t7c3_1', authorName: 'Hallie Pratt', timestamp: '2:35 PM', body: "Both good questions. I'll cover them in the parking update tomorrow." },
  ],
  t7_c4: [
    { id: 'r_t7c4_1', authorName: 'Greg Bothman', timestamp: '9:30 AM', body: "Brilliant - the Meridian solution and shuttle answer my question completely. Thanks Jen." },
    { id: 'r_t7c4_2', authorName: 'Zack Bright', timestamp: '9:45 AM', body: "15-minute minimum is perfect for quick calls. Appreciate the flexibility on same-day booking too." },
  ],

  // ── Topic 8: Quick fix needed for staging deployment issue ──
  t8_c1: [
    { id: 'r_t8c1_1', authorName: 'Amie Miles', timestamp: '2:08 PM', body: "On it. Pulling up the deploy logs now." },
  ],
  t8_c2: [
    { id: 'r_t8c2_1', authorName: 'Juan Foley', timestamp: '2:25 PM', body: "Lifesaver. Thanks for the fast turnaround Sara." },
    { id: 'r_t8c2_2', authorName: 'Daniel Stanton', timestamp: '2:32 PM', body: "We should add a check for this in the deploy pipeline. Missing env vars shouldn't take down staging." },
  ],
  t8_c3: [
    { id: 'r_t8c3_1', authorName: 'Juan Foley', timestamp: '3:00 PM', body: "Perfect. Will review the PR after the demo." },
  ],

  // ── Topic 9: Feedback on mobile onboarding flow ──
  t9_c1: [
    { id: 'r_t9c1_1', authorName: 'Zack Bright', timestamp: '11:20 AM', body: "Recordings would be great. Especially for the 'You're all set' confusion - I want to see how users hesitate." },
    { id: 'r_t9c1_2', authorName: 'Jake Walter', timestamp: '11:45 AM', body: "All three of these are fixable in one sprint if we coordinate. Worth lining up." },
    { id: 'r_t9c1_3', authorName: 'Greg Bothman', timestamp: '12:05 PM', body: "Good findings Alice. The notification timing one in particular is something I've seen across other onboarding flows too." },
  ],
  t9_c2: [
    { id: 'r_t9c2_1', authorName: 'Alice Johnson', timestamp: '12:50 PM', body: "Great. I'll update the spec to mark first task completion as the trigger so it's documented for QA." },
    { id: 'r_t9c2_2', authorName: 'Jake Walter', timestamp: '1:10 PM', body: "Makes sense. Notification permission asked at the right moment converts a lot better in the data I've seen." },
  ],
  t9_c3: [
    { id: 'r_t9c3_1', authorName: 'Alice Johnson', timestamp: '2:18 PM', body: "Agreed. I'll mock up a 'Go to dashboard' primary CTA along with a secondary 'Take a tour' option for that screen." },
  ],
  t9_c4: [
    { id: 'r_t9c4_1', authorName: 'Jake Walter', timestamp: '10:20 AM', body: "Mocks look great. The 'Go to dashboard' / 'Take a tour' pairing is exactly the right call." },
    { id: 'r_t9c4_2', authorName: 'Zack Bright', timestamp: '10:35 AM', body: "Implementation should be straightforward on all three. I'll start on the notification timing change today." },
    { id: 'r_t9c4_3', authorName: 'Greg Bothman', timestamp: '10:50 AM', body: "Strong work Alice. Clear path forward and addresses all the friction points cleanly." },
    { id: 'r_t9c4_4', authorName: 'Alice Johnson', timestamp: '11:05 AM', body: "Thanks all. Let me know if anything needs adjustment once you start implementing." },
  ],
  t9_c5: [
    { id: 'r_t9c5_1', authorName: 'Alice Johnson', timestamp: '12:10 PM', body: "Good catch. I'd lean toward the layout fix over a floating button - floating buttons can feel out of place in a form context." },
    { id: 'r_t9c5_2', authorName: 'Zack Bright', timestamp: '12:25 PM', body: "Agreed on the layout fix. Floating button has its own accessibility tradeoffs we'd want to avoid." },
  ],
  t9_c6: [
    { id: 'r_t9c6_1', authorName: 'Alice Johnson', timestamp: '3:00 PM', body: "Layout fix is the right call. No need to swap. Will review the PR shortly." },
  ],

  // ── DM conversations ──
  dm1_c3: [
    { id: 'r_dm1c3_1', authorName: 'Alice Johnson', timestamp: '3:45 PM', body: "That explains the pattern we were seeing in the support tickets. All the complaints were coming from EU-based customers during morning hours." },
    { id: 'r_dm1c3_2', authorName: 'You', timestamp: '4:02 PM', body: "Exactly. I've filed an infra ticket to scale the verification service in EU-West-1 during peak hours." },
  ],
  dm1_c4: [
    { id: 'r_dm1c4_1', authorName: 'Alice Johnson', timestamp: '10:20 AM', body: "Perfect, closing it out now. The customer already confirmed on their end." },
  ],
  dm1_c5: [
    { id: 'r_dm1c5_1', authorName: 'Alice Johnson', timestamp: '2:15 PM', body: "Good call raising this. The job queue approach makes more sense for our scale." },
    { id: 'r_dm1c5_2', authorName: 'You', timestamp: '2:22 PM', body: "Yeah, and it gives us a path to add progress indicators later without reworking the architecture." },
    { id: 'r_dm1c5_3', authorName: 'Alice Johnson', timestamp: '2:35 PM', body: "Design team is already on board. They'll have mocks ready by Thursday." },
  ],
  dm2_c3: [
    { id: 'r_dm2c3_1', authorName: 'Daniel Stanton', timestamp: '5:00 PM', body: "This is exactly what I needed. The retention segmentation by acquisition channel is particularly strong for the board narrative." },
  ],
  dm3_c1: [
    { id: 'r_dm3c1_1', authorName: 'Hallie Pratt', timestamp: 'Just now', body: "Actually one thing - the CMO is flying in Tuesday morning and wants 15 minutes on this before her flight. Can you prep a one-pager today? I know it's short notice but she's the one championing this internally.", isNew: true, isUrgent: true },
  ],
  dm3_c2: [
    { id: 'r_dm3c2_1', authorName: 'Hallie Pratt', timestamp: '4:40 PM', body: "Go through me directly, easier to coordinate. I'll loop in my EA once we have a date locked." },
  ],
  dm4_c2: [
    { id: 'r_dm4c2_1', authorName: 'You', timestamp: '4:00 PM', body: "Good catch on segmenting by region. I'll pull the EU-West-1 error logs and see if there's an infra story behind it." },
    { id: 'r_dm4c2_2', authorName: 'Greg Bothman', timestamp: '4:25 PM', body: "Appreciate it. If it's an infra issue we can rule out UX changes and save the team a cycle of speculation." },
  ],
  dm4_c3: [
    { id: 'r_dm4c3_1', authorName: 'Greg Bothman', timestamp: '10:30 AM', body: "Will take a look at the Figma drafts before lunch. Glad the export feedback landed in the right place." },
  ],
  dm4_c4: [
    { id: 'r_dm4c4_1', authorName: 'You', timestamp: '2:05 PM', body: "Job queue is the right call for our scale. I'll back you in the room if the discussion drifts toward pagination." },
    { id: 'r_dm4c4_2', authorName: 'Greg Bothman', timestamp: '2:20 PM', body: "Thanks. Having both options written up should keep the conversation focused." },
  ],
  dm5_c2: [
    { id: 'r_dm5c2_1', authorName: 'Juan Foley', timestamp: '3:00 PM', body: "Good calls - both noted. I'll have fixes in by end of day tomorrow and ping you for a once-over before the beta release." },
    { id: 'r_dm5c2_2', authorName: 'Juan Foley', timestamp: 'Just now', body: "Funnel filter fix is on staging - want to give it a quick smoke test before I roll forward?", isNew: true },
  ],
  dm6_c1: [
    { id: 'r_dm6c1_1', authorName: 'You', timestamp: '12:05 PM', body: "October pairing with @Daniel Stanton works for me - we're already overlapping on the auth migration so the context will carry over. Only week I have to dodge is the 21st (team offsite)." },
  ],
  dm7_c1: [
    { id: 'r_dm7c1_1', authorName: 'You', timestamp: '2:32 PM', body: "That's a steep enough drop that I'd want to rule out an instrumentation issue before we treat it as a real funnel regression. Did anything ship on the email template around the same window?" },
    { id: 'r_dm7c1_2', authorName: 'Zack Bright', timestamp: '2:48 PM', body: "Good call. Checking the deployment log against the activation event volume now - if the tag broke during the redesign that would explain why only the email cohort moved." },
  ],
  dm7_c2: [
    { id: 'r_dm7c2_1', authorName: 'Zack Bright', timestamp: '4:05 PM', body: "Confirmed - event volume cratered for the email cohort exactly when the redesign shipped. Tagging issue, not a real drop. I'll patch the wrapper and re-baseline." },
  ],

  // ── Huddle conversations ──
  h1_1_c1: [
    { id: 'r_h1_1_1', authorName: 'Juan Foley', timestamp: '9:48 AM', body: "Just checked. The mismatch is only in package-lock.json, not yarn.lock. We're on npm so that's the one that matters." },
    { id: 'r_h1_1_2', authorName: 'You', timestamp: '9:51 AM', body: "Same on my branch. Pinning to 14.x sounds right - can we also add an npmrc guard so this doesn't sneak back in on the next bump?" },
    { id: 'r_h1_1_3', authorName: 'Daniel Stanton', timestamp: '9:55 AM', body: "Good, so it's just the one package. I'll pin @testing-library/react to 14.x and push. Should be safe." },
    { id: 'r_h1_1_4', authorName: 'Juan Foley', timestamp: '10:02 AM', body: "Confirmed green on my branch after the pin. Go ahead and post to the topic." },
  ],
  h2_1_c1: [
    { id: 'r_h2_1_1', authorName: 'Greg Bothman', timestamp: '9:45 AM', body: "Just pulled up the AWS console. You're right, the topic ARN is pointing to us-east-1 instead of eu-west-1." },
    { id: 'r_h2_1_2', authorName: 'Hallie Pratt', timestamp: '9:52 AM', body: "That explains why it works in dev but not production. Dev uses a single-region setup." },
    { id: 'r_h2_1_3', authorName: 'Greg Bothman', timestamp: '10:05 AM', body: "Fix is straightforward. I'll update the ARN in the environment config and test in staging before we involve the backend team." },
    { id: 'r_h2_1_4', authorName: 'Hallie Pratt', timestamp: '10:10 AM', body: "Perfect. Let me know when staging is verified and I'll update the topic." },
    { id: 'r_h2_1_5', authorName: 'Greg Bothman', timestamp: '11:30 AM', body: "Staging verified. Notifications flowing correctly in EU now. Posting to the topic." },
  ],
  h2_2_c1: [
    { id: 'r_h2_2_1', authorName: 'Hallie Pratt', timestamp: '10:25 AM', body: "We have a 16.0 in the device lab, second shelf." },
    { id: 'r_h2_2_2', authorName: 'Zack Bright', timestamp: '10:40 AM', body: "Found it. Testing now." },
    { id: 'r_h2_2_3', authorName: 'You', timestamp: '10:55 AM', body: "Once you've got a repro, screen-record it for the bug ticket - the crash log alone won't be enough for the platform team to triage." },
  ],
  h3_1_c1: [
    { id: 'r_h3_1_1', authorName: 'Amie Miles', timestamp: '10:01 AM', body: "There are several common approaches to liveness verification:\n\n- Active liveness: user performs an action (blink, smile, turn head)\n- Passive liveness: analysis of a single selfie for depth cues and texture\n- Hybrid: combines passive analysis with a simple active prompt\n- Document + selfie matching: compares ID photo to live capture\n\nPassive liveness has the best UX (no instructions needed) but lower security guarantees. Active liveness is more secure but creates the friction you're seeing." },
    { id: 'r_h3_1_2', authorName: 'Greg Bothman', timestamp: '10:08 AM', body: "Our current SDK uses active liveness. The 3.4.2 upgrade improves the prompts but it's still active. Is there a viable passive option we could evaluate?" },
    { id: 'r_h3_1_3', authorName: 'Amie Miles', timestamp: '10:09 AM', body: "SDK 3.4.2 does include a passive mode flag, though it's marked as beta. You could run passive for low-risk accounts and fall back to active for higher-risk ones. That would reduce friction for the majority of users while maintaining security where it matters." },
    { id: 'r_h3_1_4', authorName: 'Greg Bothman', timestamp: '10:15 AM', body: "That's a good angle. I'll propose the SDK upgrade with passive-first as the recommendation. Thanks." },
  ],
  h3_2_c1: [
    { id: 'r_h3_2_1', authorName: 'Alice Johnson', timestamp: '11:40 AM', body: "Honestly I went back and forth. The animation does show the correct head position more clearly, but it autoplays and some users will find that distracting or miss it entirely." },
    { id: 'r_h3_2_2', authorName: 'You', timestamp: '11:44 AM', body: "Strong +1 on avoiding autoplay - we got burned on that in the empty-state animation last quarter, retention numbers told us users felt rushed." },
    { id: 'r_h3_2_3', authorName: 'Greg Bothman', timestamp: '11:48 AM', body: "What if we did static illustrations but with a small 'See how' link that plays the animation on tap? Best of both." },
    { id: 'r_h3_2_4', authorName: 'Alice Johnson', timestamp: '11:55 AM', body: "I like that. Keeps the default simple but gives users a way to get more help if they need it. Let me mock that up." },
    { id: 'r_h3_2_5', authorName: 'Greg Bothman', timestamp: '12:05 PM', body: "Great. Once you have the mock we can share it in the topic. I think Jake will be on board." },
    { id: 'r_h3_2_6', authorName: 'Alice Johnson', timestamp: '1:30 PM', body: "Mock is done. Option A with the 'See how' link. Looks clean." },
    { id: 'r_h3_2_7', authorName: 'Greg Bothman', timestamp: '1:35 PM', body: "Perfect. Posting to the topic now." },
  ],
  h9_1_c1: [
    { id: 'r_h9_1_1', authorName: 'Jake Walter', timestamp: '11:45 AM', body: "Definitely the first option. Users want to feel like they've arrived somewhere, not that there's more onboarding ahead." },
    { id: 'r_h9_1_2', authorName: 'Alice Johnson', timestamp: '11:52 AM', body: "Agreed. The contextual overlay feels like we're not confident the product is self-explanatory. 'Go to dashboard' is a clean exit." },
    { id: 'r_h9_1_3', authorName: 'Jake Walter', timestamp: '12:00 PM', body: "The 'Take a tour' secondary is smart though. Catches users who do want more guidance without forcing everyone through it." },
  ],

  // ── Topic 10: Payment integration (Peek x Stripe) ──
  t10_c1: [
    { id: 'r_t10c1_1', authorName: 'Greg Bothman', timestamp: '11:40 AM', body: "Thanks for the recap. From the support side the thing I care about most is that failed payments give the customer a clear next step. A lot of our tickets are really just confused checkout." },
  ],
  t10_c2: [
    { id: 'r_t10c2_1', authorName: 'Juan Foley', timestamp: '2:52 PM', body: "Makes sense. I'll wire up Checkout on the frontend and keep our order record as the source of truth rather than trusting the redirect." },
    { id: 'r_t10c2_2', authorName: 'Amie Miles', timestamp: '3:10 PM', body: "Agreed on Checkout for v1. Let's make sure we're not blocked on their test mode keys. Can someone confirm we have them?" },
  ],
  t10_c3: [
    { id: 'r_t10c3_1', authorName: 'You', timestamp: '10:35 AM', body: "This looks great. The processing state especially, the spinner plus the short reassurance line is exactly right." },
    { id: 'r_t10c3_2', authorName: 'Daniel Stanton', timestamp: '10:48 AM', body: "One ask: can we show the last four of the card on the failure screen? Helps the customer tell which card was declined before they retry." },
  ],
  t10_c4: [
    { id: 'r_t10c4_1', authorName: 'Bob Chen', timestamp: '12:12 PM', body: "Replying in the thread so it stays in one place. Short answer, you get a decline code you can map to a friendly message, plus the raw issuer text when it's presentable." },
    { id: 'r_t10c4_2', authorName: 'You', timestamp: '12:20 PM', body: "Perfect, that's what I needed. I'll have Alice add a retry and a change-card option right on that screen." },
    { id: 'r_t10c4_3', authorName: 'Alice Johnson', timestamp: '12:31 PM', body: "On it. I'll add the last four that Daniel asked for while I'm in there." },
  ],
  t10_c6: [
    { id: 'r_t10c6_1', authorName: 'Daniel Stanton', timestamp: '3:18 PM', body: "Fully agree. I'll make the webhook handler idempotent by event id and add the reconciliation job alongside it." },
    { id: 'r_t10c6_2', authorName: 'You', timestamp: '3:26 PM', body: "Good call flagging it as blocking. Let's not launch without the reconciliation job actually running." },
  ],
  t10_c7: [
    { id: 'r_t10c7_1', authorName: 'Amie Miles', timestamp: '9:44 AM', body: "Nice. Please add a metric for how often the reconciliation job actually corrects something. I want to watch that number after launch." },
    { id: 'r_t10c7_2', authorName: 'Juan Foley', timestamp: '9:52 AM', body: "Will do. I'll add a small dashboard panel for pending-to-resolved counts." },
  ],
  t10_c8: [
    { id: 'r_t10c8_1', authorName: 'Bob Chen', timestamp: '11:10 AM', body: "Seen it. Point the Checkout return URL at a lightweight page that re-checks the payment status on load instead of assuming success. That covers the backgrounded-tab case cleanly." },
  ],
}
