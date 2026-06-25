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

`main` is green (**87/87** unit). v1 (per-project tier) is shipped; **M1 (session-continuity Phase A)
shipped** (`ff61215`); **RFC-006 accepted → ADR-0021**; **M2a (curator safety foundation, `ee45289`) +
M2b (distiller + counters + corroborated promotion) shipped**; **M3 (session-continuity Phase B) shipped**
— the resume digest now folds the auto-distilled `incoming` lessons in, trust-labelled and derived.
**Track 1 (memory that carries itself) is complete.** Beyond that:

| Area | State |
|---|---|
| Search hardening | **[done]** relevance-primary (ADR-0016) + relevance floor (ADR-0017) + honest no-match (ADR-0018) |
| Self-hosted design-brain | **[done]** ADR-0019 — vtfkb dogfoods its own `.vtfkb/` (committed SoR + ADR/RFC link-index) |
| L4 cross-model eval | **[done]** 5 harness/model records, 22 scenarios each (deepseek-v4-pro 22/22; 2 known divergences: `tool-gating`, `capture-recall`) |
| Dogfood smoke | **[done]** check 6 hardened — deterministic `tools/list` preflight (6a) + bounded LLM retry (6b) |
| **Session continuity** | **[DONE]** ADR-0020 / RFC-005 — M1 (`ff61215`) + M3 (resume digest folds distilled lessons, trust-labelled, derived) |
| Auto-distill / ACE curator | **[DONE]** RFC-006 → ADR-0021 — curator + never-rewrite Brake (`ee45289`, M2a) + distiller + counters + corroborated promotion (M2b) |
| Embedding reranker | **[proposed]** RFC-003 — evidence-gated, do **not** build speculatively |
| Per-turn injection on Claude Code | **[external-blocked]** ADR-0015 Tier C — waits on upstream hook fixes |

---

## 2. The dependency picture (why order matters)

```
  ADR-0019 self-hosted brain ──┐ (every enhancement below dogfoods here first)
                               │
  ADR-0020 session-continuity ─┤
     Phase A: record + resume render ── ✅ DONE (M1, ff61215)
     Phase B: auto-distilled knowledge ── ✅ DONE (M3) — consumes ▼
                                                   D7b auto-distill / ACE  (RFC-006 → ADR-0021; M2a ✅ + M2b ✅ DONE)
                                                      └─ curator = deltas-not-rewrites (IMPL-PLAN L12); distiller = incoming-only containment

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

**M2 = ACE auto-distill (RFC-006 → ADR-0021), split into two build slices:**

**M2a. Curator safety foundation — `[DONE 2026-06-25, ee45289]`**
The load-bearing safety half (built first because it is *why* this was ADR'd). `src/curator.ts`:
delta-only, text-preserving ops — `promote` (incoming→established), `archive`, `mergeDuplicate`
(archive loser + auditable tag), `findLexicalDuplicates` (proposes, never acts); decisions stay
supersede/transition-only.
- ✅ Gate met: **the structural Brake** (`test/curator.test.ts`) asserts every op leaves entry text
  **byte-identical** — any in-place rewrite fails the build (L12 can't sneak in via prose). Plus a
  **retrieval-quality regression** (a dedup pass keeps the answer surfacing, drops only the duplicate).
  CLI `curate`; dogfooded on vtfkb's own brain. **76/76 green.**

**M2b. Distiller write-side + counters — `[DONE]`** (`src/distiller.ts`, `src/counters.ts`, +`promoteIfCorroborated`)
The deterministic `Distiller` (a captured **failure** → a candidate gotcha written **only** to
`incoming`/unverified/agent-trust — containment) behind a `Distiller` seam an optional off-hot-path LLM
distiller can later fill; the **append-only counter/signal stream** (aggregated at read) that drives
corroborated promotion. **Recurrence = corroboration:** re-distilling the same error *signature* records a
counter signal on the existing candidate instead of duplicating it.
- *Gate — MET:* distiller writes only to `incoming`/unverified/agent (a deterministic **containment Brake**,
  `test/distiller.test.ts`); counters never mutate an entry (append-only test — entry text+`updated` byte-stable);
  promotion needs ≥`PROMOTION_THRESHOLD` net corroborating signals (`promoteIfCorroborated` refuses below it —
  "auto-distill alone cannot mint trusted knowledge"); 84/84 green; dogfooded on `.vtfkb` (clean no-op, no
  pollution) + full loop proven in a temp brain. The build trigger was the operator go-ahead (2026-06-25).
- *Sub-decisions settled (2026-06-25):* **(a) counter storage = operational/gitignored** at
  `<brain>/.signals/counters.jsonl`, mirroring `.sessions` — the durable effect (promotion) lands in the
  committed `entries.jsonl` SoR, so raw tallies stay append-only agent-trust telemetry (survive restart, not
  clone); keeps the brain the single committed SoR. **(b) `tool_result` retention = minimal bounded outcome**
  — capture now classifies each call ok/error (`classifyToolOutcome`) and keeps a ≤120-char summary
  (`capture:ok|error` tag + `→ <summary>`); structured signals (isError/exit/stderr) are authoritative,
  enough for a deterministic error→gotcha distiller without storing full results; the no-secrets lint covers it.

**M3. Session-continuity Phase B — `[DONE]`** (`renderResumeDigest`, `test/resume.test.ts`)
The resume digest now gains the real learned lessons, not just counts: the auto-distilled `incoming`
candidates of the session window are folded in (`distilledLessons` — tag `distilled`, still incoming),
**trust-labelled** (`⚠agent`, "candidates, verify before trusting") with their corroboration count
(M2b counters, aggregated at read). To keep the window honest, `distill` now advances the session
record (`lastAt`) so freshly-distilled lessons fall inside `[startedAt, lastAt]`.
- *Gate — MET:* the digest surfaces distilled `incoming` lessons trust-labelled; the M1 "cannot go
  stale" property still holds — the section is **derived** from the live brain, so a lesson later
  promoted (zone≠incoming) or archived drops out on the next render (anti-stale test). 87/87 green;
  dogfooded — full capture→distill→next-session-resume loop in a temp brain; the real `.vtfkb` honestly
  omits the section (no distilled lessons there).

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

**Order (ratified 2026-06-25):** `M1 ✅ → RFC-006 ✅ → M2a ✅ → M2b ✅ → M3 ✅` — **Track 1 complete.** The
remaining roadmap items are the two **gated/blocked** tracks: **S1** (embedding reranker) builds only if its
evidence trigger fires; **P1** (Claude Code per-turn push) only if upstream unblocks. One build in flight at
a time; each behind an accepted ADR.

*Gate-resolution note (2026-06-25):* the M2 *build* is evidence-gated (D7b — write-volume bottleneck),
which conflicted with the bare order. Resolved: an **explicit operator go-ahead** is a valid trigger
(the same escape hatch S1 carries), and the operator gave it — so M2 builds now, non-speculatively.

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

### ▶ Current action — **Track 1 COMPLETE; hold at the two gated tracks (no speculative build)**
M1 ✅, RFC-006 ✅ (→ ADR-0021), **M2a ✅** (`ee45289`), **M2b ✅** (distiller + counters + corroborated
promotion), **M3 ✅** (resume digest folds the auto-distilled lessons in, trust-labelled + derived; 87/87,
dogfooded). **Track 1 — "memory that carries itself" — is built end-to-end:** continuity record → resume
digest → auto-distill write-side → curator maintenance → corroborated promotion → distilled lessons back
into the digest. **There is no next in-order build.** The only remaining roadmap items are **gated/blocked**,
and per the execution protocol they are NOT built on spec:
- **S1 (embedding reranker, RFC-003)** — build *only* on a **2nd** live phrasing-robustness miss **or** an
  explicit operator request. Keep the `selectIndex()` seam warm; nothing else.
- **P1 (Claude Code per-turn push, ADR-0015 Tier C)** — **external-blocked**; watch upstream `UserPromptSubmit`
  hook bugs, build (a new ADR) only when fixed.

So the standing action is **watch the two triggers** — not poll for "what's next." A new in-repo build
starts only when a trigger fires or the operator opens a new fork; either way, **update + re-ratify this
roadmap first**. (H2 fleet/ingest + H3 global tier remain parked, out of scope for in-repo work.)

*Milestones for the record:* **M1** = derived append-only continuity record + resume render (6/6 DoD).
**M2a** = curator deltas-only ops + the structural Brake (text byte-identical) + retrieval-quality
regression. **M2b** = deterministic distiller (failure→candidate gotcha, `incoming`-only containment Brake)
+ append-only counter stream (aggregated at read) + corroborated promotion (`promoteIfCorroborated`);
capture now retains a bounded ok/error outcome. **M3** = the resume digest folds the session's auto-distilled
`incoming` lessons in, trust-labelled + derived (anti-stale holds). All dogfooded on vtfkb's own brain; each
behind an accepted ADR (0020 / 0021).

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
0001/0004/0005/0011/0012/0013/0014/0015/0016/0017/0018/0019/0020/0021, RFC-003/005/006, and the 2026-06-25
session (L4-eval ground-truthing, ADR-0019 build, check-6 hardening, RFC-005 acceptance → ADR-0020, M1
build `ff61215`, RFC-006 → ADR-0021 + M2a curator `ee45289`).
