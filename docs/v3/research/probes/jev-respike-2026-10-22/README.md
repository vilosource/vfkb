# Jev re-spike (2026-10-22): RFC-043 Part B, gate 2, second attempt

The [first spike](../jev-spike-2026-10-22/README.md) failed gate 2 on its pre-registered bar,
and could not decide it: 19 sessions, of which 11 were scripted or smoke runs, 5 hard
negatives, and a hard-case interval of 0.14–0.78. This re-spike is built to decide it.

The operator ruled (brain `00cff7e60454`):
- cost is no constraint;
- transcripts from any project on this machine may be sent to Jev;
- no hand labelling, so labels come from AI labellers;
- it runs alongside the R7 build, in its own worktree.

This is not production code, and nothing in vfkb calls Jev.

## Pre-registration, part A (committed before any labeller, Jev or comparator call)

Everything in this part was fixed before any model saw any window. Changing it after would
be tuning.

### Corpus (`build-corpus.mjs`)

- **Sources.** Every Claude Code transcript on this machine:
  - profiles: `~/.claude*/projects/*/*.jsonl`, across all projects;
  - excluded: the session running the spike (`61f0e751`), and any transcript modified in
    the last 2 hours, because it may still be running.
- **Excluded sessions:**
  - any session with a `promptSource: "sdk"` turn (scripted `claude -p` runs: review gates,
    L4 trials, smoke tests);
  - any session with fewer than 2 scored turns.
- **Scored turns** are those typed by a person (`promptSource` `typed` or `queued`).
  - Slash commands and `!` shell inputs (no `promptSource`) are not scored and not put in
    windows.
  - Their tool use still counts for labels.
- **Dry counts, from the builder alone, with no model call:**
  - 470 transcripts, 32 projects, 130 sessions kept, 4,115 scored turns;
  - dev: 1,332 turns, 56 positive;
  - test: 2,783 turns, 93 positive.
- **Split by session,** not by turn. A session is dev if the first byte of
  `sha256("jev-respike-2026-10-22:" + sessionId)` is below 102 (about 40%), else test.
- **Structural label (unchanged from spike 1).** A turn is 1 if no later turn in the
  session used a tool, else 0. This is RFC-043 Part B's own question: "is it likely that no
  more substantive work happens in this session after this turn?"
- **Window.** The same as spike 1 and RFC-043:
  - the last 3 scored prompts, newest last, 600 characters each;
  - the final assistant message's last 1,000 characters.

  The long variant (V4 below) uses the last 5 prompts at 1,000 characters each, and the last
  2,000 characters of the final message.
- **Secrets:** any turn whose long window trips `detectSecrets` is dropped from every arm.
  The dry run dropped 12.

### Labels for how each session ended (`label.mjs`)

Spike 1's positives mixed real wrap-ups with sessions cut off by a restart or a context
limit. Those endings cannot be predicted from the window, so they were noise.

- **Two independent AI labellers,** `claude-opus-5-5` and `claude-sonnet-5-5`, each called
  once per session with the same fixed instructions (in `label.mjs`).
- **What they see:**
  - the session's last 6 scored turns (prompt, final-message tail, tool count);
  - the opening prompt of the next session in the same project that started within 2 hours,
    if any.
- **The classes:** `natural_close`, `restart`, `context_limit`, `abandoned`, `unclear`.
- **Every call is checked:** each result must name its pinned model in `modelUsage`.
- **Primary positives:** structural-1 turns in sessions that **both** labellers call
  `natural_close`.
  - Structural-1 turns in any other session are dropped from the primary analysis.
  - Every structural-0 turn stays a negative, because more work did happen after it.
- **Secondary analysis:** every structural positive, as in spike 1. It is reported, and it
  is not part of the gate.
- **Label validity:** Cohen's κ between the two labellers, on natural-close against the
  rest.
  - **κ < 0.6 makes the result NOT DECIDED.**
  - No human checks the labels (operator ruling). The κ is the only validity check, and two
    Claude models can share a bias, so it is a weak check. That is stated as a limit, not
    hidden.

### Hard cases

Spike 1 defined hard cases as the turns the keyword rule got wrong. That left 5 negatives.
This time two rules are used, and **a turn is hard if either rule gets it wrong:**
- **`b1`, the RFC-043 keyword rule:** fires when the newest prompt matches
  `/wrap(\s|-)?up|that'?s all|hand\s?off|commit and push|i will exit|new session|we('| a)re done/i`
  and the final text does not end in `?`.
- **`b2`, a completion-word rule:** fires when the final-message tail matches
  `/\b(done|complete[d]?|merged|pushed|all set|finished|landed|shipped)\b/i` and does not
  end in `?`.

With both rules, the dry corpus had about 150 hard positives and about 820 hard negatives,
before the labeller filter.

### Jev variants, chosen on dev only

| Id | Questions | Window | Score |
|---|---|---|---|
| V0 | RFC-043's `close`, `more`, `ask`, `done` | short | `max(close, done·(1−ask)·(1−more))` (spike 1's score) |
| V1 | the same call | short | `done` |
| V2 | the same questions, 3 calls | short | mean of V0 over the 3 calls |
| V3 | one question: "No more substantive work happens in this session after this turn." | short | its `noul` |
| V4 | the 4 questions | long | V0's formula |

- **The dev phase** (`respike.mjs dev`) scores every variant on the dev split, which is all
  it can see.
- **The chosen variant** is the one with the highest **hard-case AUROC on dev.** A tie goes
  to the lower id.
- **The lock.** The choice is written to `locked.json` and committed as pre-registration
  part B before the test phase.
- **`respike.mjs test` enforces the lock:** it refuses to run unless `locked.json` is
  committed and unmodified.

### The comparator arm

- **The model:** `claude-haiku-4-5`, through `claude -p`.
- **The prompt:** fixed (in `respike.mjs`), with no tools, MCP or settings, and the same
  short window. It is asked for the probability that no more substantive work happens in
  this session after this turn.
- **Run once, on test only,** and never tuned.
- **Not part of the gate.** If it matches or beats Jev on hard cases, the recommendation is
  that "a decision model may be warranted, but Jev is not shown to be the one", and Jev's
  latency becomes the remaining argument.
- **A caveat to state with it:** the labellers are Claude models too. They only decide
  which positives count, never the class of a turn, but a shared bias could still favour
  this arm.

### Metrics on test

- **AUROC** (rank-based Mann–Whitney, ties averaged) on all primary turns and on the hard
  cases, for:
  - the locked Jev variant;
  - `b1` and `b2`;
  - the Claude arm.
- **95% intervals:** a session-cluster bootstrap. Whole sessions are resampled, 5,000
  times, with a fixed seed. Turns within a session are not independent, so they are not
  resampled one by one.
- **Also reported:**
  - ECE of the locked score;
  - Jev latency, p50 and p95;
  - the Claude arm's latency;
  - the secondary analysis.

### The gate

| Outcome | Condition |
|---|---|
| **PASS** | AUROC(Jev, all) ≥ AUROC(`b1`, all) + 0.05, **and** the hard-case 95% interval's lower end is ≥ 0.70 |
| **FAIL** | AUROC(Jev, all) < AUROC(`b1`) + 0.05, **or** the hard-case interval's upper end is < 0.70 |
| **NOT DECIDED** | anything else (the interval straddles 0.70), or labeller κ < 0.6, or a class is missing |

- **FAIL:** RFC-043's accepting ADR records Part B as not built, with this evidence.
- **PASS:** this is necessary, not sufficient. Part B's gate 1 (the B3 re-measurement) and
  its shadow-to-act gate still apply.

### Known limits, stated now

- **Different users and tasks.** Every session comes from one operator's machine, across 32
  projects.
- **Pasted blocks.** RFC-043 excludes them from the window, but this corpus cannot detect
  them; the 600-character cut limits their weight.
- **The labeller filter.** It removes the positives a window cannot predict, so the primary
  result describes natural closes, not every session end.

### Data handling

- **What leaves the machine.** Windows go to Jev (`api.typesafe.ai`) and, through `claude
  -p`, to Anthropic.
- **What is never committed:**
  - corpus files, labeller outputs and raw responses, which live in a scratch directory;
  - the key, read with `op read "op://Private/JEV_VFKB/credential"`.
- **What is committed:** the scripts, this README, `locked.json`, and `results-dev.json` and
  `results.json`, which hold aggregates only.

## Running it

```
npm run build
node docs/v3/research/probes/jev-respike-2026-10-22/build-corpus.mjs "$CORPUS" ~/.claude*/projects --exclude 61f0e751
node docs/v3/research/probes/jev-respike-2026-10-22/label.mjs "$CORPUS"
node docs/v3/research/probes/jev-respike-2026-10-22/respike.mjs dev "$CORPUS"
# commit locked.json (pre-registration part B), then:
node docs/v3/research/probes/jev-respike-2026-10-22/respike.mjs test "$CORPUS"
```

Rebuilding the corpus later gives different counts, because transcripts keep accumulating,
and the 2-hour live cut-off moves. **The corpus is frozen:** `corpus-manifest.json` records
the sha256 of the `rows.jsonl` every phase ran on, and each kept session's id and split
(ids only, no text). Every phase runs on that one build.

## Pre-registration, part B: the lock (committed before any test-split call)

- **The dev phase** (`results-dev.json`): 51 sessions, 1,316 turns, 40 positives; 34 hard
  positives and 288 hard negatives. Labeller κ was 0.672 over 130 sessions, with 73 both
  `natural_close`.

  | Variant | Dev AUROC, all | Dev AUROC, hard |
  |---|---|---|
  | V0 (spike 1's score) | 0.717 | 0.619 |
  | V1 (`done`) | 0.780 | 0.759 |
  | V2 (V0, 3-call mean) | 0.716 | 0.617 |
  | V3 (one question) | **0.893** | **0.844** |
  | V4 (long window) | 0.724 | 0.615 |
  | `b1` / `b2` | 0.575 / 0.631 | — |

- **Locked: V3**, by the part A rule. These dev numbers are not the result. The test split
  is scored once, with V3, under part A's gate.

## Result (test split, scored once with the locked V3)

**Gate 2: PASS on the pre-registered bar, and fragile.** The PASS depends on the strict
labeller filter, and on the test split the labellers agree less than the validity floor
(see "Review findings" below). Aggregates are in [`results.json`](results.json).
The Jev model was `jev-1.14.0`, and 6.1M input tokens were used across the dev and test
phases.

| Clause | Measured | Bar | Met |
|---|---|---|---|
| AUROC(V3), all 2,728 primary turns | **0.878** | ≥ 0.663 (`b1` 0.613 + 0.05) | yes |
| AUROC(V3), the 538 hard cases (34 positive, 504 negative) | **0.812**, 95% interval **0.742–0.873** | lower end ≥ 0.70 | yes |
| Labeller κ, pooled over both splits as part A specifies | 0.672 | ≥ 0.6 | yes (test split alone: 0.571, below the floor) |

- **Corpus:** 79 test sessions from the frozen build.
- **Gain over `b1`:** the cluster-bootstrap interval for V3 minus `b1` on all turns is
  0.199–0.330, so the margin does not rest on the point estimate.
- **The Claude arm** (`claude-haiku-4-5`, run once, never tuned):
  - AUROC 0.835 on all turns, and 0.730 on hard cases (interval 0.635–0.813);
  - Jev is ahead on both point estimates, but the hard-case intervals overlap, so this does
    not show Jev beats a Claude model;
  - median latency 12.6 s per call against Jev's 0.20 s (p95 18.6 s against 0.26 s).
    The Haiku figure is `claude -p` from end to end, CLI start-up included. **Haiku's model
    latency was not measured**, so this does not decide whether Haiku fits RFC-043's 1.5 s
    Stop timeout.
- **Calibration is poor:** ECE is 0.522. V3's scores are compressed:
  - positives average 0.71 (p10–p90: 0.56–0.86);
  - negatives average 0.53 (0.40–0.68), against a base rate of 1.4%.

  The ranking separates the classes, but the raw number is not a probability. Any policy
  needs a threshold calibrated on data, as RFC-043 already says ("the thresholds come from
  calibration, not from guesses").
- **Secondary analysis,** with every structural positive including restarts and abandoned
  sessions: AUROC 0.748 on all turns and 0.675 on hard cases. As expected, endings the
  labellers called restart or abandoned cannot be predicted from the window. The PASS covers
  natural closes only.

### What this licenses and what it does not

- **Gate 2 of RFC-043 Part B is met.** Part B can now be built only if gate 1 also passes:
  the B3 re-measurement after Parts 0, 1 and A must still show mid-session fires in at least
  one interactive session in 3, over at least 10. That has not been measured.
- **The question changed from the RFC's design.** The winning score is the RFC's own
  question asked directly. It was the V3 variant fixed in part A, not the four-question
  policy. Part B's design should ask that one question, or its accepting ADR should say why
  not.
- **Not licensed:**
  - **Acting on the score.** Shadow mode comes first, then the shadow-to-act gate.
  - **Fixed thresholds.** With ECE 0.52, no threshold such as 0.5 can be read off the raw
    score.
  - **Generalising.** Everything here comes from one operator's sessions.
- **Spike 1 is not overturned,** and this is not a re-run of it. Spike 1 asked a different
  question, its four-question score, on a corpus that could not decide. Here that score (V0)
  had a dev hard-case AUROC of 0.619. It was never scored on test, so it would not have
  passed, but whether it would have been FAIL or NOT DECIDED is unknown.

## Review findings (post-hoc; they do not change the gate)

Found by the adversarial review of PR #372, and recomputed from the local cache with no new
calls.

1. **The test split's labels fall below the validity floor.**
   - Part A pooled κ over all 130 sessions (0.672), and `label.mjs` pools the same way.
   - By split: dev 0.850 (51 sessions), **test 0.571** (79 sessions).
   - The gate was applied as written, but the labels that define the test positives are below
     the 0.6 floor that part A set.
2. **The PASS depends on the strictest labeller rule.** Test, V3:

   | Positives kept when | Positives | Hard-case AUROC | 95% interval |
   |---|---|---|---|
   | both labellers say `natural_close` (pre-registered) | 38 | 0.812 | 0.742–0.873 |
   | Opus alone says so | 56 | 0.754 | 0.694–0.812 |
   | Sonnet alone says so | 41 | 0.773 | 0.675–0.859 |
   | either says so | 59 | 0.731 | 0.656–0.800 |
   | no filter (the secondary analysis) | 93 | 0.675 | 0.612–0.739 |

   - Every looser rule, including no filter, gives **NOT DECIDED**, not FAIL. The all-turns
     clause still holds under each (with no filter: 0.748 against a bar of 0.592), but the
     hard-case interval straddles 0.70.
   - **Part of the filter overlaps with the task.** Over the 78 test sessions' final turns,
     V3's score predicts the labellers' verdict with AUROC 0.762. So the filter tends to keep
     endings that already look closed in the window.
   - **The filter is not all of it.** Within natural-close sessions alone, V3 separates the
     wrap-up turn from the session's earlier turns with AUROC 0.874 (1,503 turns, 38
     positives).
   - A deployed Stop hook cannot apply this filter. Comparing like with like on all turns, the
     figure in use is nearer 0.748 when every session ending is counted (hard cases: 0.675),
     and 0.874 within sessions that do end naturally.
3. **Dev and test share windows.**
   - One dev session and one test session in the same project share 46 identical windows,
     which looks like a resumed or forked transcript. Splitting by session id does not catch
     that.
   - Those 46 test rows (all negative, 10 of them hard) were sent to Jev in the dev phase,
     before the lock, and were part of the dev data that chose V3.
   - Without them: all turns 0.877, hard cases 0.811 (interval 0.740–0.872).
   - Two test sessions also share windows. Treating them as one cluster gives 0.742–0.873.
4. **The lock guard is weaker than part A says.** It checks only that `locked.json` is tracked
   and unmodified. It does not check:
   - that the lock commit came before the test calls;
   - that the lock matches `results-dev.json`;
   - that the scripts are unchanged.

   The order was right in practice. The lock was committed at 13:59:35, and the first
   test-only Jev call was at 13:59:48. Part A's scripts are unchanged at the result commit.
5. **What the hard set measures.**
   - 490 of the 504 hard negatives are turns where `b2` fired: the assistant said done or
     complete, and work continued.
   - Of the 38 positives, `b1` misses 29 and `b2` misses 21. The 34 hard positives are those
     that either rule misses.
   - So 0.812 mostly measures telling "reported done, more work followed" apart from a real
     close.
6. **Robustness that does hold:**
   - Clustering by project instead of by session gives a hard-case interval of 0.733–0.869.
   - No project dominates: the 38 test positives come from 37 sessions in 17 projects, at
     most 5 per project.
   - The V3 question had not been tried before part A. Spike 1's cache holds only the
     four-question set.

**Reading for RFC-043.** Gate 2 is met on its pre-registered terms, but by a narrow and
labeller-dependent margin. Any build would still have to show, in shadow mode and on fresh
sessions, that the score separates real closes. The shadow-to-act gate exists for that. This
spike does not show it.
