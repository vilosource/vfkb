# RFC-043 adversarial review record (rounds 1–3)

The three review reports for [RFC-043](../../../../rfc/RFC-043-stop-nudge-observer.md) (PR #357),
kept so the review state survives the session that ran them.

| File | Reviewed | Verdict |
|---|---|---|
| `rfc043-review-r1.md` | a399dd8/e66da5a | FIX-FIRST (squash self-staleness, topical-tag pin hijack found) |
| `rfc043-review-r2.md` | 81733cb | FIX-FIRST, escalated (ADR-0070 §4: blockers came from round-1 fixes) |
| `rfc043-review-r3.md` | 5d4c2e5 | FIX-FIRST at the 3-round ceiling, escalated to the operator |
| `rfc043-review-r4.md` | ba8e430 (RFC change 6776dfc) | **MERGE**. No blockers; none introduced by this round (ADR-0070 §4). Three MAJOR and six MINOR findings, all disclosure-level, folded into the RFC; B′ became Q5. Cases are in `sandbox/r4/`. |

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

## Part 0 prototype (2026-10-20)

`sandbox/anchor-proto.sh` is a **throwaway** prototype (shell, not production code). It runs
four candidate anchor rules over 18 sandbox repos and saves its output to
`sandbox/anchor-proto.out`. Run it with `cd sandbox && mkdir p && cd p && bash ../anchor-proto.sh`
(git 2.50.1). The rules:
- **today**: the shipped `handoffIsStale`, a tree diff from `rev-list --before`;
- **r2**: RFC-043 @ 5d4c2e5, the later of the carrier and the timestamp anchor;
- **A**: round 3's proposed fix, a first-parent timestamp anchor with the carrier excluded;
- **B**: A, also dropping ancestors of the carrier whose author date is at or before the pin.

Today's rule produces no list, so a STALE answer from it counts as a match whenever STALE is
expected.

| # | Case | Expected | today | r2 | A | **B = Part 0** |
|---|---|---|---|---|---|---|
| 1 | squash carries pin | quiet (code inside the carrier is the disclosed loss) | ✗ STALE (tree diff) | ✓ quiet | ✓ quiet | ✓ quiet |
| 1b | squash, then another PR | STALE {squash other (#2)} | ✓ STALE (tree diff) | ✓ STALE {squash other (#2)} | ✓ STALE {squash other (#2)} | ✓ STALE {squash other (#2)} |
| 2 | no-ff merge carries pin | quiet | ✓ quiet | ✓ quiet | ✓ quiet | ✓ quiet |
| 3 | retagged old entry | quiet | ✓ quiet | ✓ quiet | ✓ quiet | ✓ quiet |
| 3b | retagged, then code | STALE {code3} | ✓ STALE (tree diff) | ✓ STALE {code3} | ✓ STALE {code3} | ✓ STALE {code3} |
| 4 | uncommitted pin, nothing after | quiet | ✓ quiet | ✓ quiet | ✓ quiet | ✓ quiet |
| 4b | uncommitted pin, code committed after | STALE {code after pin} | ✓ STALE (tree diff) | ✓ STALE {code after pin} | ✓ STALE {code after pin} | ✓ STALE {code after pin} |
| 5 | committed pin, then true merge (R3-M1) | STALE {M merge feat (post-pin)} | ✓ STALE (tree diff) | ✗ UNDEFINED (anchors incomparable) | ✓ STALE {M merge feat (post-pin)} | ✓ STALE {M merge feat (post-pin)} |
| 6 | uncommitted pin, true merge after (R3-M2) | STALE {M merge feat (post-pin)} | ✓ STALE (tree diff) | ✗ STALE {M merge feat (post-pin), P main (pre-pin)} | ✓ STALE {M merge feat (post-pin)} | ✓ STALE {M merge feat (post-pin)} |
| 7 | handoff -> code -> brain commit (R3-B1) | STALE {K code after the handoff} | ✓ STALE (tree diff) | ✗ quiet | ✓ STALE {K code after the handoff} | ✓ STALE {K code after the handoff} |
| 7b | ...then squash-merged to main | quiet (K is inside the carrier: the disclosed loss) | ✗ STALE (tree diff) | ✓ quiet | ✓ quiet | ✓ quiet |
| 8 | outside-tree brain, nothing after | quiet | ✓ quiet | ✓ quiet | ✓ quiet | ✓ quiet |
| 8b | outside-tree brain, code after | STALE {code after pin} | ✓ STALE (tree diff) | ✓ STALE {code after pin} | ✓ STALE {code after pin} | ✓ STALE {code after pin} |
| 9 | rebase onto main that moved after the pin | STALE {M1 main (post-pin)} only | ✓ STALE (tree diff) | ✗ quiet | ✗ STALE {A1 topic code (pre-pin), M1 main (post-pin)} | ✓ STALE {M1 main (post-pin)} |
| 9b | force-rebase, no upstream change | quiet | ✗ STALE (tree diff) | ✓ quiet | ✗ STALE {A1 topic code (pre-pin)} | ✓ quiet |
| 10 | root brain, committed pin | quiet | ✓ quiet | ✓ quiet | ✓ quiet | ✓ quiet |
| 10b | root brain, code after | STALE {code after pin} | ✓ STALE (tree diff) | ✓ STALE {code after pin} | ✓ STALE {code after pin} | ✓ STALE {code after pin} |
| 11 | pre-pin-authored PR rebase-merged after the pin, below carrier | STALE {O other PR} (it landed after the handoff) | ✓ STALE (tree diff) | ✗ quiet | ✓ STALE {O other PR (authored pre-pin)} | ✗ quiet |
| | **matches** | | 15/18 | 13/18 | 16/18 | **17/18** |

Observations:
- **r2 fails R3-B1 (row 7), rebases (row 9), and is undefined for R3-M1 (row 5).** Its R3-M2
  listing (row 6) includes a pre-pin main commit. All four reproduce round 3's findings.
- **A, the round-3 fix, fixes those rows but breaks both rebase rows (9, 9b).** A rebase
  re-dates pre-pin work, so A fires on every rebase of a pinned branch. Had it gone into the
  RFC unprototyped, it would have been the fourth rule in a row to break a case.
- **B matches 17/18.** Its one miss (row 11) is inherent. After a rebase, git cannot
  distinguish your own rebased pre-pin work from another PR's pre-pin-authored commits
  rebase-merged after the pin. B fails toward silence there, which is B3's existing posture.
  The RFC discloses this, and the DoD pins it as a unit test.
- **R3-M3 reproduced** with `cmp.mjs` on a three-line synthetic brain (`REALPIN@09:00`
  handoff, `HIJACK@10:00` handoff, `HIJACK@11:00` retagged `handoff-topic`). B3's raw scan
  gives `HIJACK 10:00` and the engine gives `REALPIN 09:00`. On both real brains today the two
  agree (`0836d40055dd`, `1b026624f5a7`), but only because newer handoffs exist.
