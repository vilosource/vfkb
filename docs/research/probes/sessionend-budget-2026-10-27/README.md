# Probe: does vfkb's SessionEnd fit Claude Code's 1.5 s SessionEnd budget?

**Issue:** [vfkb#384](https://github.com/vilosource/vfkb/issues/384) (phase 2 of the handoff-nudge redesign, tracking [#389](https://github.com/vilosource/vfkb/issues/389)).
**Governing text:** ADR-0084 §4, RFC-047 §4.2.
**Kind:** Tier-0 probe of an external contract (ADR-0029 §5). It is not an agent-driven L4, and it is not part of `npm test`.
**Run:** 2026-10-27, Claude Code **2.1.292**, model `claude-haiku-4-5`, macOS arm64, node v22.23.2. Each arm ran 3 trials.
**Decisions this probe follows:** Ruling `54802539cda7` delegates the open questions to a Fable brainstorm, and those decisions are recorded in the brain with role=human. That brainstorm settled three things used here: the `-p` exit path is the evidence (the conditions are below); the shipped v0.21.0 engine and the engine the next release ships are both probed, and the next-release engine decides the guidance; and the hook fix is a deadline on curation only.

## Verdict

| Engine | Brain | SessionEnd under the harness | B2 floor | Verdict |
|---|---|---|---|---|
| plugin **v0.21.0** (engine `6b2d69e`), the version installed on every profile today | vfkb's own, 630 lines / 1.3 MB | committed 3/3, about 0.4 s | **missing** 0/3 | fits the budget, but the floor is broken (ENOBUFS, below) |
| v0.21.0 | synthetic, 3,030 lines / 2.4 MB | committed 3/3 | **missing** 0/3 | fits, floor broken |
| origin/main **`8582ee0`** (adds ADR-0083 curation and #393) | 630 lines | committed 3/3, about 0.87 s | **missing** 0/3; the subject claims "609 new entries" | fits, floor broken, count wrong |
| origin/main `8582ee0` | 3,030 lines | **cut off 3/3** (`Hook cancelled`); the commit was **lost in 1/3** | missing | **truncated** |
| **#384 branch** (`0632f6d`: main plus the ENOBUFS fix and the curation deadline) | 630 lines | committed 3/3; marker `elapsedMs` 798 to 809 | **present** 3/3; "2 new entries" | **fits** |
| #384 branch | 3,030 lines | committed 3/3; `elapsedMs` 1159 to 1172; the deadline cut curation to 35 or 36 archives | present 3/3 | **fits**, with about 330 ms of headroom on this machine |

**Outcome:** the governing engine is what the next plugin release vendors, so it must include the #384 fix. On that engine the RFC-047 §4.2 outcome is **"fits"**: no README guidance is needed. The `vfkb doctor` symptom check ships anyway (ADR-0084 §4). Without the fix, current `main` is the third RFC-047 outcome, "truncated: fix it in the hook", once a brain reaches about 3,000 lines on this machine. The fix is the curation deadline in the code PR.

The B2 floor was **already broken on the version every profile runs**. That is not a budget problem, so ADR-0084 §4's precondition fails twice over: no release note may claim B2 as the floor until a plugin release carries the ENOBUFS fix.

## Observed

The raw records are in `out/results.json` (all arms, 630-line brain), `out/results-brain-3k.json` (the three engines, 3,030-line brain) and `out/timing.json` (arm G). Every predicate is a content assertion over files, `git log`/`git status` and stderr. Exit codes are never used (ADR-0051 clause 3).

| Arm | What ran | Observed (3 trials each) |
|---|---|---|
| **A0, calibration (can-fail)**: settings hook, no `timeout` | A marker hook writes files at 0.25 s through 4.5 s after it starts | last marker **1.4 s**, every trial; stderr `SessionEnd hook [...] failed: Hook cancelled` |
| A0, plugin hook with `"timeout": 10` | The same hook, but provided by a plugin (`--plugin-dir marker-plugin`) | last marker **1.4 s**, cancelled. **A plugin's per-hook timeout does not raise the budget** (matches the docs) |
| A0, settings hook with `"timeout": 10` | The same hook, from settings, with a per-hook timeout | last marker **4.5 s**, not cancelled. **A non-plugin per-hook timeout does raise it** (observed here; the docs do not state this case) |
| C, env in the process | A0 with `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000` exported | last marker 4.5 s, not cancelled |
| C, env in the project `.claude/settings.json` | A0 with the variable in the settings `env` block | last marker 4.5 s, not cancelled. **The per-project layer is honoured** |
| C, project env with a **plugin** hook | The plugin hook plus the project `env` block | last marker 4.5 s, not cancelled. **The override also lifts plugin hooks** |
| A, real hook × 3 engines × 2 brains | The plugin's own command form `VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR:-.}/.vfkb node <bundle> hook session-end` on a topic branch, after one entry was added through the engine | see the verdict table |
| **B, can-fail**: real hook (#384 branch) behind `sleep 2;` | Same as A | cancelled 3/3; **no commit**, brain still dirty, `done` marker absent |
| C, B plus the project env override | Same as B, with `env` 5000 in project settings | committed 3/3, B2 present |
| E, cut while git holds `index.lock` | The sandbox's `pre-commit` hook sleeps 3 s | cancelled 3/3. **No `index.lock` left**, either immediately or 6 s later; `git status` works; no late commit from an orphaned process. The B2 line was written but not committed, and the `sessionEnd` marker stayed open with no `outcome`. The new `vfkb doctor` check is built to detect exactly this state |
| F, `systemMessage` on `main` | Real hook (#384 branch), dirty brain on `main` | The hook emitted the "left uncommitted" `systemMessage` 3/3, and it appeared in neither stdout (stream-json) nor stderr of `claude -p` 3/3 |
| G, standalone timing (N=10, fresh sandbox per run, so curation always does its first backlog run) | `node <bundle> hook session-end`, no Claude Code involved | p50/p95 in ms. v0.21.0: 375/445 (630 lines), 392/441 (3,030 lines). main: 868/918 and **1559/1703**. #384 branch: 789/847 and 1204/1236 |

The `vfkb@vfkb` user-scope plugin did not load in any trial: the probe checks the `init` event's `plugins` list.

## What this means

1. **The budget binds on `claude -p`.** Calibration cut the hook between the 1.4 s and 1.6 s markers in 6 of 6 trials across the two default-budget A0 arms (settings hook and plugin hook). So the `-p` path is admissible evidence, and the L4 records that exercise SessionEnd under `-p` are not quietly exempt from it.
2. **A plugin cannot raise the budget for itself.** Its per-hook `timeout` is ignored for this purpose. A consumer *can* raise it through the `env` block in the project's `.claude/settings.json`, which also applies to plugin hooks and is the per-project layer every wrapper on this machine reads. Recorded here as a fact. The README line is not written, because on the governing engine the outcome is "fits".
3. **The cut is clean, as far as arm E can see.** A cut during `git commit` left neither a stale `index.lock` nor a late commit, so nothing in the hook's process tree outlived the cut and finished the commit. How Claude Code stops the tree was not checked (inferred, not traced). The damage is limited to an uncommitted brain, which is the state the doctor check reports.
4. **Brain size is what drives the time.** v0.21.0's SessionEnd stays near 0.4 s at 3,000 lines. ADR-0083 curation (its first backlog run) and the extra reads of the whole brain push main past 1.5 s at 3,000 lines. The deadline keeps the #384 branch at about 1.2 s, but that headroom is specific to this machine.

## Inferred, not observed

- **The interactive `/exit`, `/clear` and `/resume` paths were not run.** The decision step judged them to share the dispatcher that `-p` exercises; it read that from the binary, not from a run. The docs name them as budgeted paths, so they cannot be looser than `-p`.
- Whether a SessionEnd `systemMessage` shows in the **interactive** TUI was not observed. The docs say it is discarded, and `-p` shows nothing.
- The headroom on slower machines, or under contention for the ADR-0040 lock, is unmeasured. The lock waits up to 5 s before failing open, and the curation deadline is only re-checked once the lock is held.

## ENOBUFS: the floor was already gone (found by the decide step, confirmed here)

`execFileSync` buffers up to 1 MiB by default and throws `ENOBUFS` beyond that. Every `git show HEAD:.vfkb/entries.jsonl` therefore failed once a committed brain passed 1 MiB; this repo's brain crossed 1 MiB at `e7dfc70`. The caller's `catch` read the failure as "nothing at HEAD", so every entry counted as new:

- SessionEnd's commit subject claimed hundreds of new entries. Because old entries included handoffs, **B2 was never written**. Observed: 0 `auto` lines on v0.21.0 and on main; this repo's brain has 0 `auto` entries.
- The Stop hook's decision and B1 counts, and the journal's prune, read the same file. The prune returned `'unknown'` and never pruned.
- Independently of the buffer, the plugin passes an **absolute** `VFKB_DATA_DIR`, and SessionEnd then asked git for `HEAD:/abs/path`, which git rejects. The symptom is the same.

All three are fixed and unit-tested, each with a test that goes red without its fix, in the #384 code PR.

## Follow-ups filed

- [#395](https://github.com/vilosource/vfkb/issues/395): the SessionEnd `systemMessage` is discarded, so ADR-0033's on-main and detached-HEAD warning was not shown on `-p` (the interactive TUI was not observed). It is routed to #385's UserPromptSubmit line (decision step). In the meantime `vfkb doctor` reports it.
- [#396](https://github.com/vilosource/vfkb/issues/396): SessionEnd's cost grows with brain size, and the lock wait inside it is unbounded by the deadline. Make the floor cheaper at scale, and bound the lock acquire on the SessionEnd path.

## Files

- `probe.mjs`: the harness arms (A0, A, B, C, E, F).
- `timing.mjs`: arm G.
- `marker-hook.mjs`, `marker-plugin/`: the calibration hook, and the same hook packaged as a plugin.
- `out/`: the raw records.

To reproduce (one run at a time, about 40 short haiku turns), substituting your own paths:

```sh
PROBE_BUNDLE_V021=<cache>/vfkb/vfkb/0.21.0/dist/bundles/vfkb.mjs \
PROBE_BUNDLE_MAIN=<origin/main checkout>/dist/bundles/vfkb.mjs \
PROBE_BUNDLE_FIX=<#384 branch checkout>/dist/bundles/vfkb.mjs \
PROBE_BRAIN=<origin/main>/.vfkb/entries.jsonl node probe.mjs
```

Build each bundle with `npm run build:bundles`. The bundle SHA-256 prefixes are recorded in each result file's `meta`. The `fix` bundle was built from the working tree that was then committed as `0632f6d`, so it embeds the parent's commit stamp; a rebuild at `0632f6d` hashes differently for that reason alone.
