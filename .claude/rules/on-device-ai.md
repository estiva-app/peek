---
paths:
  - "src/lib/promptApi.ts"
  - "src/lib/prefill.ts"
  - "src/components/CommandLauncher*.tsx"
  - "src/nostr/promptContext*"
---

# On-device AI only

A model may run **locally** (Chrome's Prompt API / Gemini Nano) over a thread
the viewer can already read, and a work thread must never be sent to a cloud
model — that would be a disclosure, and the suite's whole position is that a
Folder is readable only by its members.

Anything cloud-hosted still needs a decision, not an implementation.

It must also degrade to nothing: the API is desktop-Chrome-only and needs a
downloaded model, so most people never see it and nothing may look broken for
them (PEE-6).
