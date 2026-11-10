---
paths:
  - "src/components/**"
  - "src/pages/**"
  - "src/layouts/**"
  - "src/extensions/**"
  - "src/api/**"
---

# Data access only through the seam

Components/pages/extensions import app data exclusively from `@/api` (stories:
`@/api/fixtures`) — never from `@/data/*` or `@/api/internal/*`.

All writes go through `usePeekActions()`.

Extend the seam rather than bypassing it.
