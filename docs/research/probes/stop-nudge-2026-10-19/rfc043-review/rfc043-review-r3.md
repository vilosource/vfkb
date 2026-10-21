# RFC-043 adversarial review — round 3 (PR #357 @ 5d4c2e5)

Scope: `docs/rfc/RFC-043-stop-nudge-observer.md` at 5d4c2e5, which applies the round-2 fixes (`git diff 81733cb..5d4c2e5 -- docs/rfc/`). I checked the claims against `src/stop-reminder.ts`, `src/engine.ts`, `src/heal.ts`, `src/pi-extension.ts`, `src/cli.ts`, `src/backend.ts` and `src/session-end.ts`, and ran experiments in a throwaway sandbox (`scratchpad/r3-sandbox/case{1,2,3}.sh`, git 2.50.1). I made no writes to the worktree. The stray `refs/tmp-ignore` from round 2 is gone.

**Verdict: FIX-FIRST.**
- One blocking finding remains, R3-B1. It is the **unfixed remainder of R2-B1(a)**: the bug first appeared in round 1's carrier anchor and was not introduced by round 2's fixes.
- Round 2 did add a false sentence that hides it (:199-201).
- Round 2's fixes also introduced two MAJOR findings (R3-M1, R3-M2). Neither is blocking.
- **The ADR-0070 §4 "introduced by the previous round" trigger does not strictly apply.** This is round 3, though, and it has not converged, so the 3-round backstop ceiling in CLAUDE.md sends it to the operator anyway.

---

## 1. Round-2 findings: status

| Finding | Status | Evidence |
|---|---|---|
| R2-B1(a): uncommitted pin treated as "not stale" | **PARTIAL** | An uncommitted pin now falls back to the timestamp anchor (:175-176). Correct for the in-session window. But R2-B1(a)'s actual scenario (handoff at turn 4, code at turn 20) goes silent again once the brain is committed after the code. On a topic branch SessionEnd does exactly that (session-end.ts:205+, brain-only commit at the end). See R3-B1. |
| R2-B1(b): failure posture misstated; outside-tree always failing | **FIXED** | :193-196 now says "fails toward silence", matching stop-reminder.ts:351-355. Outside-tree falls back to the timestamp anchor (:177). In the sandbox, `git show HEAD:/abs/...` exits 128, which is a fallback, not a fire. |
| R2-B1(c): retagged pin anchored at its first version | **FIXED** | Sandbox case1: an old entry re-appended with `handoff` after two code commits. The `-G'"id":"PIN1".*"updated":"<new>"'` lookup finds the `retag PIN1` commit; the id-only `-S` lookup finds the squash that first introduced it. |
| R2-B2: annotation squeezed out by pin cap | **FIXED** | :246-253 reserves a ≤400-character slice. The count line always survives and the pin text is truncated to `cap − used`. The arithmetic is consistent: the section is bounded by 2,000 plus the existing truncation marker, the same bound as today (engine.ts:576-579). |
| R2-B3: git through the backend seam | **FIXED** | :260-268 has an injected `pinStaleness` provider in the git layer, wired at the three `renderResume` callers (heal.ts:176, cli.ts:626, pi-extension.ts:85). The engine never runs git and engine tests stay git-independent. Small parity note in r-c below. |
| R2-M1: squash arm asserts an absence | **FIXED** | :498-500 adds a positive companion (`## Last handoff` plus the pin sentinel). |
| r1 ruling id | FIXED | `e68ad28f11b6` is the live head: nothing supersedes it (grep for `"supersedes":"e68ad28f11b6"` finds 0). |
| r2 review-gate sessions | FIXED | :84 |
| r3 7 writes | FIXED | :130 |
| r4 "not recorded directly" | FIXED | :109-111 |
| r5 shadow latency | FIXED | :331-332 |
| r6 `promptSource:"system"` | FIXED | :352-354 |

Other checks that passed:
- Entries serialize `id` first and `updated` last in **534/534** lines of this brain. Tombstones (`{id,deleted,updated}`) do too. A non-engine writer (vfwb projection, hand edit) with another key order just gets no match and falls back, which is safe.
- `-G` under `--first-parent` diffs a `--no-ff` merge against its first parent (sandbox case1: the carrier found is `merge t2`).
- The squash carrier is the squash commit itself.
- An uncommitted pin is absent from `HEAD:<entries>`, which leads to the fallback.
- The `-G` pattern cannot be false-matched by entry *text* that contains `"updated":"…"`, because JSON escapes those quotes as `\"`.
- The new brain fact 320fda290c31 is tagged `b3,stop-hook,measurement,correction`, with no `handoff`/`next` tag, so it cannot hijack the pin.

---

## 2. BLOCKING

### R3-B1. Part 0 silences B3 and Part A for the default "handoff, then more code, then brain commit" shape. The round-2 text claims the opposite.

**Where:**
- RFC :172-173 ("the later of the carrier and the timestamp anchor").
- :191-192 ("the carrier can only move the anchor forward").
- :197-201. Disclosed trade-off: "On the topic branch itself B3 still flags it, because there the pin is either uncommitted or carried by an earlier branch commit."

**Ground truth:**
- The prescribed session-end flow commits the brain **after** the session's code: CLAUDE.md says "git add .vfkb && git commit", and the plugin's SessionEnd auto-commit (session-end.ts:205+, pathspec-scoped, brain-only, on topic branches) does the same.
- So a handoff written mid-session is carried by a branch commit that comes *later* than the code it predates.
- The "later" anchor therefore jumps past that code.

**Observed (sandbox case3.sh):**

```
T0 base → (handoff written 03-02T10, uncommitted) → K "code committed AFTER the handoff" (03-02T11)
        → E "session-end brain auto-commit" (03-02T12)
next session on topic: carrier=E  ts-anchor=T0
today (ts anchor) B3 stale? exit 1 (stale)
Part 0 (later=carrier) B3 stale? exit 0 (NOT stale)
Part A listing C..HEAD: (empty)
```

What this means:
- B3 flags this case today; Part 0 makes it silent, and Part A shows nothing.
- This is R2-B1(a)'s own scenario: "handoff at turn 4, code at turn 20 … Today's timestamp anchor flags that case".
- It is also the premature-handoff shape the RFC exists to address ("It feeds a loop", :127-130).
- The floor the ruling relies on ("a stale-pin fallback makes a wrong 'stay quiet' safe") disappears for exactly the case Part B would suppress.
- The disclosed trade-off says the loss is confined to after a squash. That is false: it also happens on the topic branch, by default.

**Fix:** Stop using the carrier to *move* the anchor. Use it only to *exclude its own diff*.

1. Compute the timestamp anchor on first-parent history: `T = git rev-list -1 --first-parent --before=<updated> HEAD` (also fixes R3-M1 and R3-M2).
2. The pin is stale iff some first-parent commit in `T..HEAD` **other than the carrier** touches non-brain paths: `git log --first-parent --format=%H T..HEAD -- <pathspec>`, minus `C`. Part A lists the same set.

How this rule behaves:
- In the sandbox it returns exactly `K` for case3.
- For the squash case (cause 1) it returns nothing, so the squash fix is kept.
- After a squash it still returns any other PR merged after the handoff.
- With no carrier (uncommitted, outside-tree, lookup failed) it reduces to today's behaviour.
- The squash-carrying-early-code trade-off stays inherent. Disclose it accurately: the loss is only the code **inside** the carrier commit.
- In this shape `git log --first-parent -- <pathspec>` lists `--no-ff` merges (sandbox case2 lists `M merge feat`). The tree-diff comment at stop-reminder.ts:284-289 is about `--name-only` without `--first-parent`. Keep a unit test for it.

**Minimum acceptable alternative:**
- Keep "later of the two", but rewrite :197-201 to say the loss also applies on the topic branch whenever the brain is committed after the code (the SessionEnd default).
- Add that case to the unit-test list at :487-490.
- Make sure Q1 and the Part B safety argument account for it.

---

## 3. MAJOR

### R3-M1. "On first-parent history 'later' is well defined: one is an ancestor of the other" is false. Introduced by round 2.

**Where:** RFC :172-173.

The timestamp anchor comes from `git rev-list -1 --before=<updated> HEAD` without `--first-parent` (stop-reminder.ts:343). It can be a second-parent commit.

**Observed (sandbox case2.sh, pin committed in C on main, then a `--no-ff` merge of a feature commit F dated before the pin):**
- `carrier=C`, `ts-anchor=F`.
- `merge-base --is-ancestor` gives exit 1 in **both** directions, so the two are incomparable.
- An implementation that follows the RFC's ancestry definition has no answer.

The B3 boolean is robust either way, because an incomparable T implies a merge after the pin. The spec is still undefined.

**Fix:** compute the timestamp anchor with `--first-parent` (as in R3-B1). Both anchors are then on one chain, and the claim becomes true.

Disclose that this is a change to today's B3 anchor. It is behaviour-equivalent for the boolean, apart from clock skew: case2 gives `B3 diff exit 1` with both anchors.

### R3-M2. The fallback anchor now feeds Part A, and its listing includes commits from before the handoff. Introduced by round 2.

**Where:** RFC :174-179 together with :233-235 and :256-259.

**What changed:**
- In round 1 every Part A annotation was anchored on a first-parent carrier.
- Round 2 routes uncommitted, outside-tree and failed-lookup pins to the timestamp anchor, and Part A shares that code.
- `git log <T>..HEAD` from a second-parent T lists main commits made **before** the pin.

**Observed (sandbox case2.sh, uncommitted pin on main):**

| Listing | Commits shown |
|---|---|
| `T..HEAD`, labelled "Commits since this handoff was recorded" | `M merge feat (post-pin)`, `P main (pre-pin)` |
| `--first-parent TF..HEAD` | `M merge feat` only |

The wrong case is an uncommitted pin on a branch that later takes a true merge. That is the main-checkout shape (SessionEnd never commits on `main`) in any consumer repo that uses merge commits. The RFC's own rationale (:256-257) is that "a wrong annotation would mislead".

**Fix:** use the first-parent timestamp anchor, and `git log --first-parent` for the listing (as in R3-B1).

### R3-M3. B3 and Part A would pick **different pins**. This is a pre-existing code bug, not introduced by round 2, but Part 0's "current version" rule assumes it isn't there.

**Where:**
- src/stop-reminder.ts:232-273 (`newestHandoffTimestamp`).
- RFC :166-168, :178, :258 ("The two share Part 0's anchor code").

**Ground truth:**
- `newestHandoffTimestamp` scans **raw JSONL lines**, not the LWW-folded set.
- A superseded *version* of an entry that has since been retagged out of `handoff` still qualifies.
- On this branch's brain right now (computed with the dist `isInjectable`/`supersededIds`):
  - B3 selects `cffec4e4d9ef @ 2026-10-20T08:51:59` (the #358 hijacker's old tagged line; its current version is tagged `handoff-topic`).
  - `latestHandoff` (engine, folded) pins `6f2622d965e4 @ 2026-10-19T12:13:11`.
- Under Part 0, B3 would find that stale line in `HEAD:<entries>` and anchor on the commit that added it.
- Part A would anchor on 6f2622d965e4. So the two faces disagree, and B3 already under-fires today.

**Fix:** state in Part 0 that the pin is selected by `latestHandoff` over the materialized set, so B3 and Part A use one selector. Add a unit test: an old tagged line plus a newer untagged version of the same id must not be the pin.

---

## 4. MINOR

| # | file:line | Issue | Fix |
|---|---|---|---|
| r-a | RFC :170 | `-G` is ERE, so the `.` in `updated` matches any character. Harmless, since a match also needs the hex id. | Optionally say "regex-escape `<updated>`". |
| r-b | RFC :249-251 | A single commit subject can be long: 9 of the last 40 on main are over 100 characters, and 5d4c2e5's is over 300. "As many subjects as fit" may then show none. | Truncate each subject (for example to about 100 characters plus "…") before filling the slice. |
| r-c | RFC :265-266 | `vfkb context` (cli.ts:365) calls `renderContextBundle` directly and renders `## Last handoff`. It is not among the wired entry points, so it would show no annotation. | Wire it too, or name it as an intentional exception. |
| r-d | RFC :282-283 | pi calls `renderResume` on every `before_agent_start` (pi-extension.ts:82-85), so the provider's git calls run on every pi prompt, not only once at session start. | State it in the Cost paragraph, or cache per (pin, `updated`, HEAD) as Part 0 already proposes. |

---

**Verdict: FIX-FIRST.** R3-B1 is blocking. It is the remainder of R2-B1(a), not newly introduced by round 2, though round 2's trade-off sentence misstates it. R3-M1 and R3-M2 were introduced by round 2 and are not blocking. One edit (the first-parent timestamp anchor plus "exclude the carrier's own diff") fixes R3-B1, R3-M1 and R3-M2 together. Round 3 has not converged, so the CLAUDE.md 3-round backstop ceiling applies: escalate to the operator with these findings rather than starting round 4 blind.
