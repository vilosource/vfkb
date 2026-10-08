# vfkb v3 — research & planning

> **What this directory is.** The working area for the **next** generation of vfkb:
> research surveys, the PRD, and (later) the RFCs each theme graduates into.
> **Nothing in here is decided.** Created 2026-10-07.

## Why "v3", and the thing you need to know first

**"v2" is already a completed cycle in this repo.** It shipped to `main` on
2026-07-08 via **PR #86**, merge `5bb087e`, delivering ADR-0039…0044. Its historical
record is [`../V2-VISION.md`](../V2-VISION.md) and
[`../V2-ROADMAP.md`](../V2-ROADMAP.md), and ADR-0036's two-branch strategy is
historical for that cycle — the `v2` branch is merged and deleted.

Two details about that cycle's artifacts, because both mislead a reader who assumes
otherwise:

- `5bb087e` is confirmed server-side as PR #86's merge commit, but it is **not an
  object in a fresh local clone** — the `v2` branch is gone, so `git show 5bb087e`
  fails locally.
- The **`v2-shipped` tag does not mark the ship.** It points at `8aca738`, the PR #85
  docs-sync merge. Do not read that tag as the ship commit.

So this is the generation *after* that one, and it is called v3 to keep those two
documents unambiguous.

**v3 is a generation name, not a semver target.** The package is at **0.9.1** and
has never declared a stable API. Whether this cycle ships as 0.10, 1.0 or 2.0 is an
open question in the PRD (§7 Q5) — do not read "v3" as "3.0".

## Contents

| File | What it is | Status |
|---|---|---|
| [`PRD.md`](PRD.md) | Product requirements — §0 the operator rulings and the one hard constraint, eight themes (R1–R8), the remaining open decisions, the DoD this cycle must satisfy | **DRAFT / unratified** |
| [`research/claude-code-harness-2026-10.md`](research/claude-code-harness-2026-10.md) | What the Claude Code harness offers now vs. what vfkb was built against; the per-surface gap | Research survey |
| [`research/brain-compatibility-2026-10.md`](research/brain-compatibility-2026-10.md) | What "no records lost" costs and forbids; the on-disk contract field by field; ranked record-loss risks; the L4 that proves no-loss | Research survey |

Companion research outside this directory, which the PRD leans on heavily:

- [`../research/decision-models-2026-10.md`](../research/decision-models-2026-10.md)
  — the decision-model class, **and** the measurement that gives v3 its problem
  statement: six entries reach a session out of 456 eligible.

## The one-line thesis

> **v2 made the brain correct. v3 makes it reach the agent at the moment it is
> needed, and makes its delivery provable.**

v2 was plumbing — concurrency, merge semantics, schema honesty, a storage seam. It
did not change what reaches an agent, and the measurement says what reaches an agent
is ~1.3% of what is eligible, with the reranker itself contributing two entries.

## How this directory works

1. **Research first, and tiered.** Every survey marks each claim `[cli]` (ran it),
   `[repo]` (measured here), `[docs]` (read it) or `[secondary]` (press), and ends
   with a **Not verified** section. Same discipline as
   [`../research/`](../research/). The reason is specific, not ceremonial: the
   harness survey's most important dependencies are `[docs]` only, and a surface you
   have not observed is not a surface you can design against
   (brain `61daf266f883`).
2. **Probe before propose.** A `[docs]`-only dependency gets an observation probe
   before its RFC is written. The five that gate this cycle are listed in the
   harness survey §7.
3. **One RFC per theme.** The PRD is **not** a package deal. Each of R1–R8
   graduates into its own RFC under [`../rfc/`](../rfc/) — not into this directory —
   and only an ADR decides (ADR-0007). Expect some themes to be rejected.
4. **The roadmap stays the authority.** `../H4-DEVELOPMENT-ROADMAP.md` §4 is the
   execution authority. Nothing here is scheduled work until a theme is ratified and
   sequenced there, and this directory never becomes a second roadmap.
5. **The DoD does not relax for a new cycle.** ADR-0050/0051 bind every theme:
   sandboxed agent-driven L4, DEMONSTRATED ≥2/3, a can-fail arm, observed not
   asserted, and `--plugin-dir` is not a real surface. PRD §8 names the two hazards
   specific to v3.

## Rulings so far

Two, both 2026-10-08, both recorded in [`PRD.md`](PRD.md) §0:

1. **v3 may be a full rewrite.** Breaking changes are allowed. This withdrew the
   first draft's non-goal N1 ("not a rewrite"), and the PRD records that inversion
   rather than quietly deleting it.
2. **No records may be lost** — *"either compatibility or migration"*. The
   compatibility survey sharpens this into a floor rather than a choice:
   **read-compatibility is mandatory and migration is optional on top of it**,
   because mixed engine versions, a manifest that cannot gate writes, and
   `merge=union` all keep writing old-format lines into a brain after it is
   migrated. ~1,388 live records are at stake, ~912 of them outside this repo.

So the rewrite is free above the log and constrained at it: `id`s, the `updated`
spelling, tombstone semantics and one-JSONL-line-per-record with the LWW fold are
fixed points. Everything else in the envelope is open, because unknown fields
already pass through.

## Status of the cycle

**Pre-ratification.** The PRD exists; no theme has an RFC; nothing is built. The
honest status of every requirement is *proposed*.

Two of the eight themes (R5, R6) rest on dependencies **verified by running the
installed CLI**, and both retire obligations vfkb already carries — ADR-0051's
mandatory "delivery is unproven" disclosure, and ADR-0048's pending plugin-manifest
validation. Four themes (R1–R4) rest on hook events that are documented but
**unobserved on the installed version**, which is why §9's first step is probing
rather than building.
