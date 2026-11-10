# Moved — see estiva-docs

This document now lives at **`estiva-docs/protocol/FILES_ARCHITECTURE.md`**.

It records a cross-app decision — that documents and folders use **git hosted on
the relay** rather than addressable Nostr events, because git already provides
folders, history and, decisively, multi-writer merge. That conclusion constrains
Peek, Ship and Leaf equally and does not become wrong when this repo's code
changes, so by `estiva-docs`' own test it belongs there:

> If I change code in repo X, does this document become wrong?
> Yes → it lives in X. No → it lives here.

The superseded draft it argues against moved with it, to
`estiva-docs/protocol/nips/NIP-FC.md`.

Summarised, with the decisive quote, in
`estiva-docs/decisions/0001-relay-canonical-by-default.md` §6.

**This stub exists so links from `RFC_UPDATES.md` and `README.md` still resolve.**
Do not restore the content here — a second copy drifts from the first, and the
drift is invisible until somebody builds against the wrong one.
