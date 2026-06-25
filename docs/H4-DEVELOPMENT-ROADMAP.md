# vtfkb — H4 Development Roadmap (the active, in-repo frontier)

> **Type:** sequenced build plan for the H4 "robustness & quality" frontier. **Created:** 2026-06-25.
> Sits under [STATUS-AND-ROADMAP](STATUS-AND-ROADMAP.md) §4 H4 (the broad north-star) and above
> the decisions ([docs/adr/](adr/)) + proposals ([docs/rfc/](rfc/)) it sequences. It does **not**
> ratify — ADRs do; it orders *accepted/proposed* work so we build coherently, not ad hoc.
> Scope is **in-repo only** (H0+H4); fleet/ingest integration (H2) and the global tier (H3) stay
> parked. Claims tagged **[done]**, **[accepted]**, **[proposed]**, **[designed]**, **[external-blocked]**.

---

## 1. Where we are (status snapshot, 2026-06-25)

`main` is green (64/64 unit) and the per-project tier (v1) is shipped. Beyond v1:

| Area | State |
|---|---|
| Search hardening | **[done]** relevance-primary (ADR-0016) + relevance floor (ADR-0017) + honest no-match (ADR-0018) |
| Self-hosted design-brain | **[done]** ADR-0019 — vtfkb dogfoods its own `.vtfkb/` (committed SoR + ADR/RFC link-index) |
| L4 cross-model eval | **[done]** 5 harness/model records, 22 scenarios each (deepseek-v4-pro 22/22; 2 known divergences: `tool-gating`, `capture-recall`) |
| Dogfood smoke | **[done]** check 6 hardened — deterministic `tools/list` preflight (6a) + bounded LLM retry (6b) |
| **Session continuity** | **[accepted]** ADR-0020 / RFC-005 — **build sequenced below (the immediate next work)** |
| Auto-distill / ACE curator | **[designed]** D7b — needs an RFC before build |
| Embedding reranker | **[proposed]** RFC-003 — evidence-gated, do **not** build speculatively |
| Per-turn injection on Claude Code | **[external-blocked]** ADR-0015 Tier C — waits on upstream hook fixes |

---

## 2. The dependency picture (why order matters)

```
  ADR-0019 self-hosted brain ──┐ (every enhancement below dogfoods here first)
                               │
  ADR-0020 session-continuity ─┤
     Phase A: record + resume render ── independent, in-repo, NOW
     Phase B: auto-distilled knowledge ──────────► needs ▼
                                                   D7b auto-distill / ACE  (RFC-006, next)
                                                      └─ curator = deltas-not-rewrites (IMPL-PLAN L12)

  RFC-003 embedding reranker ── independent track, EVIDENCE-GATED (2nd phrasing miss | explicit ask)

  ADR-0015 Tier-C per-turn push on Claude Code ── EXTERNAL-BLOCKED (watch upstream)
```

Two facts drive the sequence:
1. **Session-continuity Phase B *depends on* auto-distill (D7b).** Phase A (the record + resume
   render) does not — so Phase A ships now, and auto-distill is the natural *next* design+build,
   which then unlocks Phase B.
2. **Embeddings and Tier-C parity are independent of the continuity/distill line** — embeddings is
   gated on evidence, Tier-C on an upstream fix. Neither blocks anything; neither is built on spec.

---

## 3. Sequenced plan

### Track 1 — Memory that carries itself (continuity → auto-distill)  *(primary line)*

**M1. Session-continuity Phase A — `[accepted, NEXT BUILD]`** (ADR-0020)
Append-only per-session record (extend `SessionState` beyond `{injectedIds,turnCount}`) +
derived digest (entries added/used/superseded + captured tool calls; optional caller commit/test
signals labelled asserted) + the Tier-A **resume render** + a thin `kb_resume` CLI/MCP command.
- *Dogfood first on vtfkb's own brain* (ADR-0019) — the resume render is exercised on this repo.
- *Gate:* a deterministic test that a derived record cannot go stale (re-derives from ground truth)
  + the resume render obeys ADR-0005 (no stale surfaced) and the 10k-char Tier-A budget.
- *Backstop (P2):* the "can't go stale" property is unit-tested deterministically, not asserted.

**M2. Auto-distill / ACE — `[designed → draft RFC-006 next]`** (D7b, IMPL-PLAN L12)
The write side (distil gotchas/decisions from a session into the `incoming` zone) + the curator
(prune/merge/promote/dedupe **by deltas + counters, never whole-entry rewrites** — the L12 scar).
- *Author RFC-006 before any build* (this is the riskiest item — an over-eager curator that
  deletes good knowledge is the worst memory failure; decide the shape + the safety rails first).
- *Gate:* curator emits only append-only entries / status transitions (no destructive edits);
  a regression proves a curation pass never lowers retrieval quality on a fixed corpus.

**M3. Session-continuity Phase B — `[blocked on M2]`**
Fold auto-distilled knowledge into the continuity record (the digest gains real learned lessons,
not just counts). Ships after M2 lands.

### Track 2 — Search robustness (embeddings)  *(parallel, evidence-gated)*

**S1. Embedding reranker — `[proposed, GATED]`** (RFC-003)
Opt-in "accuracy mode" on explicit search; in-memory vectors (no vector DB at per-project scale);
embedder optional/auto-detected/graceful-degrade (ADR-0013); **forbidden on the injection path**.
- *Build trigger (unchanged):* a **2nd** observed live phrasing-robustness miss **or** an explicit
  operator request. The design (shape) is already locked in RFC-003 — only the build is gated.
- *Do not build on spec.* Keep the `selectIndex()` seam warm; nothing else until the trigger fires.

### Track 3 — Cross-harness parity  *(watch, not build)*

**P1. Per-turn push on Claude Code — `[external-blocked]`** (ADR-0015 Tier C)
Claude Code degrades to MCP-pull today because `UserPromptSubmit` is documented-unreliable +
cache-inefficient. *Action: periodically re-check the upstream hook bugs; build a Tier-C push (a
new ADR superseding the Tier-C clause) only when they are fixed.* No work until then.

---

## 4. Recommended order (one line)

**M1 (now) → RFC-006 for M2 → M2 → M3**, with **S1 built only if its evidence trigger fires** and
**P1 only if upstream unblocks**. One build in flight at a time; each behind an accepted ADR.

---

## 5. Standing principles (what keeps it coherent)

These are the invariants every item above must honour — they are *why* the plan hangs together:

1. **Decisions before code.** Every build sits behind an Accepted ADR (ADR-0001/0004/0007). An RFC
   decides the *shape*; the build is mechanical once accepted ("runbook complete before execute").
2. **Evidence-gated, never speculative.** Gated items (S1) stay gated until real evidence or an
   explicit ask. Deciding the shape early ≠ building early.
3. **Dogfood each enhancement on vtfkb's own brain** (ADR-0019) before claiming it works.
4. **Deterministic backstop > probabilistic gate** (P2). Every probabilistic check (LLM, L4) gets a
   deterministic unit/wire-level backstop; that backstop is the real gate.
5. **Derived-not-dictated; deltas-not-rewrites; no native dep on the hot path.** The three standing
   constraints behind ADR-0020, M2, and ADR-0013 respectively.
6. **Verified vs asserted.** Report observed-vs-asserted in artifacts and status; a stale assertion
   outliving the truth is the failure ADR-0020 exists to kill (2026-06-25 stale-L4 incident).
7. **One build in flight; report the diff before merging.** No overlapping long runs; surface what a
   change does (and whether it deploys/triggers) before landing it.

---

## 6. Provenance
Grounded in [STATUS-AND-ROADMAP](STATUS-AND-ROADMAP.md) §3–4, [DESIGN](DESIGN.md) (D1 seam, D7b),
[IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) (L12 deltas-not-rewrites), ADRs 0005/0012/0013/0014/0015/0016/0019/0020,
RFC-003/005, and the 2026-06-25 session (L4-eval ground-truthing, ADR-0019 build, check-6 hardening,
RFC-005 acceptance).
