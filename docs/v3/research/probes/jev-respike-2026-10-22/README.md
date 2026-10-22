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
