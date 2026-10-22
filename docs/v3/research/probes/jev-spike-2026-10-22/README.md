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

*(Filled in after the run. The pre-registration above is not edited.)*
