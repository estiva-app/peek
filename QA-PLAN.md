# PeekApp Manual QA Strategy

## Context

You've built a lot of overlapping features fast — DMs, topics, huddles, threads, resolution, highlights, reactions, mentions, persistence — and now need to QA the whole app manually before treating it as stable. You don't have a QA engineer; you are the QA engineer, and you're worried about the combinatorial explosion (which is the right worry).

This document gives you what a seasoned QA engineer would build before testing: a mental model of how the app fits together, an exploratory test plan organized into focused sessions you can execute one at a time, a matrix of the interactions where bugs hide, and a regression checklist underneath so nothing slips through. Together they let you cover every feature in roughly 8–10 hours of testing across multiple sessions, instead of one impossible marathon.

The goal is not to write 300 test cases — it's to **understand the system well enough that you know where bugs are likely**, then probe those places systematically.

---

## How a seasoned QA engineer would approach this app

Five lenses to view every feature through. When you open any screen, ask all five:

1. **Surfaces** — where is this state shown? (a topic's resolved-ness shows in 8+ places — see matrix)
2. **Mutations** — every way the user can change this state. (resolve has 4 entry points)
3. **Persistence** — does the change survive: navigation? page refresh? StrictMode remount?
4. **Cross-feature** — what other features read/write this same state?
5. **Edge** — empty / overflow / very long / very short / none / many / boundary moments (just promoted, just resolved, just deleted)

The bugs are almost never in the simple "click button → see thing" flow. They're at the seams between features. So the test sessions below are organized **around the seams**, not around the features.

---

## Mental model — entities, state, derivations

You can't test what you don't understand. This is the spine of the app.

### Entities
- **Topic** — public space; has invitees, conversations, huddles, timeline. ID: `'1'..'9'` (mock) or `t_<ts>_<n>` (runtime).
- **Conversation** (a.k.a. Message) — top-level item inside a Topic OR a DM. Has author, body, timestamp, reactions, highlight, resolution, replies.
- **Reply** — message inside a thread on a Conversation. Same shape minus replies.
- **Huddle** — private side-space inside a Topic. Members, state, optional `originDmId` + `seedMessageId` if promoted from a DM.
- **DM** — 1:1 conversation with a Person. Numeric ID.
- **Person / Team / Starred entry** — directory + favorites.

### State surfaces (the persistent ones)
All in `TopicMutationsProvider` — keyed by IDs. **Replies and reactions are id-keyed across DMs and topics** (no namespace), so a DM message and a huddle's seed message that share the same ID share the same reply list, reactions, highlight, body, and resolution. This is intentional and crucial — it's why mirroring "just works" but also why you must test it carefully.

| Slot | Key | What it holds |
|---|---|---|
| `sentMessages` | topicId | runtime top-level messages composed in a topic |
| `deletedIds` | conv id | suppressed messages |
| `resolvedOverrides` | conv id | `{resolved, resolvedBy, message}` |
| `sentReplies` | conv id | replies composed at runtime (have `createdAtMs`) |
| `bodyOverrides` | conv-or-reply id | edited body text |
| `highlightOverrides` | conv-or-reply id | highlight type or undefined |
| `reactionOverrides` | conv-or-reply id | reactions array |
| `createdHuddles` | topicId | runtime huddles |
| `deletedHuddleIds` | huddle id | suppressed huddles |
| `huddleBodyOverrides` | huddle.conversation.id | edited huddle preview body |

### Derived state (computed, never stored)
- **`isTopicResolved(topicId)`** — every non-deleted conv resolved AND ≥ 1 conv. Single source of truth for the dashed-circle vs green-checkmark icon **everywhere**.
- **`huddleContext` for a DM message** — built on the fly by looking up huddles whose `seedMessageId === msg.id`.
- **`promotionDivider`** — built from the huddle on the seed message; partitions thread replies by `createdAtMs < promotedAtMs`.

### Local view state (resets on navigate / DM switch)
- Open thread id, selected huddle id, active topic tab, in-progress huddle creation form, edit-mode flag per card.

### One-shot signals
- `pendingDmThreadId` in `LastSelection` — staged by huddle's "Open original" before navigation, consumed once on the DM page mount.

---

## Test sessions (charters)

Each is a 30–60 min exploratory session with a **goal**, **what to probe**, and **what to specifically watch for**. Run them in roughly this order — earlier ones build context for later ones. Don't try to do all in one day; you'll miss things when fatigued.

### Session 1 — DM core
**Goal:** Verify the DM surface in isolation before any topic interaction.
**Probe:** every action on a DM message (reply, react, highlight, resolve, edit own message, delete own message, reopen, "Start topic" button visibility), the compose box (mentions, urgent, [topic, [file, slash menu, lists, Enter vs Shift+Enter, → resolve, empty + resolution-only send), star/unstar from header, switching DMs.
**Watch for:** thread panel state leaking between DMs, body edits persisting after switch, reaction/highlight persistence after switch, urgent flag rendering, scroll position.

### Session 2 — Topic core
**Goal:** Same as Session 1, on a Topic.
**Probe:** every conversation action, the open/resolved counts in header, members pill, topic tabs (Conversations / Huddles / Timeline), starring, Sort by, switching topics, navigating with last-selected memory.
**Watch for:** counts updating when you resolve/reopen, member pill including invitees + reply authors, alphabetical topic list ordering, tab state preserved per topic vs reset on navigate.

### Session 3 — Resolution-from-everywhere
**Goal:** Prove every resolution path works and updates every surface.
**Resolution paths to test (each one separately):**
1. Quick menu → Resolve → ResolveDialog → with message
2. Quick menu → Resolve → ResolveDialog → without message
3. More menu → Resolve
4. Edit message → type `→` in body → send (auto-resolves)
5. Reply panel compose → type `→` → send (resolves parent + adds reply)
6. Reopen via quick menu (when resolved)
7. Reopen via More menu

**Surfaces to watch (the **whole topic resolved** moment is the most fragile):**
- Conversation card: green checkmark + resolved-by line + resolution message
- Topic header: open/resolved counts, dashed circle → green checkmark
- TopicsPage left rail row icon
- DeskPage Urgent / Open work / Starred row icons
- "Huddle in <topic>" anchor on the seed DM message
- "Promoted to <topic>" divider in BOTH thread panels (DM-side AND huddle-side)
- Inline `[Topic]` mentions in any message body
- TopicMenu and FilesMenu listings

**Edge:** Resolve LAST conv in a topic → all icons should flip to checkmark together. Reopen ONE conv → all should flip back to dashed circle together.

### Session 4 — DM-to-Topic promotion (the big seam)
**Goal:** Verify the full DM → Topic → Huddle flow and its persistence.
**Steps to walk through, in order:**
1. On a DM message, click "Start topic" → CreateTopicDialog opens with privacy banner + DM partner pre-filled.
2. Add invitees, set title, click Start topic → toast appears bottom-left ("Topic created · Back to conversation").
3. Confirm: navigated to `/topics/<newId>`, empty-state banner above ComposeBox, Huddles tab has 1 row, the row's preview shows the **seed** message (not the latest DM).
4. Click "Back to conversation" in toast → returns to DM, seed message has the **huddle anchor** above it ("Huddle in <topic title>" with dashed circle that becomes green when topic resolves).
5. Click huddle anchor topic title link → navigates to topic.
6. Click huddle row in Huddles tab → thread panel opens on seed message id.
7. Header member pill shows `You + DM partner`, "Open original" button visible.
8. Promotion divider visible in replies stream; pre-promotion replies above, post-promotion below (chronological by `createdAtMs`).
9. Post a reply from the huddle thread → appears below divider here AND in DM thread panel for the same message.
10. Add a reaction on the initial pinned message in huddle thread → shows in DM ConversationCard reactions row AND in DM thread panel.
11. Set a highlight on the initial pinned message in huddle thread → mirrors to DM (header pill, body tag).
12. Edit the body in either side → mirrors to the other.
13. Click "Open original" → navigates to /app/people/<dmId>, thread panel auto-opens on the same message id.
14. Click topic title in promotion divider from the **huddle side** → switches to Conversations tab, closes thread panel (no-op navigation).
15. Click topic title in promotion divider from the **DM side** → navigates to topic Conversations tab.

**Watch for:** any of those 15 steps regressing.

### Session 5 — Huddles (non-promoted)
**Goal:** Test the regular "create new huddle inside a topic" flow.
**Probe:** New Huddle button (empty state), New Huddle inline button (grid+1 cell), recipient typeahead, picking recipients, sending the first message, editing/deleting the huddle, the more menu (View details / Delete), the quick menu (Reply / More).
**Watch for:** huddle preview body editing flow (`huddleBodyOverrides`), delete then refresh state, opening a huddle's thread (it has no `originDmId` so no "Open original" button, no promotion divider — verify both absent).

### Session 6 — Compose box
**Goal:** Cover every input pattern in a non-distracting environment (one DM thread will do).
**Probe:**
- Plain text send.
- `@<person>` autocomplete from MentionMenu — type partial, arrow keys, Enter, Escape.
- `!@<person>` urgent — body left-border on compose.
- `[<topic>` autocomplete via FilesMenu (Topics list, Apps drilldown, Documents).
- `[<file>` autocomplete (apps + docs).
- Slash menu (`/`) — 5 highlight types, 5 shortcuts. Arrow keys, Enter, Escape.
- Bullet list (`-` then content). Numbered list (`1. ` then content).
- Enter inside list = new list item; Shift+Enter = soft break; Enter on empty list item = exit list.
- `→` typed in body → resolution prompt appears → Enter sends with resolution.
- Send button enabled/disabled by content.
- Empty body + only resolution → must still send (verifies resolution-only path).

**Watch for:** mention chips not double-inserting, `[topic]` chips with correct icon (dashed/checkmark per runtime resolution), highlight tag inserting at start of compose, slash menu Escape leaving the slash character behind (or not — verify intended behavior).

### Session 7 — Persistence + navigation
**Goal:** Brutal navigation roundtrips to break state.
**Probe pattern:** for each persistent state slot, change it, navigate away (NavRail → another page → back), confirm it's still there.
**Specifically:**
- Compose a sent message in a topic → leave to Desk → come back → message there.
- Compose a reply on a DM message → leave → come back → reply there.
- Edit body of a reply → leave → come back → edit persists.
- React on a reply from the DM side → open the same message's thread from huddle side → reaction shows.
- Set a highlight on initial message from huddle side → check DM ConversationCard list shows the highlight pill.
- Resolve a conv → leave → come back → still resolved with same message + by.
- Delete a sent message → leave → come back → still gone.
- Star a DM → leave → come back → still starred. Same for topic.
- Browser refresh (F5) → confirm what's expected to persist (most runtime mutations are in-memory only since there's no localStorage layer — knowing this helps you not file false bugs).
- Last-selection: click NavRail Topics from any page → lands on the topic you last visited. Same for People.

**Watch for:** the `pendingDmThreadId` consume effect (huddle → "Open original" → DM auto-opens thread): if this regresses you'll see DM page load without thread panel open. The fix from this session was a ref-based `prevDmIdRef` to skip closing-thread on initial mount — verify it still works.

### Session 8 — Star, NavRail, sidebar
**Goal:** Cover the chrome.
**Probe:** star/unstar from DM header, topic header, Desk row (via what mechanism? — verify), NavRail Desk/Topics/People with their last-selection memory, sidebar collapse from ContainerHeader chevron, theme switcher (Light / Dark / System).
**Watch for:** Desk's "unstar clears selection unless still reachable via Urgent or Open Work" rule — try unstarring an item in Starred that ALSO appears in Urgent (selection should migrate, not clear), then unstar one that's only in Starred (selection clears).

### Session 9 — Debug menu
**Goal:** Toggle every debug switch and verify the visible difference.
**Probe each combination:**
- showScreener on/off + screenerItemsCount 1/2 → Desk Screener section
- showUrgent on/off + urgentItemsCount 1/2 → Desk Urgent section
- openWorkHasData empty/data → Desk Open Work
- starredHasData empty/data → Desk Starred
- unreads.topics on/off → unread badges across TopicsPage rows, Desk topic rows, NavRail Topics
- unreads.people on/off → unread badges across PeoplePage rows, Desk DM rows
**Watch for:** unread-first sort kicking in only when toggle is on; urgent badges always visible regardless of toggle; the ScreenerSection topic icon flipping correctly to runtime resolved state for topic 7 (the linked one).

### Session 10 — Cross-feature interaction matrix (the seams)
**Goal:** This is where bugs hide. Use the matrix in the next section as your test plan.

### Session 11 — Edge cases catalog
**Goal:** Run every relevant edge from the catalog (next section).

### Session 12 — Regression checklist sweep
**Goal:** Mechanical pass of the must-pass items in the regression checklist below. Do this LAST, after all exploratory sessions, so it confirms nothing regressed during your testing.

---

## Cross-feature interaction matrix (the seams)

This is where bugs live. Each row is a paired interaction — test both directions.

| When you do this... | ...verify it correctly affects... |
|---|---|
| Resolve a conversation | Conv card icon, topic header counts, topic header icon, TopicsPage row, DeskPage row (all 3 sections), "Huddle in" anchor (if seed), "Promoted to" divider (both sides), inline `[Topic]` mentions everywhere |
| Reopen the only resolved conv in a fully-resolved topic | All of the above flip back to dashed circle |
| Add a reply with `→` resolution | The reply lands in stream + parent conv resolves + cascade above |
| Edit a sent reply via in-place editor | bodyOverrides updates → both DM-side and huddle-side thread panels show new body |
| Delete a sent reply | Both sides drop it; reply count badge on parent updates |
| Add reaction from DM thread on a promoted seed | Huddle thread reactions on initial message also show |
| Add reaction from huddle thread on initial message | DM ConversationCard list shows it AND DM thread panel shows it |
| Set highlight on a reply | Both sides reflect; HighlightPill in card |
| Promote a DM with prior replies, then post new replies | Pre-promotion replies above divider, post-promotion below divider, chronologically split by `promotedAtMs` |
| Click "Open original" from huddle thread | Navigates to /app/people/<dmId>, **thread panel auto-opens on same message id**, no flicker |
| Click "Promoted to <topic>" link from DM-side thread | Navigates to topic Conversations tab |
| Click "Promoted to <topic>" link from huddle-side thread | Switches active tab to Conversations + closes thread panel (no URL change) |
| Promote two different DM messages from the same DM | Both create separate huddles with different seedMessageIds; both anchors visible in DM list; "Start topic" hidden on each seed but visible on other messages |
| Star then resolve all convs in a topic | Topic shows up in Starred with checkmark icon |
| Unstar a topic that's also in Open Work | Selection migrates to Open Work (not cleared) |
| Switch DMs while a thread panel is open | Thread panel closes on switch (genuine DM change), but does NOT close on initial mount when arriving via "Open original" |
| Edit message body that contains `[Topic X]` mention while topic X gets resolved | Inline mention's icon updates live (TopicMentionView reads `useTopicMutations()`) |
| Compose with `→` shortcut on a NEW (no replies yet) message | Sends with resolution applied directly |
| Resolve a conv, then immediately undo by sending a new message | Conv stays resolved (sending doesn't reopen); reopening must be explicit |

---

## Persistence test matrix

Run a roundtrip: change → navigate to another page → return → check value.

| Mutation | Expected to persist? | If not, where does it live? |
|---|---|---|
| Sent message in a topic | ✅ across-page persistence | TopicMutations.sentMessages |
| Sent reply (any conv id) | ✅ | TopicMutations.sentReplies |
| Body edit (conv or reply) | ✅ | TopicMutations.bodyOverrides |
| Highlight change (conv or reply or initial) | ✅ | TopicMutations.highlightOverrides |
| Reaction change (any) | ✅ | TopicMutations.reactionOverrides |
| Resolution + resolvedBy + message | ✅ | TopicMutations.resolvedOverrides |
| Delete (any conv/sent) | ✅ | TopicMutations.deletedIds |
| Created huddle | ✅ | TopicMutations.createdHuddles |
| Deleted huddle | ✅ | TopicMutations.deletedHuddleIds |
| Huddle preview body edit | ✅ | TopicMutations.huddleBodyOverrides |
| **Sent messages composed in a DM** | ⚠️ DM-LOCAL ONLY | useDmConversationView's local useState — survives within a DM session but resets on full page reload (and possibly on DM switch — verify) |
| **DM-side resolved overrides** | ⚠️ DM-LOCAL ONLY | same — file this if confusing |
| Open thread id | ❌ resets | local view state |
| Active topic tab | ❌ resets per topic | local view state |
| Browser refresh | ❌ all runtime state lost | no localStorage / sessionStorage layer |
| Last-visited DM and Topic | ✅ within session | LastSelection (in-memory) — resets on refresh |

**Notable asymmetry:** sent messages and resolution overrides on the DM side are stored **locally** in `useDmConversationView`, while replies/reactions/highlights/body edits are in the shared TopicMutations. This means: post a reply on a DM, navigate away, return → reply persists. But post a top-level NEW DM message, refresh → gone. Confirm this asymmetry exists or is a bug.

---

## Edge case catalog

Run through these for each major feature. The category headers tell you what bug class you're hunting.

### Empty / zero state
- Topic with 0 conversations → header counts (0 open, 0 resolved), `isTopicResolved` returns `false` (no convs), icon stays dashed, empty state banner shows.
- DM with 0 messages → empty state.
- Topic with 0 huddles + 0 conversations → empty state with "New Huddle" CTA.
- Star nothing → Starred section empty placeholder text.
- Open work empty (debug toggle) → placeholder text.

### One / boundary state
- Topic with exactly 1 conversation → resolve it → topic should flip to resolved everywhere.
- Reopen the only resolved conv → topic flips back.
- DM with exactly 1 message → promote it → huddle preview is that message; "Start topic" hidden on it (it's now a seed).
- Reply with exactly 0 chars + resolution → sends as resolution-only.
- Highlight applied with NO body text in compose → can you send? Should you be able to?

### Many / overflow
- Compose a very long message (2000+ chars) → wraps correctly in card and thread panel.
- Reply chain with 50+ replies → scroll, no perf issues.
- Topic with 20+ huddles → grid scroll, "+1" empty-state cell still positions correctly (col-span when even).
- Topic with very long title → ellipsis in row / header / link / divider.
- Person with very long name → ellipsis in member pill / chip.

### Special characters
- Mention with apostrophe in name (e.g., "O'Brien" if PEOPLE has one) — does the regex handle it?
- Topic title with brackets `[`, `]` — verify FilesMenu doesn't treat as nested mention.
- Body text with mention-like patterns (`@testing-library/react`) — should NOT match (lookahead in MENTION_RE).
- Body containing `→` literal that the user wants as text, not as resolution — what happens?
- Emoji in compose, in body, in name.

### Concurrent / rapid actions
- Click "Start topic" twice quickly → only one topic created? (debounce?)
- Spam-click Resolve → idempotent?
- Type fast in compose with autocomplete open → no dropped keystrokes.
- Rapidly switch between topics → no leaked thread panel from previous topic.

### Just-promoted, just-resolved, just-deleted moments
- Promote a DM with replies AND a resolution → what does the divider show? Resolution above or below?
- Promote a DM that's ALREADY part of another huddle (multiple promotions of same DM) → both huddles exist, both anchors render? Verify.
- Resolve a conv via reply-with-`→`, then immediately delete the reply → conv stays resolved? Or auto-reopens? Verify intended behavior.
- Delete the seed message of a huddle → what happens to the huddle? (likely orphaned — verify gracefully handled).

### Permission / availability boundaries
- "Edit message" only on own messages — try the menu on someone else's, the option should be absent.
- "Delete" only on own messages.
- "Start topic" hidden on messages already promoted (seed messages with a huddleContext).
- Reopen vs Resolve mutually exclusive — verify the right one shows based on current state.

### Visual / state edges
- Hover an item, then move directly to its quick menu without losing hover (portalled menus must stay).
- Open a portalled menu, then click outside → closes.
- Open a portalled menu, then press Escape → closes.
- Edit mode on a card while thread panel is open on it → can both coexist? What's the intended behavior?

---

## Regression checklist (must-pass)

This is the bottom layer — explicit items to mark off after exploratory sessions. Run as a final sweep.

### Navigation & shell
- [ ] `/` redirects to `/app/desk`.
- [ ] NavRail Desk / Topics / People all clickable, all show correct page.
- [ ] Topics NavRail link goes to last-visited topic; People to last-visited DM.
- [ ] Sidebar collapse works on TopicsPage and PeoplePage; collapsed state persists during session.
- [ ] Theme switcher (Light / Dark / System) applies and persists for session.
- [ ] No console errors during typical navigation roundtrip.

### Desk page
- [ ] Each section (Screener / Urgent / Open Work / Starred) shows or hides correctly per debug toggles.
- [ ] Screener item dismissal removes from list.
- [ ] Open Work item X-button removes from list.
- [ ] Starred section collapsible chevron works.
- [ ] Selecting an item in any section opens its right panel.
- [ ] Cross-section selection re-anchors highlight to the section clicked.
- [ ] Topic icons (dashed/check) reflect runtime resolution state in all 3 sections.

### Topics page
- [ ] List sorted alphabetically.
- [ ] Unread-first sort when toggle on.
- [ ] Selected topic row highlighted.
- [ ] Topic header shows correct title, counts, member pill, star button.
- [ ] All three tabs render (Conversations works; Huddles works; Timeline shows EmptyState placeholder — known stub).
- [ ] Conversations tab: cards render with avatar, body, timestamp, replyCount, hover quick menu, more menu.
- [ ] Huddles tab: empty state with CTA OR grid of HuddleCards + new-huddle cell.

### People page
- [ ] DM list with Starred section, regular DMs, Teams (display only).
- [ ] Selected DM highlighted.
- [ ] Right panel shows DM messages with seed-anchored huddleContext if applicable.
- [ ] Compose box at bottom; thread panel on the right when message is clicked.

### Conversation card
- [ ] Quick menu on hover: React, Reply, Resolve/Reopen, More.
- [ ] More menu: Resolve/Reopen, Start topic (DM only), Open work, Mark as Highlight (submenu), Edit (own only), View details, Delete (red, own only).
- [ ] Resolved card shows green checkmark, resolved-by line, optional resolution message.
- [ ] Highlight pill renders with correct color/label per type.
- [ ] Reactions row renders below body when reactions exist.
- [ ] Body parses bullet/numbered lists, mentions, [Topic]/[File] tags, urgent !@, → resolution, highlight tags.
- [ ] Inline `[Topic]` mention icon flips dashed→checkmark when topic is resolved (all 4 places: ConversationCard MessageBody, ThreadReplyCard MessageBody, TopicMentionView in editor, FilesMenu/TopicMenu).

### Thread panel
- [ ] Header: "Replies" + (resolved badge) + member pill + (Open original button if huddle promoted) + close button.
- [ ] Pinned initial message in non-huddle path; full ThreadReplyCard in huddle path with reactions/highlight editable.
- [ ] Reply list scrolls; auto-scrolls to bottom on new reply.
- [ ] Promotion divider shown when applicable, with correct topic title link, date, and dashed/checkmark icon.
- [ ] Replies above and below divider are correctly partitioned by `createdAtMs vs promotedAtMs`.
- [ ] Compose box "Reply..." placeholder.

### DM-to-Topic flow (the 15-step Session 4 walk-through)
- [ ] All 15 steps from Session 4 pass without regression.

### Compose box
- [ ] All slash menu items insert correctly.
- [ ] All mention types (@, !@, [topic, [file) autocomplete + insert.
- [ ] Lists work, Enter/Shift+Enter behaves correctly inside lists.
- [ ] → resolution prompt appears when typed.
- [ ] Send disables on empty unless resolution present.

### Resolution
- [ ] All 7 resolution paths (Session 3) work.
- [ ] All 8 surfaces flip on full-topic-resolved.

### Persistence
- [ ] Each row in the persistence matrix verified by roundtrip.

### Debug menu
- [ ] Each toggle changes the expected surface.
- [ ] Help icon in TopBar opens menu.

---

## Known gaps — don't file as bugs

Skip these; they're unimplemented:

- Timeline tab is a placeholder (EmptyState).
- "Invite members" button on the empty topic banner is a TODO (no dialog wired).
- Files menu "Attach file" toolbar button has no picker.
- ComposeBox snooze (clock icon) is decorative.
- View details menu item likely a stub.
- NavRail has a commented-out Flows screen.
- Browser refresh wipes runtime state (no localStorage layer).
- Sent messages and resolution overrides on the DM side are stored in DM-local state, not the shared TopicMutations — confirm with the user whether this is intentional.

---

## Files to keep open during testing (for filing bugs precisely)

- [ConversationCard.tsx](peek-app/src/components/ConversationCard.tsx) — message rendering, all menus, edit mode
- [ThreadPanel.tsx](peek-app/src/components/ThreadPanel.tsx) — replies, divider, header
- [useTopicView.tsx](peek-app/src/components/views/useTopicView.tsx) — topic tabs, huddle grid, derived resolution
- [useDmConversationView.tsx](peek-app/src/components/views/useDmConversationView.tsx) — DM rendering, promotion detection, pending-thread consumption
- [topicMutations.tsx](peek-app/src/lib/topicMutations.tsx) — state schema and `isTopicResolved`
- [topicStore.tsx](peek-app/src/lib/topicStore.tsx) — `createTopicFromDm` + huddle lookup helpers
- [DeskPage.tsx](peek-app/src/pages/DeskPage.tsx) — section logic, selection anchor
- [ComposeBox.tsx](peek-app/src/components/ui/ComposeBox.tsx) — slash menu, autocomplete

---

## Verification — how to know you've covered enough

You're done when:
1. Every charter session above has a written log of what you tried and what you found.
2. Every row in the cross-feature matrix has been exercised at least once.
3. Every row in the persistence matrix has had a navigation roundtrip.
4. The regression checklist has every box ticked or a filed bug for each unticked item.
5. You've spent ~30 min in **unscripted exploratory testing** at the end with no charter — just clicking around trying to break things. Seasoned QA always saves time for this; charters miss bugs that "what does this button do?" finds.

If a session uncovers a deep new area, spawn a new charter for it and don't try to cover it inside the current session — that's how scope creep destroys QA work. One session, one focus.
