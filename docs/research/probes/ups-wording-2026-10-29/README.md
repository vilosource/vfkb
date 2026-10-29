# Probe: does the wording of the UserPromptSubmit stale line decide the wrap-up handoff?

**Issue:** [vfkb#411](https://github.com/vilosource/vfkb/issues/411) (handoff-nudge redesign, tracking [#389](https://github.com/vilosource/vfkb/issues/389)).
**Governing text:** ADR-0084 §2.4, RFC-047 §4.3 constraint 2, phase-4 decision D4 (`38c3b8de85ee`).
**Kind:** Tier-0 probe (ADR-0029 §5). It is not an agent-driven L4 and it is not part of `npm test`. It does not replace the gate: whatever it finds, `scenarios/handoff-next-prompt.mjs` stays the Definition of Done.
**Decisions this probe follows:** `f1b1304bb961` and `5d96cf3b3144` (PR #413), under operator ruling `54802539cda7`. Open design questions were settled by a Fable decide step, recorded in the brain on this branch with role=human.

## PRE-REGISTRATION (committed and pushed before any trial ran)

This section is the rule. It was committed and pushed before the first metered trial. The commit's sha and push time are the evidence. Nothing in this section changes after the data comes in; results go in a later section added by a later commit.

### Why

`handoff-next-prompt` treatment-stale went from 3/3 (engine `b5f0fef`) to 1/3 (engine `e2ac6e9`, vendored bundle sha256 `9d938a39…`). Between those runs #401 changed the stale line in **two** ways at once:

1. it added the inline commit list (`predates 1 commit on feat/work: e657c56 docs: release checklist`);
2. it added the tail ` — the next session sees this same list at start`.

The treatment-b1 line has neither, and its arm stayed 3/3. This probe separates the two changes, one variable each, without changing the engine.

### Variants (verbatim, one variable each)

The engine is not modified. The UserPromptSubmit hook command in every arm is the real engine piped through a pure rewrite step (`scenarios/lib/ups-wording.mjs`, `applyVariant`) that touches only `hookSpecificOutput.additionalContext`.

- **V0 (control):** the engine's own line, byte for byte. On the sandbox it reads:
  `vfkb handoff status: the pinned handoff (<pin id>, <date>) predates 1 commit on feat/work: <sha7> docs: release checklist. If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what changed and what is next is the one thing worth recording before finishing; otherwise nothing is needed now — the next session sees this same list at start.`
- **V1 (tail removed):** V0 with exactly ` — the next session sees this same list at start` removed. Everything else is V0's bytes. The line ends `otherwise nothing is needed now.`
- **V2 (list removed):** V0 with exactly the `: <sha7> <subject>[; …][ (+k more)]` segment removed. The count stays (`predates 1 commit on feat/work`), and the tail stays byte for byte, even though "this same list" then refers to Part A's SessionStart list rather than anything in the line. The 7-character hashes go with the subjects. This is the literal one-variable reading (decide step). It is **not** the `b5f0fef` shape (`predates a later commit on …`, no tail), which differs from V0 in three things.

<pin id>, <date> and <sha7> are the sandbox's real values, produced by the engine.

### Engine

The vendored plugin v0.22.0 bundle: vilosource/vfkb-claude-plugin commit `479fad1`, `plugin/dist/bundles/vfkb.mjs`, sha256 `9d938a399fc9684d3fbd315655e495283934cc2cc4bf5696901b813a7c00f363`, with `vfkb-mcp.mjs` sha256 `e1948509ecc274d3e4b04263a45c4b0a72a59024dc41f7ac82e7bc8a8a5369f7`. These are the exact bytes of the failing record. The probe checks both hashes before any trial; a mismatch aborts the run with no record.

### Sandbox and trial

One trial = one fresh sandbox and one session, the same as `handoff-next-prompt.mjs` treatment-stale: turn 1 asks the agent to create `src/greeter-<hex>.ts`; between turns the harness commits `docs/notes.md` as `docs: release checklist`; turn 2 (`--resume`) is `That's everything for today — we're done for this session, thanks.` The user-scope vfkb plugin is disabled and asserted off from the `init` event; `modelUsage` must show only `claude-haiku-4-5`; SessionEnd is wired on turn 2 only; the Stop hook's stdout is tee'd.

### Pass predicate (the gate's own, so the probe predicts the gate)

A valid trial **passes** iff all of:

- the emitted turn-2 line (from the UserPromptSubmit tee log) equals the variant's expected text;
- an agent handoff (`isAgentHandoff`: tagged handoff or next, not `auto`) written during turn 2 mentions the sentinel (`mentions`, from `scenarios/lib/nudge-verdict.mjs`);
- no deterministic hook-output failure: no line on turn 1, the Stop hook ran, and Stop carried neither `vfkb handoff check` nor `vfkb stale-handoff check`.

A turn-2 reply that asks a question or signs off without a handoff is a valid **FAIL**. It is the behaviour under measurement.

### INVALID (void: never scored, re-collected)

A trial is INVALID if any of:

1. isolation breach: the vfkb plugin loaded or its tools are present; `modelUsage` keys are not exactly `claude-haiku-4-5`; no `init` or `result` event;
2. a turn did not engage: either turn lacks a `result` event;
3. a leak into the real repo (the scenario's `leaks()` check);
4. the UserPromptSubmit hook did not run on both prompts;
5. the turn-2 line was not emitted, or the emitted line is not the variant's expected text verbatim (this also catches a mis-wired variant);
6. the engine's raw turn-2 line does not have the V0 shape (`predates 1 commit on feat/work: <sha7> docs: release checklist. … — the next session sees this same list at start.`);
7. the rewrite step reported a transform miss (`void: transform-miss` in the side log).

Run-level precondition, checked before the first metered trial: on the fixture line recorded at `e2ac6e9` (`scenarios/records/handoff-next-prompt.json`), the tail and the inline list are each found exactly once, and V0, V1, V2 are pairwise distinct. Failure aborts with no record. This is also pinned by `test/ups-wording.test.ts`.

### Trials, order, cap

- N = **5 valid** per variant; at most **10 attempts** per variant.
- Order: **round-robin**, fixed. Each round runs V0, V1, V2 in that order, skipping a variant that already has 5 valid. A fresh sandbox per trial. One live run at a time, serially.
- The run stops when all three have 5 valid, or as soon as any variant reaches 10 attempts with fewer than 5 valid.
- Only the first 5 valid trials of each variant are scored.
- **Single attempt.** The probe runs once: 3 variants × N=5. There is no second batch whatever the result. An INVALID trial is re-collected inside this run's cap; it does not open a second attempt.

### Decision rule

Let `p(V)` be the passes among the 5 scored valid trials of V. A variant **separates** iff `p(V) ≥ 4` and `p(V0) ≤ 3`. (4/5 is `ceil(2·5/3)`, the gate's own DEMONSTRATED formula at N=5.)

Evaluated in this order; exactly one outcome applies:

1. **VOID** — some variant has fewer than 5 valid trials at its cap. The rule is not evaluated. Verdict: fix the harness. This never routes to outcome 4.
2. **ADOPT-V1** — V1 separates (whether or not V2 also separates). Ship V1: drop the tail. A new amending ADR (ADR-0086) amends ADR-0084 §2.4 and, by reference, RFC-047 §4.3 constraint 2 (RFC body not edited; status pointer only). D4 stands.
3. **ADOPT-V2** — only V2 separates. Ship V2's exact probed text: the prompt line drops the inline list (hashes and subjects), keeps the count and the tail; Part A and the B3 Stop text keep the list. ADR-0086 strikes D4's inline-subset sentence, and decision `38c3b8de85ee` is superseded with `kb_supersede`.
4. **NEITHER** — no variant separates, and no variant beats V0 by 2 or more (`p(V) − p(V0) ≤ 1` for V1 and V2). Ship the `e2ac6e9` text unchanged and run the gate once on the final vendored bundle. If that is red, the hold stays and ADR-0084 §2.4 reopens as a new RFC.
5. **SIGNAL-WITHOUT-CLEARANCE** — no variant separates, but some variant beats V0 by 2 or more (for example V1 3/5 against V0 0/5). Return a blocker; no engine change, no extra trials, no further variants, no lowering of the bar. The next step is a fresh decide question, not "try another wording".

"Within 1 trial" in `f1b1304bb961`'s neither-branch is read as the single-attempt budget above, not as a margin; the margin in outcome 5 comes from the gap-case decision. A V0 result above a variant (the variant worse) is not a signal for a wording change and falls under outcome 4.

After an ADOPT outcome, the engine change lands in `src/prompt-nudge.ts` with its unit pins edited first and observed RED, then `scenarios/handoff-next-prompt.mjs` re-runs on the built `dist/` once. It must be DEMONSTRATED on every arm. A red gate is not re-rolled.

### What the probe does not claim

It runs one fixture (one foreign commit, `docs: release checklist`). It says nothing about B1 lines, multi-commit lists, the `(+k more)` form, or other models.

## RESULTS (added after the run; the section above is unchanged)

**Run:** 2026-10-29 12:00–12:09 UTC, one run, Claude Code **2.1.292**, `claude-haiku-4-5`, macOS arm64. The engine hashes matched (`9d938a39…` / `e1948509…`) and the run-level precondition passed. The rule commit `0af204f` was pushed at 11:57:34 UTC, before the first trial at 12:00:22 UTC. The harness ran at `9d953b8`. The raw record is `observed.json`.

| Variant | attempts | valid | passes (of the first 5 valid) |
|---|---|---|---|
| V0 (e2ac6e9 text, control) | 7 | 5 | **5/5** |
| V1 (tail removed) | 6 | 5 | **5/5** |
| V2 (list removed) | 7 | 5 | **4/5** |

**Verdict: outcome 4, NEITHER.** No variant separates, because V0 scored 5/5 and not ≤3/5. No variant beats V0 by 2 or more. Under the pre-registered rule the e2ac6e9 text ships unchanged, and `handoff-next-prompt` is run once on the final vendored bundle.

### Observed

- **The control did not reproduce the regression.** On the exact bytes of the failing record, with the same fixture and shape, V0 wrote a sentinel-carrying agent handoff in 5 of 5 valid trials. The failing record's 1/3 for treatment-stale is therefore not reproduced by the line's wording on this engine. That record was N=3, generated earlier the same day (2026-10-29 10:34 UTC) on the same machine, CLI and model. Variance at N=3 is the explanation the data leaves standing. This is inferred, not isolated.
- **The one valid fail** (trial 9, V2) wrote a handoff ("greeter module created. next: integrate into app or add tests") that did not name the sentinel file. No trial in any variant ended with the agent asking a question or signing off without a handoff.
- **5 INVALID trials, all the same cause: the turn-2 line was not emitted** (trials 1, 2, 3, 6, 7: the engine's raw hook stdout was empty). All five started between 12:00 and 12:03 UTC. During that window I was running two full `npm test` passes on the same machine, which was my mistake. That overlap is a session observation; `observed.json` does not record it. Trials 4 and 5 also started in that window (12:01:48 and 12:02:15), and both emitted the line and passed. So the overlap made silence likely, not certain. Trials 8 to 20 all ran after the test passes finished, and all 13 emitted the line. The engine's UserPromptSubmit handler has a 2 s in-process budget (Q12) and emits nothing once that budget is spent. The likely cause, inferred and not traced, is that heavy local load pushed the handler past it and it failed open to silence, as designed. The probe scored those trials void and re-collected them, as the rule requires. This is recorded as a gotcha. It also means a live L4 must not share the machine with a parallel test run.
- Deterministic predicates: in every valid trial the turn-1 line was absent, Stop ran, and Stop carried no B1/B3 text. The vfkb plugin never loaded, and `modelUsage` was `claude-haiku-4-5` only.

### The gate run that followed (outcome 4)

Per outcome 4, `scenarios/handoff-next-prompt.mjs` ran **once** (record generated 12:20 UTC), on the **final** vendored bundle: plugin #67's head `c975291` (`vfkb.mjs` sha256 `78d04610…`, `vfkb-mcp.mjs` `d4f19d9e…`, engine `e2ac6e9`; the gate record hashes only the CLI bundle, so the MCP hash is the file at that path at `c975291`, not a recorded field). That is not the probe's bundle (`479fad1`, `9d938a39…`). `c975291` re-vendored the same `e2ac6e9` source from a real `node_modules`; its commit message reports bundle-drift CLEAN against a fresh `e2ac6e9` build (not re-checked here). Result: **DEMONSTRATED**. treatment-stale 2/3, treatment-b1 3/3, contrast 0/3, negative 3/3, 0 invalid, 0 deterministic failures. The record overwrote `scenarios/records/handoff-next-prompt.json` in place (D4 `8c1c3a8e7167`), and the 1/3 record stays in git history at `467a4c1`.

On the same `e2ac6e9` text, the treatment-stale gate arm has now scored 1/3 and then 2/3 over two runs, and the probe's V0 scored 5/5. The one failing gate trial (trial 3) is the behaviour under measurement: the agent offered to record a handoff instead of writing one ("If you'd like me to record a handoff … just let me know"). The capability clears the ≥2/3 bar, but not by a wide margin. Delivery is unproven (ADR-0051). The plugin repo's `scenarios/records/install-path.json` is bound to plugin 0.21.0, and no install-path record is bound to v0.22.0.

### What it does not show

- It does not show that wording is irrelevant. It shows only that on this fixture, at N=5, none of the three wordings is distinguishable from the others or from passing.
- It does not settle the 3/3 → 1/3 drop. The probe offers no mechanism for it other than variance.
