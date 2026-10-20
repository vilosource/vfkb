# RFC-043 adversarial review record (rounds 1–3)

The three review reports for [RFC-043](../../../../rfc/RFC-043-stop-nudge-observer.md) (PR #357),
kept so the review state survives the session that ran them.

| File | Reviewed | Verdict |
|---|---|---|
| `rfc043-review-r1.md` | a399dd8/e66da5a | FIX-FIRST (squash self-staleness, topical-tag pin hijack found) |
| `rfc043-review-r2.md` | 81733cb | FIX-FIRST, escalated (ADR-0070 §4: blockers came from round-1 fixes) |
| `rfc043-review-r3.md` | 5d4c2e5 | FIX-FIRST at the 3-round ceiling, escalated to the operator |

**Open at pause (2026-10-20):** round 3's R3-B1. Part 0's "later of carrier and timestamp
anchor" misses a handoff written mid-session, followed by code commits, with the brain
committed at the end. The carrier is then the final brain commit, which comes after the code.
Re-run by the coordinator: `cd sandbox && mkdir v && cd v && bash ../case3.sh` gives "today
exit 1 (stale)", "Part 0 exit 0 (not stale)", and an empty Part A list. The proposed fix
(first-parent timestamp anchor, stale if any later first-parent commit touches non-brain paths,
excluding the carrier) also resolves R3-M1 and R3-M2.

**Operator's choice:** prototype Part 0 as a small script against the sandbox cases before
rewriting the RFC prose.

## Sandbox

`sandbox/lib.sh` holds helpers (`c` commits with a fixed date; `entry` appends a brain line;
`carrier`, `ts`, `name`). Each `caseN.sh` sources `../lib.sh`, so run it from a fresh empty
subdirectory of `sandbox/`:
- case1: squash merge and a retagged old entry;
- case2: a `--no-ff` true merge, where the timestamp anchor is off the first-parent chain;
- case3: a handoff, then code, then a brain-only commit (R3-B1).

`cmp.mjs` is the reviewer's field-order check over `entries.jsonl`.
