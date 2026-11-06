# SessionEnd floor vs brain size (vfkb#396), 2026-11-04

Standalone wall time of `node dist/bundles/vfkb.mjs hook session-end`, run with
[`timing.mjs`](timing.mjs). This is a Tier-0 timing probe on the host, **not** under Claude
Code's SessionEnd budget. Setup: Apple M5 Pro, node v22.23.2, N=5 per cell, seed brain =
vfkb's own `.vfkb/entries.jsonl` at b503a50 (802 lines) plus synthetic filler facts.

## Observed

Cold: a fresh sandbox, so curation's whole backlog is available to the run.

| lines | before (main b503a50) p50 / max | after p50 / max | curated before → after |
|---|---|---|---|
| 802 | 835 / 848 ms | 291 / 298 ms | 62 → 62 |
| 3,202 | 1153 / 1161 ms | 348 / 352 ms | 37 → 62 |
| 10,802 | 1224 / 1266 ms | 507 / 522 ms | 11 → 62 |

Before the fix, curation hit its 1,000 ms deadline at 3.2k and 10.8k lines, so it archived
fewer entries as the brain grew. After the fix, the whole backlog fits.

Warm (`WARM=1`) after the fix, with the backlog cleared by the first run:

| lines | after p50 / max |
|---|---|
| 802 | 277 / 293 ms |
| 3,202 | 332 / 335 ms |
| 10,802 | 476 / 485 ms |

No warm "before" row is given. On main the first run does not clear the backlog at 3.2k and
10.8k lines (curation stops at its deadline), so a second run is still curating and is not a
floor measurement. A single 10.8k-line run on main reached 1557 ms. The review re-run (N=3)
saw at most 1285 to 1292 ms, so that run was not reproduced and is not used as evidence here.

Review re-run (N=3, same machine): cold p50 before / after = 959 / 340 ms (802 lines),
1150 / 393 ms (3.2k), 1284 / 534 ms (10.8k); curated at 10.8k 8–11 → 62.

The tables are for the run where the session left no handoff (B2 writes one). The runs where
the session left its own handoff are about 10 to 40 ms faster.

## Cause (from a `--cpu-prof` of a warm run on main)

- Each curation archive went through `updateEntry`, which re-read and materialized the whole
  brain (`readAll`).
- Its `appendRecord` then called `writeMeta`, which materialized the whole brain again.
- So two whole-brain passes per archive: O(archives × brain).
- Git child processes (about 7 at about 30 to 45 ms each) were the rest of the floor.

## Fix

`autoCurate` now edits from the snapshot it read under the lock, through
`applyFluidEdit(..., { meta: false })`, and calls `writeMeta` once at the end. Its lock wait
is now bounded by the curation deadline: if the lock is still busy then, curation is
skipped, rather than waiting ADR-0040's 5 s and running without the lock.

## Follow-up: the remaining floor (vfkb#448, 2026-11-06)

After #447 a run still read the whole brain 5 times. #448 changes:

- `newEntriesSinceHead` reads each line's id from its prefix and fully parses only lines whose
  id is not in HEAD. A line of any other shape falls back to a parse.
- Index meta is written once per run, **after the commit**, and only if the run wrote to the
  brain. The commit is the floor; meta is derived.
- Curation validates a line a second time only for ids with a `curation-kept` tag.
- `git add` runs only for an untracked or deleted brain ([ADR-0086](../../../adr/ADR-0086-sessionend-floor-mechanics.md)).
  `commit --only` handles any other tracked file itself. Measured in review on about 13 MB of brain:
  add + commit 127 ms, commit alone 93 ms.

**Standalone** ([`timing.mjs`](timing.mjs), `SIZES=0,10000,30000`, N=5, two interleaved rounds, load
average about 6 to 14; "before" is main at e1b3181, including #447):

| lines | before p50 (rounds) | after p50 (rounds) |
|---|---|---|
| 810 | 321 / 323 ms | 275 / 288 ms |
| 10,810 | 530 / 548 ms | 434 / 430 ms |
| 30,810 | 983 / 987 ms | 717 / 735 ms |

All cells curated the full 62. The slope fell from about 22 to about 15 ms per 1k lines. It is
still linear: git must still read and hash the brain, and two whole-brain materializations remain
(curation's snapshot and the one meta write).

**Under the real Claude Code budget** ([`harness.mjs`](harness.mjs), CLI 2.1.311, haiku, N=3 per cell,
two runs with the order swapped: [before first](out/harness-before-first.json), [after first](out/harness-after-first.json)).
It goes through the claude-auth seam (env token, no Keychain, shim `refusedWrites=0`) in a sandbox
config dir; the operator registry digest was unchanged. Verdicts are content assertions, read when
`claude -p` exits: the model answered on stdout (a trial without that is voided, none were), the
hook's end marker exists, and HEAD is the auto-commit. The JSON records every trial, the bundle
hashes and the load average (5-minute average about 12 falling to about 6).

The hashes show both runs used the same bundles. A bundle embeds the HEAD sha at build time, and the
runs predate the commit. Review reproduced the "after" hash exactly from this PR's `src/` with that
stamp, so the "after" code is tied to it. UNVERIFIED: the "before" bundle's source; its hash matched
no recent main commit in review (possibly a build-environment difference).

| cell | commit landed, before first | commit landed, after first |
|---|---|---|
| calibration (`sleep 4` before the hook) | **0/3** | **0/3** |
| before, real brain (~810 lines) | 3/3 | 3/3 |
| before, +10k | 3/3 | 3/3 |
| before, +30k | 3/3 | 3/3 |
| after, real brain | 3/3 | 3/3 |
| after, +10k | 3/3 | 3/3 |
| after, +30k | 3/3 | 3/3 |

The calibration arm is what makes this admissible: the budget was seen cutting a hook off, and the
commit had not landed 6 s later either.

**What this does and does not show:**

- Observed: both engines fit the budget and landed the commit, 18/18 each, up to 30.8k lines.
- **Not shown: any benefit under the harness.** It shows a fit, not a margin. The change's measured
  gain is the standalone cost above, and the commit now lands before the meta write.
- An earlier pair of runs on the same day had the old engine miss 4 of 18 (two each at +10k and +30k,
  all in one run; 3/3 at every size with the order swapped). Those runs are not evidence for either
  side: their PONG check could pass on a crash (the review of #453 found this), they kept no per-trial
  records, and the misses did not reproduce here. Why they missed is unknown.
- Do not extrapolate a safe brain size from standalone timings; the #447 write-up's "1.5 s near 60k
  lines" is withdrawn. The harness overhead on top of the hook was not measured.
- The 3k-line cut-off #384 saw was not re-measured at exactly 3k; +10k and +30k both fit.
- Slower machines: not measured. These numbers come from one M5 Pro.
