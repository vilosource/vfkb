# RFC-043 adversarial review — round 4 (PR #357 @ ba8e430)

Scope: `docs/rfc/RFC-043-stop-nudge-observer.md` at ba8e430. The change under review is 6776dfc (`git diff 5d4c2e5 6776dfc -- docs/rfc/`). ba8e430 is a merge of origin/main and touches neither `docs/rfc/` nor `src/` (`git diff 6776dfc ba8e430 -- src docs/rfc` is empty).

What I checked:
- The claims against `src/stop-reminder.ts` (newestHandoffTimestamp :232-273, handoffIsStale :297-357), `src/engine.ts` (latestHandoff :447, renderContextBundle :544), `src/heal.ts:176`, `src/cli.ts:362-366` and `:626`, and `src/pi-extension.ts:81-85`.
- The Part 0 prototype, re-run from a copy in the scratchpad.
- 15 new cases of my own, run in throwaway sandboxes under `scratchpad/r4/sandbox/`: `r4-cases.sh` (14 cases) and `r4-shallow.sh` (1 case), with outputs in `*.out`. A rule variant B′ was run over all 33 cases (`bp-all.sh` → `bp-all.out`).

Git is 2.50.1 (Apple Git-155). I made no writes to either worktree and no brain writes.

**Verdict: MERGE.**
- No blocking findings. All round-3 findings are resolved, and the prototype reproduces byte-for-byte.
- Three MAJOR findings, all non-blocking. Each is an undisclosed residual case of the adopted rule, and each fails toward silence or matches today's behaviour:
  - R4-M1 and R4-M3 also hold for r2 (and R4-M3 for today), so neither is new to this round.
  - R4-M2 is new with rule 5.
- The fix for each is a disclosure bullet plus a unit-test fixture. One optional rule tweak, B′, is offered for R4-M3. I recommend folding these into this PR, but they do not gate it.
- **ADR-0070 §4: no blocking finding was introduced by this round's fixes.**

---

## 0. Prototype reproducibility

I copied `sandbox/` to `scratchpad/r4/sandbox/`, then ran `mkdir p && cd p && bash ../anchor-proto.sh > ../r4.out`. `diff ../r4.out ../anchor-proto.out` shows the two are **IDENTICAL**.

The README table matches its saved output, and the counts check out row by row:
- today 15/18, r2 13/18, A 16/18, B 17/18.
- The RFC table's 8 rows plus "the other 10 cases" make 18.
- "Today's rule gets 9 of them right; it flags the last one" (7b) is correct.
- "All three new rules" means r2, A and B, which is correct.
- The DoD names exactly the 18 prototype rows (:556-563).

## 1. Round-3 findings: status

| Finding | Status | Evidence |
|---|---|---|
| R3-B1: handoff → code → brain commit silenced | **FIXED** | The carrier is now only excluded, never an anchor (:199-205, :207-212). Prototype case 7 gives STALE {K}. My N11 runs the same shape from a detached HEAD in a linked worktree and also gives STALE {K}. |
| R3-M1: incomparable anchors | **FIXED** | `T` is computed with `--first-parent` (:180-185). Case 5 gives STALE {M}, with no ancestry comparison left in the rule. |
| R3-M2: listing includes pre-pin second-parent commits | **FIXED** for the cause named | The listing is first-parent (:195) and is exactly `S` (:205, :292-295). Case 6 lists only M. A *different* cause of the same mislabel remains on the no-carrier path: see R4-M3. |
| R3-M3: two pin selectors | **FIXED** | :174-179 and DoD :566-568. I reproduced it with `cmp.mjs` on a synthetic three-line brain: the raw scan picks `HIJACK 10:00` and the engine picks `REALPIN 09:00`. Both real brains now agree on `aa28c85cd53b`; the README's ids are older but were true when written. Fidelity note: `cmp.mjs` re-implements the raw scan because `newestHandoffTimestamp` is not exported. It mirrors :232-273 line for line, so this is acceptable. |
| r-a: regex-escape | FIXED | :190. The prototype's `esc()` escapes `.[\*^$` but not `+?(){}\|`. Harmless, since ids are hex and `updated` is ISO. The DoD metacharacter test (:566) covers it. |
| r-b: subject truncation | FIXED | :311-314. "12 of the last 40 subjects on `main` exceed 100" is correct: I counted 12 on origin/main by characters. |
| r-c: `context-block` wiring | FIXED | :329-332. The citation cli.ts:365 is correct. |
| r-d: pi renders on every prompt | FIXED | :348-352. The citation pi-extension.ts:81-85 is correct, and the cache is now required. |

Other claims I checked that hold:
- 549/549 brain lines are id-first and updated-last. The RFC says 534/534, which was true when measured.
- `--first-parent` with a pathspec lists `--no-ff` merges (cases 5 and 6).
- An empty `T` works from the root (my N9 and N9b, orphan branch).
- A pin updated twice works, with v2 committed (N8) or a newer v3 uncommitted (N8b).
- `pull --rebase` on main with a local brain commit, upstream post-pin PR, gives STALE {O} (N12).
- The cited line numbers at heal.ts:176, cli.ts:626 and engine.ts:544 are correct.

**The UNVERIFIED claim at :247-249 (GitHub's squash author date) is now verifiable from this repo.** On the last 300 first-parent `origin/main` commits, author date equals committer date in **300/300** (`%at == %ct`). GitHub sets the committer date at merge time, so GitHub squash commits carry the merge-time author date. The Tier-0 probe can cite this. It also matters for case 9 (rebase onto a main that moved), not only case 11: M1 survives rule 5 *because* of this.

---

## 2. BLOCKING

None.

---

## 3. MAJOR

### R4-M1. "On the topic branch, before the squash, the code **is** flagged" is false when code and brain are committed together. The class is disclosed; its scope is over-claimed. Not new: r2 had the same miss.

**Where:** :236-239.

**Observed (N1):** handoff at 10:00, uncommitted. Then code, then **one** `git add -A` commit holding both code and brain at 11:00, on the topic branch.

| Rule | Result |
|---|---|
| expected | STALE {K} |
| today | STALE |
| r2 | quiet |
| A | quiet |
| **Part 0 (B)** | **quiet** |

The mixed commit *is* the carrier, so the post-handoff code is "inside the carrier" on the topic branch as well, not only after a squash. Like the squash case, this is inherent to excluding the carrier.

Frequency:
- **0 of 64** brain-touching branch commits in this repo also touch non-brain paths (`git log --all --no-merges --not origin/main`).
- SessionEnd's auto-commit is brain-only.
- So this is not the default path here. A consumer that commits with `git add -A` hits it whenever a handoff precedes code in the same commit.

**Fix:** reword the last sentence of :236-239: "…the code is flagged on the topic branch **only if the brain is committed separately from the code** (prototype case 7; the SessionEnd auto-commit does this). A single commit carrying both the pin and later code is itself the carrier, and that code is not flagged anywhere." Add N1 as a fixture asserted **quiet** (disclosed).

### R4-M2. Rule 5's inference "author date ≤ u ⇒ pre-pin work" is false for amend, fixup/autosquash, and back-dated commits. Undisclosed. **New with this round's rule 5.**

**Where:** :202-204, and the residual list :235-255.

**Observed:**

| Case | expected | today | A | **Part 0** |
|---|---|---|---|---|
| N2: K authored 09:00 (pre-pin), pin 10:00, K **amended** with more code at 11:00, brain commit 12:00 | STALE {K} | STALE | STALE {K} | **quiet** |
| N3: post-pin code committed with a back-dated author date (`GIT_AUTHOR_DATE` / `--date`), then brain commit | STALE {K} | STALE | STALE {K} | **quiet** |
| N4: post-pin `--fixup` squashed by `rebase -i --autosquash` into a pre-pin commit, then brain commit | STALE {A1} | STALE | STALE {A1} | **quiet** |

Why it happens:
- Amend, fixup and squash keep the *original* author date while adding post-pin content.
- So "rebase rewrites committer dates and keeps author dates" (:203-204) is true, but its converse does not identify pre-pin work.
- These are false negatives against today's behaviour, confined to the topic-branch window: after a squash to main, the work is inside the carrier anyway.
- They fail toward silence, and Part A misses them too, because it is one computation.
- r2 was also quiet on N2–N4, because its carrier moved the anchor. So relative to the previous RFC text this is not a regression, but rule 5 is the mechanism now responsible for it.

**Fix:** add a disclosure bullet: "**Content folded into a pre-pin-authored commit** (amend, `--fixup`/autosquash, an explicitly back-dated author date) below the carrier is treated as pre-pin work and not flagged." Add N2 and N4 as fixtures asserted quiet, so any future change is deliberate. No rule change is needed. Git cannot tell an amended commit from a rebased one, which is the same reasoning as case 11.

### R4-M3. Rule 5 only runs when there is a carrier, so an uncommitted or outside-tree pin followed by a rebase fires, and Part A lists the pre-pin commits as "since this handoff". The RFC's critique of rule A (:231-233) applies to Part 0's own no-carrier path. Undisclosed; same as today.

**Where:** rule 5 is gated on `C` (:202). The table row "force-rebase, no upstream change → quiet" (:224) is not scoped to committed pins.

**Observed:**

| Case | expected | today | **Part 0** |
|---|---|---|---|
| N5: A1 (pre-pin) on topic, handoff written (uncommitted), `rebase --force-rebase` | quiet | STALE | **STALE {A1 (pre-pin)}** |
| N5b: same, rebase onto a main that moved after the pin (the `pull --rebase` shape) | STALE {M1} only | STALE | **STALE {A1 (pre-pin), M1}** |

This is the round-3 rule-A defect, alive on the no-carrier path:
- A mid-session handoff followed by a rebase before pushing is a normal workflow here.
- An outside-tree brain *never* has a carrier, so for it this defect is permanent.
- It is a false positive, the premature-handoff trigger that Part 0 exists to reduce. Part A's listing also mislabels pre-pin work, the R3-M2 symptom by another cause.

It is today's boolean, so not a regression. Not blocking.

**Fix, either of:**
1. **Disclose** it in the residual list and scope :224's row to committed pins.
2. **Optional rule B′:** with no carrier, drop any `S` member whose author date ≤ u, with no ancestry condition. I ran B′ over all 33 cases (`bp-all.out`):
   - It gives **identical answers to B on all 18 prototype rows**.
   - It fixes N5 → quiet and N5b → STALE {M1}.
   - It changes nothing else among the new cases.
   - Its cost is that N2/N3-type folding without a carrier, and case-11-type landings, become silent for uncommitted and outside-tree pins too. That is the same trade B already makes for committed pins.

I lean toward B′ for consistency ("one rule, carrier or not"). This is the operator's call, and disclosure alone is acceptable.

---

## 4. MINOR

| # | Where | Issue | Fix |
|---|---|---|---|
| r4-a | :202-204 | **Timezone.** The rule does not say *how* author date is compared to `u`. The prototype uses epoch seconds (`%at` vs `date -u`), which is correct (N10: an author date of +03:00 that is before `u` in UTC is dropped, giving quiet). A string comparison of `%aI` with `u` gets N10 wrong: `"…12:30:00+03:00" > "…10:00:00.000Z"`. That would wrongly *keep* rebased pre-pin work for every commit authored within the UTC offset before the pin. This operator's commits are all +03:00. | Say "compared as instants (`%at` vs the epoch of `u`)". Add N10 as a fixture. |
| r4-b | :262-263 | **"Shallow clones are benign" is only half true.** At the shallow boundary, `-G` sees the grafted root as adding the whole file, so the **boundary commit becomes the carrier** even when the pin was added below it. It is then excluded from `S`. Observed (`r4-shallow.sh`, `--depth 2`, pin below the boundary, post-pin X and Y): carrier = X, Part 0 gives STALE {Y}, and X is missing. With `--depth 1` the only visible commit is excluded, which is quiet. This is rare for interactive checkouts. | Disclose it, or require that the carrier has a parent (`git rev-parse C^` succeeds). |
| r4-c | :259-261 vs :257-258 | "A failed `merge-base` keeps the commit in `S`" fails toward **reminding**. That contradicts "fails toward silence; only the cooldown fails toward reminding". An unreadable author date is also unspecified. | Either drop the commit on failure (silence), or name it as a second fail-toward-reminding step. |
| r4-d | :312-313 | "this branch's `5d4c2e5` exceeds 300": its subject is **297 characters / 299 bytes**. The claim was inherited from r3. | Say "about 300". |
| r4-e | :236-239, :250-253 | Merges into the topic branch are also carriers (N7: main, with a squash carrying the pin and a later PR S2, merged into the topic). The boolean is right (STALE {T1}), but S2's post-pin work is inside the merge carrier and not listed. The same holds for an octopus merge carrying the pin plus other arms' post-pin code (N6, quiet). | Covered by R4-M1's widened wording ("any commit carrying the pin"); optionally add N7 as a fixture. |
| r4-f | :247-249 | The GitHub squash author date can be marked observed (300/300 on origin/main, §1), and noted as load-bearing for case 9 as well as case 11. | Replace UNVERIFIED with the observation, and keep the Tier-0 probe for other hosts. |

---

## 5. ADR-0070 §4

**Were any BLOCKING findings introduced by this round's fixes (6776dfc vs 5d4c2e5)? No.** There are no blocking findings this round.

Of the MAJOR findings:
- **R4-M2** is attributable to this round's new rule 5. It is non-blocking, and r2 was equally silent on those cases.
- **R4-M1** was carried over from r2's wording.
- **R4-M3** is today's behaviour, left undisclosed.

The prototype-first approach did what it was meant to do: no previously fixed case regressed (18/18 rows reproduce, and B matches 17/18 with the one miss disclosed).

**Verdict: MERGE.** Recommend applying the R4-M1–M3 disclosure edits and fixtures (and, optionally, B′) in this PR.
