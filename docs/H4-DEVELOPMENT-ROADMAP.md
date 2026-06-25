# vtfkb — H4 Development Roadmap (the active, in-repo frontier)

> **Type:** sequenced build plan for the H4 "robustness & quality" frontier. **Created:** 2026-06-25.
> Sits under [STATUS-AND-ROADMAP](STATUS-AND-ROADMAP.md) §4 H4 (the broad north-star) and above
> the decisions ([docs/adr/](adr/)) + proposals ([docs/rfc/](rfc/)) it sequences. ADRs ratify the
> *decisions* (what to build); **this roadmap ratifies the *order* and is the standing authority to
> execute it** (§4) — proceed in sequence without per-step approval; stop only at the named gates. A
> "what's next?" question is a signal to update + re-ratify §4, not to ask.
> Scope is **in-repo only** (H0+H4); fleet/ingest integration (H2) and the global tier (H3) stay
> parked. Claims tagged **[done]**, **[accepted]**, **[proposed]**, **[designed]**, **[external-blocked]**.

---

## 1. Where we are (status snapshot, 2026-06-25)

`main` is green (**69/69** unit). v1 (per-project tier) is shipped; **M1 (session-continuity Phase A)
shipped 2026-06-25** (`ff61215`); **RFC-006 (auto-distill/ACE) drafted — Proposed**. Beyond that:

| Area | State |
|---|---|
| Search hardening | **[done]** relevance-primary (ADR-0016) + relevance floor (ADR-0017) + honest no-match (ADR-0018) |
| Self-hosted design-brain | **[done]** ADR-0019 — vtfkb dogfoods its own `.vtfkb/` (committed SoR + ADR/RFC link-index) |
| L4 cross-model eval | **[done]** 5 harness/model records, 22 scenarios each (deepseek-v4-pro 22/22; 2 known divergences: `tool-gating`, `capture-recall`) |
| Dogfood smoke | **[done]** check 6 hardened — deterministic `tools/list` preflight (6a) + bounded LLM retry (6b) |
| **Session continuity** | **[Phase A DONE]** ADR-0020 / RFC-005 — M1 shipped (`ff61215`, 69/69); Phase B = M3 (pending M2) |
| Auto-distill / ACE curator | **[Proposed]** RFC-006 (D7b, IMPL-PLAN L12) — shape + safety rails decided; awaiting acceptance, build evidence-gated |
| Embedding reranker | **[proposed]** RFC-003 — evidence-gated, do **not** build speculatively |
| Per-turn injection on Claude Code | **[external-blocked]** ADR-0015 Tier C — waits on upstream hook fixes |

---

## 2. The dependency picture (why order matters)

```
  ADR-0019 self-hosted brain ──┐ (every enhancement below dogfoods here first)
                               │
  ADR-0020 session-continuity ─┤
     Phase A: record + resume render ── ✅ DONE (M1, ff61215)
     Phase B: auto-distilled knowledge ──────────► needs ▼
                                                   D7b auto-distill / ACE  (RFC-006 — Proposed, awaiting accept)
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

**M1. Session-continuity Phase A — `[DONE 2026-06-25, ff61215]`** (ADR-0020)
Append-only per-session record (`SessionState` extended) + derived digest (added/superseded
re-derived from the brain window; injected/captured/turns from the record; note/signals labelled
ASSERTED) + the Tier-A **resume render** + `resume`/`resume-note` CLI + `kb_resume` MCP tool (8 tools).
- ✅ Dogfooded on vtfkb's own brain (ADR-0019); ✅ resume obeys ADR-0005 + the 10k budget.
- ✅ Gate met: `test/resume.test.ts` proves the digest **cannot go stale** (a mutated brain
  re-derives a different digest from the SAME record) — the deterministic P2 backstop. **69/69 green.**

**M2. Auto-distill / ACE — `[RFC-006 Proposed → awaiting acceptance, then build]`** (D7b, IMPL-PLAN L12)
The write side (distil gotchas/decisions from a session into the `incoming` zone) + the curator
(prune/merge/promote/dedupe **by deltas + counters, never whole-entry rewrites** — the L12 scar).
- ✅ *Shape + safety rails decided* in [RFC-006](rfc/RFC-006-auto-distill-and-curator.md) (the riskiest
  item — an over-eager curator deleting good knowledge is the worst memory failure; designed before build).
- *Gate (build):* auto-distill writes only to `incoming`/unverified (containment); a **structural Brake**
  fails the build on any in-place rewrite; counters are append-only (aggregated at read); a regression
  proves a curation pass never lowers retrieval quality on a fixed corpus. Build is **evidence-gated**
  (D7b — when explicit-write volume becomes the bottleneck).

**M3. Session-continuity Phase B — `[blocked on M2]`**
Fold auto-distilled knowledge into the continuity record (the digest gains real learned lessons,
not just counts). Ships after M2 lands.
- *Gate:* the resume digest surfaces distilled `incoming` lessons **trust-labelled** (ADR-0005), and the
  M1 "cannot go stale" property still holds (the digest stays derived, never a stored prose blob).

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

## 4. Ratified order + execution protocol

**Order (ratified 2026-06-25):** `M1 ✅ → RFC-006 ✅ (Proposed) → M2 build → M3`, with **S1 built only
if its evidence trigger fires** and **P1 only if upstream unblocks**. One build in flight at a time;
each behind an accepted ADR.

**This order is a standing authorization, not a menu.** For in-repo vtfkb development, this roadmap
*is* the decision — proceed through it in order **without per-step approval**. Do **not** ask "what's
next" or "M1 or M2"; the next action is whatever this section names. The decision points are the
**gates** listed per milestone in §3 (and the explicit triggers for S1/P1) — those, not "what's
next," are where judgment is applied.

**Stop and re-ratify the roadmap (don't just ask ad hoc) only when:**
1. a milestone **gate fails** (report the failure + proposed fix, then resume),
2. a **gated item trips** (a 2nd phrasing miss → S1; upstream hook fix → P1),
3. a **blocker or new fork appears** that this roadmap does not already decide.

In all three cases the response is the same: **update this roadmap and re-ratify it**, then continue
— never leave the next step to an ad-hoc question. (Scope: in-repo `vtfkb` only; vafi/vtaskforge
work stays out-of-scope/HITL per H2.)

### ▶ Current action — **awaiting decision: accept RFC-006, then build M2**
M1 ✅ (`ff61215`, 69/69 green) and RFC-006 ✅ drafted
([Proposed](rfc/RFC-006-auto-distill-and-curator.md)). The roadmap now sits at its one designated
**decision gate** (ADR-0007 comment period): **RFC-006 acceptance**. On **accept** → promote to an ADR
and **build M2** (deterministic distiller to `incoming` + curator deltas/counters + the structural
Brake + the retrieval-quality regression), which then unlocks **M3** (continuity Phase B). This is a
decision gate, not a "what's next" poll — execution resumes automatically on acceptance.

*Milestones for the record:* **M1 DoD** (all ✅) = (1) append-only `SessionState` record; (2) derived
digest; (3) Tier-A resume render (ADR-0005 + 10k budget); (4) `kb_resume` CLI+MCP; (5) dogfood on
vtfkb's own brain; (6) deterministic "cannot go stale" test. **RFC-006** decided M2's shape + the
three safety rails (containment-by-zone, never-rewrite Brake, quality regression).

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
[IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) (L12 deltas-not-rewrites), ADRs
0001/0004/0005/0011/0012/0013/0014/0015/0016/0017/0018/0019/0020, RFC-003/005/006, and the 2026-06-25
session (L4-eval ground-truthing, ADR-0019 build, check-6 hardening, RFC-005 acceptance → ADR-0020, M1
build `ff61215`, RFC-006 draft).
