# ADR-0002: vfkb is a greenfield reimplementation; mykb is a studied spike

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude
- **Supersedes:** the "leaning evolve mykb" note in `vfkb-DESIGN.md` §6/D6a

## Context

vfkb will be built in TypeScript (ADR-0003), which makes literal reuse of mykb's
TypeScript codebase *possible* — so the real question surfaced: **evolve/fork
mykb, or reimplement clean?**

mykb works well, but it was built earlier, when both our engineering practices and
the field's understanding of agentic coding + memory systems were less mature. It
carries single-user assumptions baked deep: the workspace layer (`kb work`,
journal/handoff/`.active`), a single central brain, a CLI/extension-first surface.
Those are precisely the assumptions a multi-agent, per-project factory memory
should *not* inherit — and the only reliable way to not inherit them is to not
start from that code.

The operator's framing: the lineage **OSB → mykb → vfkb** is generational. mykb
did not fork OSB; it absorbed OSB's lessons and rebuilt better. vfkb does the same
to mykb. mykb is best understood as a **spike** whose value is the knowledge it
produced — one that happens to still run in production and can serve as a live
oracle.

## Decision

Reimplement vfkb **greenfield in TypeScript**, treating mykb as a **reference /
oracle only — zero code inheritance, zero coupling to mykb's roadmap.** Harvest
mykb's *lessons* (kernel shape: JSONL + SQLite/FTS; the scorer's relevance model;
the prompt-cache injection lesson; the trust model; FTS quirks) but write the
implementation fresh, to current engineering standards and the current
understanding of agentic memory. vfkb's design carries a **"Lessons from mykb
(the spike)"** record: per major choice — what mykb did, what it taught, what
vfkb does differently and why.

## Consequences

- **+** Clean architecture aimed at multi-agent/per-project from line one; no
  legacy to unwind; modern practices (testing pyramid, design-first) from the
  start.
- **+** mykb continues its own independent life; no fork-drift, no shared-release
  coupling.
- **+** Freedom to build to the frontier (bi-temporal facts, two-stage retrieval,
  ADR-grade decisions) rather than retrofit mykb v1.
- **−** We forgo the head start of inheriting working code — including mykb's
  ~80%-built Pi auto-injection/capture layer (D7), which must be reimplemented.
  **Mitigated:** mykb runs as a behavioral oracle to validate the reimplementation
  against.
- **Neutral:** "reference, not base" demands discipline — the temptation to
  copy-paste must be actively resisted (ADR-0001's record helps).

## Alternatives Considered

- **Fork mykb into vfkb and diverge** — rejected: inherits the old assumptions
  and pays drift cost forever (every kernel fix lands twice).
- **Extend mykb in place / one codebase, two modes** — rejected: couples a
  personal tool to the factory's constraints and release cadence; bakes the
  single-user model deeper.
- **Verbatim reuse** — rejected explicitly by the operator: mykb is a basis to
  evolve, not to copy.
