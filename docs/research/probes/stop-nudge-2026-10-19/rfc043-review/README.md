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

## Rules recreated and the 33 cases re-run under `created` keys (2026-10-28, vfkb#386)

ADR-0084 §5.3 found the 33-case table unreproducible: round 4's scripts source two files that
were never committed. #386 recreates them and re-runs every case under ADR-0082 §2's
`created` key before the rows become unit fixtures.

- **`sandbox/r4/rules.sh`** (sourced by `r4-cases.sh` and `r4-shallow.sh`): the plumbing of
  `anchor-proto.sh` (rules today, r2, A, B), unchanged except that `KEY` picks the pin key the
  carrier lookup matches and `entry` takes an optional `created`.
- **`sandbox/r4/rules-bp.sh`** (sourced by `bp-all.sh`): rules B and B′ (RFC-043 Q5, adopted by
  ADR-0084 §5.2: with no carrier, drop every commit authored at or before `u`).
- **Reconstruction check.** With the default `KEY=updated`, both reproduce the committed
  outputs: `r4-cases.out` and `r4-shallow.out` byte-for-byte, and `bp-all.out` byte-for-byte
  once git's own merge chatter ("Squash commit -- not updating HEAD", the octopus lines) is
  filtered, which is how `bp-all.out` was saved. `rerun-created-keys.sh` (ADR-0082's evidence)
  still reproduces `rerun-created-keys.txt` unchanged; `lib.sh` is not edited.
- **`sandbox/r4/rerun-created.sh`** re-runs `bp-all.sh` (33 rows), `r4-cases.sh` (15) and
  `r4-shallow.sh` (1) with `KEY=created` and writes `*.created.out` beside the originals, which
  stay as evidence. Its full output, with the script edits and diffs, is
  `sandbox/r4/rerun-created.txt` (git 2.50.1, macOS).

**Fixture faithfulness (decide step D2).** A same-id re-version keeps the entry's original
`created` and bumps only `updated`; that is the only shape vfkb writes (`updateEntry` callers
patch zone and tags, never text). The re-run therefore passes the first `created` to case 3's
retag, to N8's v2 and to N8b's v3, and gives case 10's hand-written root-brain line
`created` = its `updated`. Letting `entry` mint a new `created` per version would make N8
silently report "unchanged", the quiet-success trap ADR-0051 clause 3 names. The script
counts every edit and fails loudly if one is missed.

**What moved, observed** (every other row is unchanged):

| Row | `updated` key | `created` key (B and B′) |
|---|---|---|
| 3 retagged old entry | quiet | STALE {code2, code1} |
| 3b retagged, then code | STALE {code3} | STALE {code3, code2, code1} |
| N8 pin re-versioned after code | quiet | STALE {K code} |
| N8b v3 uncommitted, HEAD holds v2 | quiet | STALE {K code} |

Rows 3 and 3b match ADR-0082's re-run (`rerun-created-keys.txt`). **N8 and N8b are new and
this build owns the flip**, as ADR-0082 §2 owns 3/3b: the pin's text still predates K,
because a same-id version can only change zone or tags. The `today` column flips too, so the
shipped B3 (keyed on `created` since #371) already fires on this shape; the fixture documents
production. The cost: a session that curates the pin (promote, archive/restore, a zone or tag
edit) after code landed sees one B3 and a Part A list containing that code. Under B′, N5 is
quiet and N5b is `STALE {M1}`, as `bp-all.out` recorded under `updated` keys.

**Which is the reference (decide step D3).** RFC-043 Part 0 rules 1–6 plus B′, as ADR-0084 §5
accepts them, are the spec. These shell rules and their `.created.out` files are a one-time
acceptance oracle and are not run in CI. The standing gate is `test/pin-staleness.test.ts`:
each row is rebuilt with real git and the exact ordered set is asserted against values
transcribed from the B′ column above. Production matched every row before the fixtures were
frozen.

**Hosts (decide step D9).** Rule 5's squash case assumes the squash commit's author date is the
merge time: git's default for `merge --squash`, and observed on GitHub. GitLab and Bitbucket
are UNVERIFIED. On a host that keeps the original author date, a squash-landed PR below the
carrier with pre-pin authorship is dropped (quiet, like case 11). No host behaviour can add a
fire.
