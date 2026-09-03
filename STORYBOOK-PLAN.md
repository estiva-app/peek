# Storybook Plan — Peek

Fresh Storybook on `main` (Storybook 10.4 + `@storybook/react-vite`, reuses `vite.config.ts` aliases and Tailwind). **Not** the monorepo branch — started from scratch by decision (2026-07-08).

## Scope decisions
- **Huddles: V3 (inline) only.** V3 renders: `HuddleCard variant="inStream"`, the inline huddle-creator block, ConversationHeader's start-huddle (LockPlus) button, ThreadPanel huddle mode, the promotion divider, the DM-origin banner.
- **Dropped (V1/V2 only — no stories):** `TopicTabs`, `StartHuddleDialog`, `HuddleCard variant="grid"`, Huddles-tab grid + New-Huddle tile, Timeline tab, TopicsPage sidebar SVG branch tree, V2 huddle main view.
- **Parked (AI/launcher features — revisit when implemented properly):** `CommandLauncher`, `FigmaFindPanel`, `SelectionToolbar`, `NewAgentDmDialog` + agent rows/chips, `FrameArt`, `FrameLightbox`, Figma attachment cards in ComposeBox/ConversationCard/ThreadReplyCard, `composerRegistry`/`launcherContext`.
  - Note: one seeded message (`dmData.ts` → Alice Johnson DM, `dm1_c6`) ships attachments, so attachment *display* is reachable without ⌘K. Decide: strip the seed or allow a display-only story later.

## Conventions
- Stories colocated: `src/components/**/X.stories.tsx`. CSF3, `satisfies Meta<typeof X>`.
- One story per meaningful variant axis + an **AllVariants matrix** story when axes are enumerable. Exemplar: `src/components/ui/Button.stories.tsx`.
- Interaction-gated states (hover/selected/unread) get explicit stories via props or pseudo-state wrappers.
- Theme toolbar (light/dark) is wired in `.storybook/preview.tsx` (toggles `dark` class). Check every story in both.
- Providers: add a `PeekProviders` decorator (`TopicMutationsProvider` + `MemoryRouter` + `DebugProvider` + `LastSelectionProvider`) when Tier 3+ needs it; mock data comes from `src/data/*`.
- Pixel fidelity: stories must match the app exactly — reuse primitives, never re-hand-roll markup.
- Per batch: `npx tsc -b` → visual pass in `npm run storybook` → commit.

## Story checklist (build order)

### Tier 1 — Atoms ✅ (all done 2026-07-08)
- [x] **Button** — 3 variants × 2 sizes × leadingIcon × disabled + matrix *(exemplar)*
- [x] **Avatar** — by-name, fallback placeholder, size scale
- [x] **IconButton** — muted/outlined/primary × disabled × tooltip + matrix
- [x] **Chip** — 6 types, icon slots, "1 new", count-only + matrix
- [x] **Divider** + [x] **DateDivider** — plain, long label, sticky-in-scroll demo
- [x] **Tooltip / WithTooltip** — static surface + hover top/bottom
- [x] **EmptyState** — default, custom icon/message
- [x] **HighlightPill + HighlightSwatch** — 5 types + swatch row
- [x] **Reaction** — yours vs others, double-digit, row
- [x] **TopicState** — all 6 types, resolved, group count, DM avatar + matrix
- [~] **ReferenceChip** — retired 2026-09-03 with the third-party mock apps (the chips linked a fictional `peek/peek` repo and never navigated)
- [x] **Toast** — extracted presentational `src/components/ui/Toast.tsx` from `src/lib/toast.tsx` (provider now renders it); 3 types × icon × action + matrix

### Tier 2 — Molecules ✅ (all done 2026-07-08)
- [x] **SearchInput** — shortcut chip, focus, filled
- [x] **PersonRow** — 6 types × selected × unread × urgent+unread × hover (remove vs more) — fix gaps #10/#11 first
- [x] **SectionHeader** — chevron × expanded × actions × hover-reveal
- [x] **PersonChipInput** — empty, chips, dropdown, excludeIds (agents pool parked)
- [x] **MentionMenu** — People vs Urgent header, highlight row
- [x] **TopicMenu** — highlight, resolved/unresolved rows
- [x] **ReactionPicker** — single form (note: default export)
- [x] **StarredSection** — empty guidance, populated, collapsed, selected — add urgent (#12), onRemove (#14)
- [x] **ContainerHeader** — leadingIcon × chevron × 3 actions × more slot

### Tier 3 — Menus ✅ (all done 2026-07-08)
- [x] **FilesMenu** — level 1, drill (interactive), filtered, docs; live topic status icons — *level-2 shown via query narrow + interactive drill*
- [x] **ConversationQuickMenu** — resolved vs unresolved + both-states row
- [x] **ConversationMoreMenu** — dm/seeded/topic × resolved × own-message × with-highlight (submenu opens on hover)
- [x] **DebugMenu** — categorized rows, live toggles via harness + DebugProvider

### Tier 4 — Cards & message pieces
- [x] **MessageBody** — extracted to `ui/MessageBody.tsx` (deduped from ConversationCard + ThreadReplyCard, byte-identical); story = paragraphs, bullet/numbered lists, inline @/!@/[Topic]/[File]/refs, resolved-topic chip
- [x] **ConversationCard** — 12 stories: plain / reactions / replies / unread / urgent(+reply) / highlight / resolved / selected / huddle-anchor / inline-tokens. **#3 FIXED** (useTopicView now forwards `isUrgent`); #1/#2 by-design (urgent pairs with unread). Also fixed: in-place start-topic anchor now reads "**Huddle in** *Topic*" (was bare topic name) — matches the huddle-anchor design (user report 2026-07-08). Topic-anchor story dropped — only the huddle anchor is a relevant surface (user 2026-07-08).
- [x] **ThreadReplyCard** — 5 stories: default / reactions / highlight / new / new+urgent. #5 by-design (isUrgent pairs with isNew). Now consumes shared `ui/MessageBody`.
- [x] **HuddleCard (inStream only)** — stories: default / selected / empty / new-reply / urgent-reply / new-message / resolved. **#6 (unread/urgent) + #7 (resolved) IMPLEMENTED** following ConversationCard's pattern verbatim (blue/amber notification border, header blue-dot vs amber alert-badge, brand/warning "1 new" chip, green resolution banner from `huddle.state==='resolved'`) — user-approved 2026-07-08. inStream only.
- [x] **ScreenerSection + ScreenerItem** — `ScreenerItem` **extracted** from the accordion (user suggestion 2026-07-08); each has its own story (section: default/one-item; item: topic/person). **#8 (urgency) WON'T DO** — urgent conversations bypass the Screener entirely and land in Desk › Urgent, so there is no urgent Screener state by design (user 2026-07-08).
- [x] **PinnedMessage** — extracted to `ui/PinnedMessage.tsx` (promoted from ThreadPanel local; HighlightPill import removed there); story = default / highlight / truncated.

### Tier 5 — Dialogs ✅ (2026-07-08)
- [x] **ResolveDialog** — default (empty textarea; message is internal state, type to fill)
- [x] **CreateTopicDialog** — default (disabled confirm) / prefilled (enabled) / from-DM (privacy banner)

### Tier 6 — Composer
- [x] **ComposeBox** — default / reply placeholder. (Interactive states — slash menu, urgent bar, highlight picker — are documented in the story; they require typing, not props.)
- [x] **HuddleCreator** — extracted `useTopicView`'s `huddleCreatorBlock` → self-contained `components/HuddleCreator.tsx` (3-prop API: `topicTitle` / `onCancel` / `onCreate`; owns recipient/query state + Escape/outside-click/refocus). useTopicView shed ~170 lines (state, 2 effects, 3 helpers, the block) and dropped now-unused IconX/Avatar/PEOPLE imports; `handleHuddleSend` → `handleCreateHuddle(recipients, firstMessage)`. Story: Default (interactive). **Did NOT rebase onto PersonChipInput** — kept the hand-rolled To: input verbatim (zero behavior/visual change); the PersonChipInput dedup remains an optional follow-up. **Behavior-affecting refactor — needs a click-test** (add/remove recipient, Escape/outside-click close, create huddle).

### Tier 7 — Panels & chrome
- [x] **ConversationHeader** — stories: topic / topic-resolved / dm / dm-starred / huddle. Extracted the local `AvatarGroup` → `ui/AvatarGroup.tsx` (own story) along the way. *(pulled forward 2026-07-08 at user request)*
- [x] **ThreadPanel** — default / resolved / huddle (MemoryRouter + TopicMutationsProvider; real conversation + REPLIES data). The "Replies" divider inside it is `DateDivider label="Replies"` (own DateDivider story).
- [x] **NavItem / NavRail** — active/inactive per route via MemoryRouter (NavRail also needs LastSelectionProvider). *(pulled forward)*
- [x] **TopBar** — Theme + Debug providers; menu/search/debug/avatar (theme + debug menus open on click).
- [x] **AppShell** — default / with-thread-panel (Theme+Debug+LastSelection+MemoryRouter; menu button collapses — internal state, documented).

### Added atoms/coverage (2026-07-08, user-requested sweep)
- [x] **AvatarGroup** (`ui/AvatarGroup.tsx`) — overlapping member stack (caps at 3) + in-members-pill story. Note: `MemberAvatars` (HuddleCard, grid variant) is a separate 4-avatar `-ml-2` variant — left as-is (grid is out of scope; do NOT unify without visual verification).
- [x] **PersonRow** — added `team` + `view` type examples (covers the People-page Teams rows, e.g. "Account Management"). One component serves all list rows (topic/DM/team/group/view/huddle).
- [x] **DateDivider** — added the `Replies` label example (the thread-panel replies divider).
- [x] **NewTopicBanner** (`components/NewTopicBanner.tsx`) — extracted the inline "This is the beginning of your conversations in *Topic*" + Invite-members empty-state banner from `useTopicView`; own story (default / long-title). (user-flagged 2026-07-08)

## Extractions required along the way
Blocking a story: `Toast` ✅, `MessageBody` ✅ (`ui/MessageBody.tsx`, deduped ConversationCard+ThreadReplyCard), `PinnedMessage` ✅ (`ui/PinnedMessage.tsx`), `HuddleCreator` (Tier 6, still pending).
High-value dedup (do in the same tier as their story): `MessageHeader` (avatar+name+timestamp+pill, 3×), `ResolutionBanner` (3×), `ConversationCardList` (sticky DateDivider + card list, ~7×), Desk sections → reuse `SectionHeader` (3× hand-rolled in DeskPage), `SidebarPanel` scaffold (3 pages), `MemberAvatarPill` (ThreadPanel), `Kbd` badge.
Optional: `TopicOriginBanner`, `MessageEditor`, `ComposeFooter`, `EmptyConversationPanel`, sticky prop on `DateDivider`.

## State-gap checklist (from 2026-07-08 audit)
Blocking distinct stories:
1. ConversationCard: `isUrgent` alone renders nothing (warning chrome gated on new flags) — `ConversationCard.tsx:582-591,720-726,789-794`
2. ConversationCard: `hasNewReply` invisible unless `replyCount > 0` — `:775-794`
3. ✅ FIXED (2026-07-08) — `useTopicView` now forwards `isUrgent={c.isUrgent}` at both topic `group.convs` render sites (V3 + V1/V2), matching the DM view. Urgent+unread topic cards now render amber.
5. ThreadReplyCard: `isUrgent` alone renders nothing (needs `isNew`) — `:577-584,633-639`
6. ✅ FIXED (2026-07-08) — HuddleCard now takes `hasNewMessage`/`hasNewReply`/`isUrgent` (inStream), rendering ConversationCard's border + dot/badge + "1 new" chip.
7. ✅ FIXED (2026-07-08) — HuddleCard renders a green resolution banner when `huddle.state === 'resolved'`.
8. WON'T DO (by design, 2026-07-08) — urgent conversations skip the Screener and go to Desk › Urgent, so a Screener item is never urgent. No urgency field/treatment needed.
10. PersonRow: `isUrgent` only renders when `isUnread` — urgent-but-read has no treatment
12. StarredItem lacks `isUrgent`; starred urgent rows impossible
18. Desk Open-Work rows never pass `isUrgent`
19. DeskPage re-implements Starred inline (doesn't reuse StarredSection) and drops `isUrgent`
20. PeoplePage/TopicsPage rows never pass `isUrgent` — urgency only visible in Desk › Urgent

Cosmetic / data gaps: #4 V2 huddle cards drop flags (V2 dropped anyway), #9 ScreenerSection onOpen/onLater unwired in app, #11 hover hides unread/urgent indicator on PersonRow, #13 StarredItem.memberCount never populated, #14 StarredSection lacks onRemove, #15 no header unread/urgent treatment, #16 "0 open · 0 resolved" shown for empty topics, #17 no urgent-topic seed for Desk, #21 sidebar huddle rows carry no unread (V2 — dropped), #22 no topic conversation sets `isUrgent` in seeds, #23 no urgent-without-new reply seed, #24 Open-Work/Starred seeds never set `isUnread`.

**Decision (2026-07-08): urgent is a modifier of unread — the warning treatment disappears once read.** Findings #1, #5, #10 are therefore by design, not bugs: stories must always pair `isUrgent` with the matching unread/new flag, and no standalone-urgent treatment gets built. Still real gaps: #3 (`useTopicView` drops `isUrgent`, so urgent+unread topic cards can't render), #6/#7 (HuddleCard), #8 (Screener), #12/#18/#19/#20 (urgent+unread rows impossible on Starred/Open-Work/People/Topics surfaces).
