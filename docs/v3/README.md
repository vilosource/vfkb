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

Five, all recorded in [`PRD.md`](PRD.md) §0. Rulings 3–5 are summarised there:
**both metrics** (2026-10-09), **priority order R5, R6 → R2 → R1 → R3, R7, R4, R8**
(2026-10-16; R5 then turned out to be already delivered), and **decision models stay
optional inside R7** (2026-10-16). The first two, both 2026-10-08:

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

**Prioritised, two themes closed** *(as of 2026-10-16)*. The order is Ruling 4's:
R5, R6 → R2 → R1 → R3, R7, R4, R8. R2 is the only theme with an RFC so far: RFC-042, accepted as ADR-0077.

- **R5 — already delivered, before this cycle opened.** The plugin's install-path L4
  has had `delivery: proven` since 2026-07-16, so there is nothing to build.
- **R6 — delivered 2026-10-16** as plugin v0.20.1
  ([vfkb-claude-plugin#62](https://github.com/vilosource/vfkb-claude-plugin/pull/62)).
  `claude plugin validate --strict` now runs on every plugin PR.
- **R1 and R3 — dependencies observed** on CLI 2.1.273 in the 2026-10-13 probes
  (harness survey §7a). Both are still *proposed*.
- **R2 — ✅ verified 2026-10-20 (manual compaction).** The probe (harness survey
  §7b) found the shipped plugin already re-injects after compaction via
  `SessionStart(source:"compact")`, by accident and untested. ADR-0077 (amended by
  ADR-0078/0079) made it a guarantee: a matcher Brake, an engine test, and the
  `compaction-survival` L4 (plugin#64, compacted 3/3, contrast 0/3, gate-required).
- **R4 — dependency still unobserved.** That is the `mcp_tool` hook, whose probe has
  not been run. Per §9, it gets probed before anything is built.
- **R7 — in RFC.** Taken ahead of finishing R1 by operator ruling (2026-10-21). The probe (`research/probes/curation-2026-10-21/`) found the problem is handoff lifecycle, not similarity: 84–115 stale handoff facts live, none retired, and a pin that moves when an old handoff is edited. [RFC-045](../rfc/RFC-045-propose-only-curation.md) is accepted as [ADR-0082](../adr/ADR-0082-propose-only-curation.md) (2026-10-21), and R7 is next to build.
- **R8 — proposed.** It depends on Claude Code Projects being available, which has
  not been checked.

**R2 is VERIFIED (2026-10-20) for manual compaction:** RFC-042 → ADR-0077 (amended by ADR-0078/0079); all three clauses landed (plugin#63, vfkb#352, plugin#64), and the compaction-survival L4 is DEMONSTRATED, compacted 3/3 against contrast 0/3, and required by the release gate. Auto-compaction is still unobserved. R1 step 1 then landed and step 2 is gated (ADR-0081). **Next is R7, curation** ([ADR-0082](../adr/ADR-0082-propose-only-curation.md)), re-ratified 2026-10-21.
