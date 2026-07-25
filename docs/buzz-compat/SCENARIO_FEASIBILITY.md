# Demo scenarios — what's buildable today, what needs a new NIP

Maps the five scenarios in
[Scenarios of Nostr for Business](https://linear.app/peek-app/document/scenarios-of-nostr-for-business-49287455c230)
against [NIP_SURVEY.md](NIP_SURVEY.md) and what already runs.

**Question it answers:** can we demonstrate more of NfB by building demo apps
against *existing* NIPs, instead of inventing new ones first?

**Short answer: yes for three of the five, with zero new NIPs.** And the two
that are blocked are blocked on the *same* thing — which is a useful signal
about what the first NfB NIP should actually be.

---

## One thing to be clear about first

Every scenario is set in apps you do not control: Meet, Figma, Linear, Claude,
GitHub, Posthog, Intercom. **You cannot make real Figma publish Nostr events.**

So "build the demo" always means building a **stand-in** — your own small app
playing Figma's role, publishing and reading the same events a real integration
would. That is honest and it still proves the protocol claim, but it proves
*"an app in this ecosystem can do X"*, not *"Figma does X"*.

Worth deciding explicitly, because it changes what you are making:

- **A video/storyboard** — visual fidelity matters, working protocol does not.
  The Figma mockups are already the right artifact.
- **A working proof** — stand-in apps with your own UI, real events, real relay.
  Less pretty, far more convincing to anyone technical.

The two are not exclusive. The strongest version films the *working* parts and
mocks the rest — and the mapping below says which is which.

---

## Scenario 1 — Highlights in Huddle

*Meet call ends → a Highlights card appears in the Peek Topic.*

**Demonstrates:** cross-app data flow, and Highlights (RFC §1.4a).

**Buildable now: ✅ fully. This is the cheapest strong demo you have.**

| Piece | How |
| --- | --- |
| "Meet" publishing highlights | Stand-in app, same shape as the existing taskboard |
| Highlight events | **NIP-84** (`kind:9802`) or `kind:9` + **NIP-32** labels — both exist |
| Peek rendering the card | **Peek already has `HighlightsCard`** ("app-generated highlights in the stream") |
| Peek receiving it | Already works — Stage 2 sync imports foreign events today |

Effort: **small.** It is the taskboard again with a different event shape and a
different costume. Nothing new to invent, and the Peek-side UI exists.

---

## Scenario 2 — The answer just shows up

*Figma canvas with a live Linear widget; Figma AI calls a Linear sub-agent;
comments land on the canvas.*

**Demonstrates:** embedded cross-app components (§3.1), agent sub-agents (§3.2).

**Buildable now: ⚠️ split cleanly in half.**

- **The Linear widget — ✅ buildable.** This is exactly **NIP-89** (`kind:31990`
  app handler + `kind:31989` recommendation): an app declares "I handle kind X,
  render it like this", and another app embeds it live. The Figma file's
  `linear-widget/sticky-hybrid` component — project title, status, PEE-127…130 —
  is a NIP-89 handler rendering an addressable event. **Nobody has this, not even
  Buzz**, so building it is genuinely novel.
- **The sub-agent call — ❌ blocked.** Requires agents to *declare invocable
  skills*. Nothing in 99 NIPs does this; Buzz's persona/managed-agent events get
  ~60% there and stop short. See §3.2 below.

---

## Scenario 3 — Straight to the source

*Designer starts a conversation from Figma; it lands in Peek with the frame
rendered inline; an outside collaborator (Stripe) has access to exactly this
project and nothing else.*

**Demonstrates:** cross-app conversation, and **scoped external collaboration**.

**Buildable now: ✅ mostly — and this is the most business-differentiating one.**

| Piece | How |
| --- | --- |
| Conversation started elsewhere, lands in Peek | Already proven — the taskboard does exactly this |
| **Outside collaborator, scoped to one project** | **Buzz's private channels + NIP-29 membership, already built.** A pubkey that is a member of one channel and nothing else. Relay-enforced, not convention |
| Figma frame rendered inline | **NIP-94/NIP-92 `imeta`** for the image + **NIP-89** for "open this in Figma" |
| Resolving with a summary | Peek's `resolved` fields — currently **dropped** at the boundary (FRICTION.md B) |

The scoped-access piece is worth pulling out: it is the Slack Connect equivalent
and the clearest business value in the whole set, and it needs **nothing new**.
Buzz's fail-closed read gating already enforces it.

---

## Scenario 4 — Planning the first PR

*Claude assembles Linear + docs + transcript + Figma + memory into a first-PR plan.*

**Demonstrates:** an agent reading across the shared data layer (§1.4b), and
producing work rather than a summary.

**Buildable now: ✅ yes, at medium effort.**

An agent identity queries several channels and kinds, then posts a plan back.
Buzz's **NIP-OA** owner attestation is fully built, so the agent↔human ownership
half is free. What makes this demo land is that the agent reads *many kinds from
one place* — which is the actual NfB claim, and is true today.

The follow-up questions in beats 3–4 are ordinary `kind:9` messages.

---

## Scenario 5 — Aftermath

*PM asks for AI research in Peek; Posthog and Intercom sub-agents answer.*

**Demonstrates:** agent orchestration across vendors.

**Buildable now: ❌ same blocker as Scenario 2** — sub-agents must be
discoverable and invocable. (Also marked unresolved in the Linear doc, so it may
be in flux anyway.)

---

## The signal in this

Scenarios 2, 4 and 5 all lean on agents. Two of them are blocked, and **both are
blocked on the same missing piece: an agent declaring what it can do.**

That changes my earlier advice. I suggested Highlights as your first NIP; the
survey then showed NIP-84 already exists. **The scenarios point at agent skill
declaration instead** — it is:

- genuinely unclaimed (nothing in 99 NIPs; Buzz stops short),
- the blocker for two of your five scenarios,
- and it has real prior art to build on — Buzz's `KIND_PERSONA` (30175) and
  `KIND_MANAGED_AGENT` (30177) are two thirds of a manifest already, and NIP-89
  is the discovery pattern to copy.

That is a much better first NIP than Highlights: it is needed, it is unclaimed,
and it has a shape to start from rather than a blank page.

---

## Recommended build order

1. **Scenario 1** — small, uses NIP-84/NIP-32, and Peek's `HighlightsCard`
   already exists. Fastest visible win.
2. **Scenario 3's scoped external collaborator** — zero new protocol, highest
   business value, and it exercises Buzz's permission model rather than just its
   event model.
3. **Scenario 2's Linear widget via NIP-89** — proves Layer 3, and nobody has
   built it.
4. **Scenario 4's agent** — medium effort, exercises NIP-OA.
5. **Then** write the agent-skills NIP, informed by having built 1–4.

Steps 1–4 need **no new NIPs at all**. By the time you reach 5 you will have
four implementations telling you what the spec has to say — which is the
argument this whole exercise keeps making.

---

## What each step would still fake

Being explicit, so the demo does not overclaim:

| Scenario | Real | Faked |
| --- | --- | --- |
| 1 | events, relay, Peek's rendering | "Meet" is a stand-in; no real call transcript |
| 2 | NIP-89 handler, live widget data | the canvas is not Figma; no real sub-agent |
| 3 | membership scoping, cross-app conversation | Figma is a stand-in; frame is an uploaded image |
| 4 | agent identity, cross-channel reads | the "sources" are seeded, not real Linear/GitHub |
