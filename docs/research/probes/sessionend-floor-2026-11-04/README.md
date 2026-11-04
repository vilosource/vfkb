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

## Not observed

- Wall time **under the Claude Code harness**. The #384 harness probe (`../sessionend-budget-2026-10-27/probe.mjs`)
  was not re-run: it spawns `claude` on the operator profile's login, and from a non-Aqua
  pane that risks Keychain dialogs. UNVERIFIED: that the harness cut-off seen at 3k lines in
  #384 is gone. The standalone floor now sits about 1 s below the 1.5 s budget at 10.8k lines.
- Slower machines. These numbers come from one M5 Pro.

## Still linear

The per-archive cost is gone, but the floor still grows with the brain, about 19 ms per 1k
lines in the review re-run: the brain is read whole about 5 times per run (working tree,
`git show HEAD`, the curation snapshot, curation's meta write, B2's meta write). At that rate
the standalone run would reach 1.5 s near 60k lines (extrapolated, not measured). Tracked in
the follow-up issue.
