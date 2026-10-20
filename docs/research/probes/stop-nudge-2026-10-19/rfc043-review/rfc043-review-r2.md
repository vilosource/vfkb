# RFC-043 adversarial review — round 2 (PR #357 @ 81733cb)

**Verdict: FIX-FIRST, and this is the ADR-0070 §4 escalation signal.** Round 1's fixes introduced all three blocking findings below:
- R2-B1 comes from the B1 fix (Part 0).
- R2-B2 comes from the M3 fix (the cap rule). My own round-1 wording, "char-cap the list inside HANDOFF_PIN_CAP_CHARS", contributed to it.
- R2-B3 comes from the M2 fix (where Part A lives).

Each one has a small, mechanical fix (given below), so this is not a rejection. Under CLAUDE.md's autonomous-PR rule, though, "blocking findings introduced by the previous round's fixes" means it goes to the operator (HITL) rather than another blind round.

**Disclosure.** While checking that the brain matches #358, I ran `git fetch origin pull/358/head:refs/tmp-ignore` in the worktree. That created a stray ref, `refs/tmp-ignore`, pointing at 8bc8866. It touches no branch, index or working-tree file. Remove it with `git update-ref -d refs/tmp-ignore`. I did not remove it myself, to avoid a further write.

Confirmed fixed from round 1:
- **Pin:** `context-block` on this branch's brain now pins the real handoff 6f2622d965e4.
- **Brain:** `entries.jsonl` is byte-identical to #358's head 8bc8866 (`cmp`).
- **Probe counts:** re-running the fixed probe on the real repo dirs gives 19 sessions, 24 fires in 11 sessions, 18 acted / 6 declined.
- **Survey figures:** corrected.

---

## BLOCKING

### R2-B1. Part 0's rules are wrong in three ways, and one premise misstates the existing code.
**Where:** RFC-043.md:159-172.

**(a) "A pin not yet in any commit … is current by construction" (:165-167) is false.**
- A session can record a handoff at turn 4 and commit code at turn 20. Today's timestamp anchor flags that case; Part 0 would call it fresh.
- Worse, on `main` SessionEnd never commits the brain (session-end.ts:187-196). A handoff written by a session on `main` therefore stays uncommitted indefinitely, and Part 0 treats it as never stale, across any number of later merges. B3 goes quiet and Part A says nothing.
- That is the main-checkout shape the RFC itself describes (:143-150).

**(b) "If `git log -S` fails or finds nothing, B3 fires as today. Failures go toward reminding, matching the existing posture" (:170-171) is wrong on both counts.**
- `handoffIsStale` fails toward **silence**: "anything else → fail-open", "fail-open (don't nag)" (stop-reminder.ts:351-355). Only the cooldown fails toward reminding.
- The rule also contradicts (a). An uncommitted pin and a lookup with no result are the same observation, "-S finds nothing", unless the build first checks `HEAD:<entries>`. The RFC does not say to do that.
- For an **outside-tree brain** the lookup always fails. Observed in a sandbox repo: `git log … -S<id> HEAD -- /abs/outside/entries.jsonl` gives `fatal: … is outside repository`, exit 128.
- So under (b) every outside-tree consumer gets a permanent B3 nag every 10 turns. That shape is the "documented, not exotic" one (stop-reminder.ts:332-338), and today it works through the timestamp anchor.
- :165 claims Part 0 keeps "the same pathspec rules … for in-tree, root and outside-tree brains". It cannot for outside-tree brains, because the carrier lookup needs the brain inside this repo's history.

**(c) A pin updated or retagged later is anchored on its first version.**
- `-S<id>` with `--reverse`, taking the first result, finds the commit that **introduced** the id. LWW re-appends (`updateEntry`, retag, text edit) keep the id.
- Observed in a sandbox: an old entry re-appended with a `handoff` tag after 3 code commits was anchored at `init`. `git diff --quiet` exit 1 marked it stale, and the listing showed 6 commits, all of which predate its promotion to the pin.
- Today's rule anchors on `updated` and gets this case right.

**Fix (one rule):**
- Anchor on the carrier only when the pin's current line is in `HEAD:<entries>` (in-tree or root brain). Find the carrier by the current version, not the id, for example the first first-parent commit whose blob contains the exact folded line, or `"id":"<id>"` together with `"updated":"<ts>"`.
- Use the **later** of that carrier and today's `rev-list --before=<updated>` anchor.
- In every other case (uncommitted, outside-tree, lookup failed) use **today's timestamp anchor unchanged**, not "not stale" and not "fire".
- Correct the posture sentence.
- Disclose the remaining trade-off: an early handoff squashed together with later work in the same PR is no longer flagged after the merge. B3 still flags it on the topic branch, because an uncommitted pin falls back to the timestamp rule.

**What I checked and found correct (no change needed):**
- **True merges under `--first-parent`:** pickaxe does diff merges against their first parent on git 2.50.1. The `--no-ff` merge was found as the carrier, and without `--first-parent` the side commit was found. Older git versions are UNVERIFIED.
- **Shallow clones** are benign. With depth 3 the first result is the shallow boundary only when the pin predates it, and then every visible commit really is later than the pin.
- **Rebase:** handled as the RFC says.
- **Performance:** about 0.12 s on this repo (188 first-parent brain commits). This now runs on every Stop, so keep the cache option.
- **"Cannot match a different entry" (:172)** is loosely worded, since `-S` also counts later references to the id in supersede refs or correction text. It is harmless when you take the first result.

### R2-B2. Part A's cap rule removes the floor for nearly every real pin.
**Where:** RFC-043.md:212-213: "Pin text plus annotation must stay within `HANDOFF_PIN_CAP_CHARS` (2,000). The list is cut first."

**Ground truth:** 17 of the last 20 handoff-tagged entries in this brain are longer than 2,000 characters, and 19 of 20 are longer than 1,800. Range 1,630–7,750; computed by folding `.vfkb/entries.jsonl`. Because the list is cut first, the annotation gets zero room in about 85% of real cases. Part 1's new reminder text ("the next session will see the same list") would then be false, and the safety argument for deferring or suppressing B3 falls away.

**Fix:**
- Reserve a fixed slice for the annotation (for example ≤400 characters: the count line plus as many subjects as fit, then "(+N more)") and truncate the **pin text** to the cap minus that slice.
- Or give the annotation its own small cap outside the pin cap.
- The count line must always survive.

### R2-B3. "Git access goes through the backend seam, like the other git-layer consumers" (:219-220) is false and breaks ADR-0044's layering.
**Ground truth:** src/backend.ts:11-13: "Git-layer consumers (git.ts, gating.ts, stop-reminder.ts, session-end.ts) stay file-based BY DESIGN … a backend without that property simply doesn't wire them." The seam has no git surface. Running git inside the engine's backend-agnostic `renderContextBundle` would also make engine unit tests depend on the git state of the checkout they run in, including test/compaction-survival.test.ts (ADR-0077 clause 2), unless that is stubbed. The "stub through the backend" plan cannot stub it.

**Fix:**
- Give `renderContextBundle`/`renderResume` an optional injected `pinStaleness` provider.
- Implement it in the git layer, next to `handoffIsStale`, sharing Part 0's anchor code.
- Wire it once at the shared entry points (`resumePayload`, the session-start hook, pi) so #205 parity holds.
- A non-file backend wires no provider, so it gets no annotation.

---

## MAJOR

### R2-M1. Two of Part A's L4 arms still assert an absence.
**Where:** RFC-043.md:446, and :434-435 (paired).

:427 says predicates are "never exit codes or absences".
- **Part A squash negative arm (:446):** "a squash-carried pin gets no annotation" is a pure absence. It is satisfied by a hook that crashed or never ran.
- **Part 0 squash arm:** pairs "output does not contain B3 text" with a positive `hook_success` record. I confirmed that record type exists in transcripts, with `hookName:"Stop"` and `stdout`.

**Fix:** give Part A's negative arm the same positive companion. The SessionStart hook output must contain `## Last handoff` plus the pin's sentinel, and must not contain "Commits since this handoff".

---

## MINOR

| # | file:line | Claim | Ground truth | Fix |
|---|---|---|---|---|
| r1 | RFC:17 | The ruling is brain `4bbe73188958` | `e68ad28f11b6` has `refs.supersedes: 4bbe73188958`, so 4bbe… is itself superseded. | Cite e68ad28f11b6. |
| r2 | RFC:83 | "5 single-prompt ADR-0052 review-gate sessions" | 5 review-gate sessions, 5 fires: correct. But dbb5c056 has 4 prompts (rounds 1–3 plus a `system` task-notification). | Say "review-gate sessions (4 single-prompt, 1 multi-round)". |
| r3 | RFC:126-127 | "`edf377bb`: 4 fires, 6 writes" | The fixed probe gives 7 writes (re-run output). | Update it. |
| r4 | RFC:107-109 | Each session's HEAD at fire time "the transcripts do not record" | True, but it can be reconstructed approximately: transcript records carry `timestamp` and `gitBranch`, and main's first-parent history has commit dates. | Optional: say "not recorded directly". |
| r5 | RFC:267-270 | Shadow mode consults on every Stop where the trigger holds | Correct as a fix for the bias, but it adds up to 1.5 s to every turn while stale, in shadow mode. | State the latency cost. |
| r6 | RFC:301-304 | Telling user prompts from system ones is UNVERIFIED | Fine as labelled. Note: the transcript marks task-notification turns with `promptSource:"system"` (seen in dbb5c056), so the spike can label from that even if the hook payload lacks it. | Optional. |

**Verified correct this round:**
- B3 table row (:64).
- Squash examples (:96-97): match my round-1 data.
- Probe README and the `--tags?` fix.
- `renderContextBundle` at engine.ts:544; `resumePayload` at heal.ts:169; pi at pi-extension.ts:85.
- Part B is gated on Ruling 5's spike, and Q4 discloses the departure.
- Act mode stays "built, NOT yet verified".
- The ADR-0049 amendment is named.
- `.signals/` stays gitignored.

The coordinator's handling summary is not part of the RFC, and I did not grade it.
