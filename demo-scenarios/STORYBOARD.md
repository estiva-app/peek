# Nostr-for-Business demo — scenario player storyboard

Source of truth for beats: the Linear doc
[Scenarios of Nostr for Business](https://linear.app/peek-app/document/scenarios-of-nostr-for-business-49287455c230).
Designs: Figma `Peek- Claude to Figma`, Scenario boards (S1 = node 712-2933,
S2 = node 761-1285).

The player (`npm run dev` in this folder, port 5200) renders each scenario as
an ordered list of **scenes** on a fixed 1440×1024 stage (auto-scaled to the
window). **→ / ←** or click advances/rewinds one *step*; a step is either an
in-scene animation beat or a scene change. `?scenario=1&step=3` deep-links.

## Scenario 1 — Highlights in Huddle

| # | Scene           | Step / beat                                              | Status |
|---|-----------------|----------------------------------------------------------|--------|
| 0 | `meet-call`     | In-call grid: Greg, Peek Designer, Alice (muted), Stripe Engineer | ✅ pixel pass done (vs Figma 666:658) |
| 1 | `meet-ended`    | "You left the meeting"                                   | ✅ pixel pass done (vs Figma 681:2417) |
| 2 | `meet-ended`    | Highlights doc rises in (500ms fade+lift)                | ✅ |
| 3 | `peek-topic`    | Peek, Payment integration topic — collapsed Highlights bar just arrived | pending (real app iframe + demo dataset) |
| 4 | `peek-topic`    | Highlights card expands (Expand click / auto-beat)       | pending |

Player: `?hud=0` or the **H** key hides the step HUD for recording. Fonts:
Meet scenes fall back Google Sans Flex → Roboto (CDN); metrics differ by
~1px in places — acceptable at recording distance.

Transitions: plain cuts between apps for now (crossfade at most). The
"object travels between apps" morph is explicitly parked — prototype only if
the plain version feels flat on film (ruling 2026-07-24: cuts first, morph is
a maybe).

Peek scenes use the REAL app in an iframe (mock mode, no login) pointed at a
demo dataset — not a rebuilt mock. The HighlightsCard component shipped in
the main app (`src/components/HighlightsCard.tsx`, Storybook:
Messages/HighlightsCard); stream wiring + dataset are the remaining Peek work.

## Scenario 2 — The answer just shows up (parked until S1 is done)

Figma-app scene: canvas with payment-flow frames, Linear project widget,
AI feedback panel with staged typing and the "Asking Stripe sub-agent" beat.

## Working rules

- Committed to the repo (ruling 2026-07-24), isolated from the app build —
  nothing in `src/` may import from `demo-scenarios/`.
- Third-party app scenes are hand-built pixel-perfect from Figma via the
  Figma MCP (design context + exported assets), verified by screenshot diff.
- Every beat must be reachable by keyboard only — the player is built to be
  screen-recorded.
