# Jev calibration spike (2026-10-22): RFC-043 Part B, gate 2

The throwaway spike that [RFC-043](../../../../rfc/RFC-043-stop-nudge-observer.md) Part B and
Ruling 5 (brain `8b2aefd11171`) require before any decision-model code is written. The
operator supplied the key (1Password `JEV_VFKB`) and asked for it to run now (2026-10-22).
This is not production code, and nothing in vfkb calls Jev.

## Pre-registration (committed before any API call)

Everything in this section was fixed before a single Jev result was seen. Changing any of it
after the run would be tuning.

- **Corpus.** `turn-corpus.py` (the stop-nudge probe kit) over this repo's own session
  transcripts on this machine: profiles `~/.claude-cldp`, `~/.claude` and `~/.claude-cldw`,
  project `-Users-jasonviloria-GitHub-vfkb`. The session that runs the spike (`61f0e751`) is
  excluded, because it is still running and its labels would be wrong. **No other project's
  transcripts are sent.**
- **Label, structural, no labeller.** A turn is **wrap-up = 1** if no later turn in the same
  session used any tool. Otherwise it is 0. The session's last turn is always 1.
- **Window, as RFC-043 Part B specifies.**
  - The last 3 user prompts up to and including this turn, newest last, each truncated to
    600 characters.
  - The last 1,000 characters of the turn's final assistant text.
  - A window in which `detectSecrets` (`src/secrets.ts`) finds anything is **not sent**. It
    is counted and excluded.
- **Questions:** RFC-043's four `noul` questions, `close`, `more`, `ask` and `done`, worded
  exactly as in its table.
- **Model score:** `s = max(close, done × (1 − ask) × (1 − more))`. This is the policy's
  shape with no thresholds. Each question's AUROC is reported as well.
- **Rule-only baseline**, from RFC-043's keyword list.
  - It scores 1 when the newest user prompt matches
    `/wrap(\s|-)?up|that'?s all|hand\s?off|commit and push|i will exit|new session|we('| a)re done/i`
    and the final assistant text does not end in `?`.
  - Otherwise it scores 0.
- **Hard cases:** the turns the baseline gets wrong (baseline ≠ label).
- **Metrics:**
  - AUROC (Mann–Whitney, ties count half), on all turns and on the hard cases;
  - ECE of `s` (10 equal-width bins);
  - repeat variance: the first 10 sent windows, called 5 times each, reporting the largest
    change in `s`.
- **PASS (gate 2 met)** needs both:
  - AUROC(`s`) ≥ AUROC(baseline) + 0.05 on all turns;
  - AUROC(`s`) ≥ 0.70 on the hard cases.

  Otherwise **FAIL**, and RFC-043's accepting ADR records Part B as not built, with this
  evidence. If the hard set lacks one of the classes, the hard-case clause is reported as
  **not evaluable**, and the gate is **not met**.
- **Cost cap:** the run aborts if cumulative input tokens exceed 20M (about $0.84).
- **Known limit, stated now:** the corpus is about 110 turns from about 19 sessions, below
  the survey's 100–200 labelled pairs for the positive class. A PASS here is necessary, not
  sufficient: Part B's own gate 1 and the shadow-to-act gate still apply.

## Running it

```
python3 docs/research/probes/stop-nudge-2026-10-19/turn-corpus.py /tmp/turns.jsonl \
  "$HOME/.claude-cldp/projects/-Users-jasonviloria-GitHub-vfkb" \
  "$HOME/.claude/projects/-Users-jasonviloria-GitHub-vfkb" \
  "$HOME/.claude-cldw/projects/-Users-jasonviloria-GitHub-vfkb"
npm run build
node docs/v3/research/probes/jev-spike-2026-10-22/spike.mjs /tmp/turns.jsonl /tmp/jev-cache --exclude 61f0e751
```

- **The key** is read with `op read "op://Private/JEV_VFKB/credential"` (on Linux, from
  Bitwarden) straight into the request header, and never printed.
- **The cache directory** holds raw responses keyed by a window hash. It is never committed,
  because the windows are transcript text.
- **Committed:** this README, the script, and `results.json`, which is aggregate numbers only,
  with no prompt text.

## Result

Run 2026-10-22 against `jev-1.14.0` (the API reported that model; the survey described
1.13.0). 111 calls plus 40 repeats, 103,184 input tokens, **$0.0043**. Aggregates are in
[`results.json`](results.json).

**Gate 2: FAIL on the pre-registered bar, and underpowered** (see "Post-hoc analysis" below).

| Clause | Measured | Bar | Met |
|---|---|---|---|
| AUROC(`s`), all 111 turns | **0.610** | ≥ 0.549 (baseline 0.499 + 0.05) | yes |
| AUROC(`s`), the 23 hard cases | **0.450** | ≥ 0.70 | **no** |

- **Corpus:** 19 sessions, 111 turns, 19 of them wrap-up. Exactly one per session: every
  session's last turn was its only turn with no later tool use. No window was skipped for
  secrets.
- **The keyword baseline is no better than chance** (AUROC 0.499). It caught 1 of the 19
  wrap-ups and fired on 5 turns that were not wrap-ups. So the hard set is 18 wrap-ups the
  rules missed plus 5 false fires.
- **On the hard cases Jev is not distinguishable from chance** (0.450). Where the rules
  fail, the model's score does not separate the classes either. This is the failure the
  survey's §10 bolded: the easy cases carry the overall number.
- **Per question** (AUROC against wrap-up; below 0.5 means the question points the other
  way, as `more` and `ask` should):

  | Question | AUROC | Reading |
  |---|---|---|
  | `close` | 0.477 | No signal on this corpus. The post-hoc analysis shows this is a corpus artifact. |
  | `more` | 0.350 | Inverse signal, as intended; 0.650 inverted. |
  | `ask` | 0.319 | Inverse signal; 0.681 inverted. |
  | `done` | 0.740 | The strongest single signal, but partly a corpus artifact (see post-hoc). |

- **Calibration and stability:** ECE of `s` is 0.115. Across 10 windows called 5 times
  each, the largest change in `s` was 0.08.

**What this does not license.** `done` alone (0.740) beats the pre-registered score, and
it is partly confounded (see post-hoc). Picking
it now, after seeing the results, would be tuning on the same 111 turns. It is a hypothesis
for a new, separately pre-registered run on fresh turns, not a result.

**Limits.**
- The label is structural. "No later tool use" also marks sessions that ended
  for reasons other than finishing (a restart, a context limit, the operator walking away).
  That probably explains `close`'s lack of signal, and it makes "wrap-up" noisier than the
  question asked.
- 19 positives is small, as the pre-registration stated.
- The pre-registration did not apply two exclusions that RFC-043's window section names:
  turns Claude Code starts on its own (`promptSource`) and pasted blocks.

### Post-hoc analysis (does not change the gate; found in review)

These numbers were computed after the result, from the cached responses, with no new API
call. They describe how far the verdict can be trusted. They are not a re-run of the gate.

1. **Most positives are not interactive sessions.** 11 of the 19 sessions are single-turn:
   - 7 are scripted one-shot agent runs (ADR-0052 review gates and a process analyst);
   - 4 are smoke tests ("hello", a weather question, "Reply with exactly: …").

   Their only turn counts as wrap-up because it is their only turn. That gives 11 of the 19
   positives, and 11 of the 18 hard positives. Some multi-turn positives are restarts, not
   wrap-ups. For example, one session ends and another begins 11 minutes later with
   `/vfkb:brief`, and another opens with "I had to restart…".
2. **Restricted to the 8 multi-turn sessions** (100 turns, 8 positives):

   | Measure | AUROC |
   |---|---|
   | `s`, all turns | 0.639 |
   | `s`, hard cases (7 positives, 5 negatives) | **0.457**, still below 0.70 |
   | `close` | 0.639 |
   | `done` | 0.672 |

   So `close`'s "no signal" was an artifact of the scripted sessions. `done`'s 0.740 was
   inflated by scripted runs, which end with a "work complete" report.
3. **Bootstrap 95% intervals** (5,000 resamples, stratified by class):

   | Measure | Point | 95% interval |
   |---|---|---|
   | Hard cases | 0.450 | 0.14–0.78; P(AUROC ≥ 0.70) ≈ 0.08 |
   | All turns | 0.610 | 0.46–0.76 |

   The adversarial reviewer reported `s` minus the baseline at −0.03 to 0.26. So the
   all-turns clause is met on the point estimate only, and the hard-case FAIL cannot exclude
   0.70.
4. **The repeat-variance sample** (the first 10 rows) is 5 scripted or smoke turns plus 5
   turns from a single session, so it is not representative.

**For any next pre-registered spike:**
- restrict the corpus to interactive multi-turn sessions (`n_turns > 1`, typed
  `promptSource`);
- treat restart-terminated sessions as their own class;
- apply RFC-043's exclusions;
- size the hard set so that its interval can actually rule 0.70 in or out.

**Consequence (RFC-043, Proposed and owned by another session):** gate 2 is not met. RFC-043
Part B says that if either gate fails, its accepting ADR records Part B as **not built**, with
the evidence. So that is what its ADR would record on this evidence, unless a new,
better-powered pre-registered spike passes. Ruling 5's optional seam stays unbuilt.
