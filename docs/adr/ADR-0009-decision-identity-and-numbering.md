# ADR-0009: Decision identity = nanoid; human ADR ordinal assigned at merge-to-`main`

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

Humans want friendly sequential IDs ("ADR-0007"), but a sequential counter needs a
**central authority**, which fights merge=union + concurrent branch writes: two
agents on two task branches both grab "ADR-0007" → collision on merge. mykb uses
8-char **nanoids** (collision-free) but those are not human-friendly.

## Decision

Split *identity* from *display*:

- **nanoid = the canonical identity.** All references (`refs.supersedes`,
  `refs.related`) use it. Collision-free by construction; survives merge=union.
- **The human-facing ADR ordinal (`adr_no`) is assigned by the engine when the
  decision lands on `main`.** Because `main` merges are **serialized** and the
  engine is the **sole writer** (D4a) on a **linear** main history, the counter
  increments only in that linear history → **monotonic, no collision, no
  renumbering.** Architect direct-to-`main` writes (D4b) get it immediately;
  task-branch writes get it at merge. Branch-only/abandoned decisions never receive
  an ordinal (they are not canonical).

## Consequences

- **+** Both properties at once: stable machine identity **and** a friendly
  `ADR-NNNN` for humans.
- **+** No distributed counter; no renumbering of already-assigned ordinals.
- **−** The engine must own ordinal assignment at the main-landing step (a small,
  well-defined responsibility for the sole writer).

## Alternatives Considered

- **nanoid only, no ordinal** — rejected: loses the familiar `ADR-NNNN`
  ergonomics humans cite by.
- **Derived ordinal recomputed at every rebuild (by created-timestamp)** —
  rejected: a late-merging older decision shifts every subsequent number
  (display-ID churn).
