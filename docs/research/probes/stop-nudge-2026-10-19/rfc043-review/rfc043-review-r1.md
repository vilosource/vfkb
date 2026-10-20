# RFC-043 adversarial review — round 1 (PR #357, branch feat/handoff-nudge-decision-model @ e66da5a)

**Verdict: FIX-FIRST.**

Scope checked: the diff against the merge base 7d1429c is docs-only (6 files, +515). The two-dot diff against origin/main also shows src/engine.ts and a test, but those come from #355 landing on main afterwards and are not part of this PR.

The RFC gets B3's lack of governance right, and its numbers reproduce. But its central diagnosis misses the mechanical cause of most re-arming. Part A, as specified, would annotate pins misleadingly. And the PR's own brain entries break the ADR-0049 pin this RFC is about.

---

## BLOCKING

### B1. B3 re-arms when the PR that carries the handoff is squash-merged. The RFC's "fact not moment / premature handoff loop" diagnosis misses this, and Part A would annotate the pin with the very PR that wrote it.
- **Where:** RFC-043.md:76-80 ("Once a PR merges, the fact stays true"), :87-90 ("A mid-session handoff goes stale at the next merge"), :118-130 (Part A listing).
- **Ground truth:** `handoffIsStale` (src/stop-reminder.ts:342-352) picks its anchor as `rev-list -1 --before=<pin.updated> HEAD`, which uses committer date. It then tree-diffs the anchor against HEAD, excluding the brain. This repo squash-merges. The squash commit's committer date is later than the handoff it contains, and the commit also carries the PR's code. So the pin is stale **at the merge of the PR that wrote it**, however well-timed that handoff was.
- **How observed:** I simulated the anchor and diff on origin/main at 5 squash merges that each carry a handoff plus non-brain changes. 12 of the last 60 main commits are this shape.

  | merge | pin | pin introduced in | B3 at the merge | `git log anchor..merge -- . ':(exclude).vfkb'` |
  |---|---|---|---|---|
  | 7d1429c | a91f82e76700 | 7d1429c | stale (diff exit 1) | only 7d1429c itself |
  | 8114d76 | 6f2622d965e4 | 8114d76 | stale | only 8114d76 |
  | cf6343a | c937f9a07265 | cf6343a | stale | only cf6343a |
  | 480e5bc | d5667ac2c52c | 480e5bc | stale | only 480e5bc |
  | f163bcc | 7cb2570eeb51 | f163bcc | stale | only f163bcc |

  I found the introducing commit with `git log --first-parent --reverse -S<id> -- .vfkb/entries.jsonl`.
- **Consequences:**
  1. In 5 of 5 cases, a final, correct handoff re-arms B3 the moment its PR merges. Under the autonomous-merge workflow that merge happens mid-session. So the "loop" is at least partly an anchor defect, not a timing problem, and Part B, a model judging wrap-up, would only treat a symptom.
  2. Part A's annotation would read "This handoff predates 1 commit: <the PR that wrote it>", which is false.
  3. A rebase rewrites committer dates and produces the same false positive.
- **Fix:**
  - Re-anchor staleness on the first commit that contains the pin's id: `git log --first-parent --reverse --format=%H -S<pin.id> -- <entries>`, take the first one. If the pin is uncommitted, it is not stale. Use the same anchor for Part A's listing.
  - Add this anchor fix as Part 0 of the RFC.
  - Re-run the fire analysis classifying each B3 fire as "own-carrier only" or "a genuine later commit" **before** sizing Part B.
  - Add a Part A unit/L4 negative case: a squash-merged PR carrying the pin produces no annotation.

### B2. The PR's own brain entries hijack the ADR-0049 "Last handoff" pin.
- **Where:** .vfkb/entries.jsonl:521 and :523 (e9c19cc5819e, decision, tag `handoff`), :524 (cffec4e4d9ef, link, tag `handoff`). Pre-existing on main: :518 (a91f82e76700, evidence fact, tag `handoff`).
- **Ground truth:** `latestHandoff` (src/engine.ts:447-468) pins the newest injectable entry carrying a `handoff` or `next` tag, whatever its type.
- **How observed:** I copied each brain to the scratch dir and ran `VFKB_DATA_DIR=<copy> node …/0.18.0/dist/bundles/vfkb.mjs context-block | grep -A2 "## Last handoff"`.
  - On origin/main the pin is the B3 **measurement fact** a91f82e76700, not the real handoff 6f2622d965e4 ("NEXT: ADR-0077 clause 3").
  - With this PR the pin becomes the **RFC-043 link entry** cffec4e4d9ef.
  - B3's own `newestHandoffTimestamp` uses the same selection, so topical tags also move the staleness anchor.
- **Fix:**
  - Re-append e9c19cc5819e, cffec4e4d9ef and a91f82e76700 with the `handoff` tag removed. Last write wins on fold.
  - Confirm with `context-block` that the pin is a real handoff.
  - Have the RFC note topical `handoff` tags as a pollution source behind the R7 "106 handoff-tagged" count.
  - Consider a deterministic check: `handoff`/`next` only on a `fact`, warned by doctor.

---

## MAJOR

### M1. The evidence base is mostly not interactive sessions; 4 of the 24 fires are headless review-gate one-shots that wrote pins.
- **Where:** RFC-043.md:61-68, :83-86; a91f82e76700.
- **Ground truth:**
  - The `*vfkb*` glob matches about 90 sandbox and probe dirs (`…T-vfkb-bs-*`, `…T-vfkb-p2-*`, `…scratchpad-*`). Only 18 transcripts are in `-Users-jasonviloria-GitHub-vfkb`, and `~/.claude-cldw/projects/*vfkb*` matches nothing. Observed with `ls -d` and a per-dir count.
  - All 24 B3 fires (re-run: 108 sessions, 24 fires, 19 mid / 5 final, 14 acted / 10 declined, which matches the README's caveat) are in 11 real-repo sessions.
  - 1af5a422, 3ec988d2, d25f45e7 and 44bfaaa9 are one-prompt "ADR-0052 adversarial review gate for PR #317" sessions. That is 4 of the 5 "final-turn" fires and 4 of the 14 "acted".
  - 1af5a422 and 44bfaaa9 wrote `HANDOFF …` facts tagged handoff,next. Observed from the tool_use inputs.
  - 4f5077d1b89b excluded headless review-gate turns from the labelling, but nudge-fires.py includes them.
- **Why it matters:**
  - There is about 1 genuine interactive final-turn fire, so the act gate's "misses ≤1 in 10 final-turn opportunities" (:255) has almost no base rate.
  - B3 makes reviewer subagents overwrite the operator's pin, a harm neither Part addresses. Part B's `done` question would *fire* B3 on a one-shot reviewer.
- **Fix:**
  - Report real-session counts. Restrict the glob, or classify by dir and entrypoint.
  - Split out headless one-shot sessions.
  - Add a rule-based suppress for headless or non-interactive sessions, or state why not.
  - Restate "104 sessions" as "18 repo sessions plus about 90 sandboxes".

### M2. Part A names the wrong render function, and putting it in the cli.ts shell recreates the #205 face divergence.
- **Where:** RFC-043.md:118-123.
- **Ground truth:**
  - `## Last handoff` is emitted by `renderContextBundle` (src/engine.ts:566-581), reached through `renderResume` (:933-941). `renderContext` (:697-744) has no handoff section.
  - The same pin is rendered by `resumePayload` in heal.ts:169-176 (kb_resume, `vfkb resume`) and by pi-extension.ts:85. heal.ts:164-167 says sharing that one path "stopped #205 from having a third and fourth uncovered surface".
  - The /vfkb:brief skill also reads the pin.
- **Fix:** compute the annotation inside the shared render path, injectable for tests. That gives all faces the same pin and gives pi, which has no B3, a floor too. Correct the function name.

### M3. Part A fires mid-session after every compaction, which is the premature-handoff trigger the RFC is trying to remove.
- **Where:** RFC-043.md:118-145; ADR-0077; src/cli.ts:592-597.
- **Ground truth:** the SessionStart render ignores `source` by design, so the annotation is also injected on `source:"compact"`. In a long session after a merge, a "⚠ This handoff … may be out of date" line lands mid-session after each compaction. That is a second steering channel, and it is not counted in the RFC's "at most one steering message per turn".
- **Fix:**
  - Decide explicitly: either word the annotation as information ("commits since this handoff:", with no "⚠"), or note that it re-injects on compact and justify that.
  - Narrowing the render on `source` needs an ADR-0077 amendment, so do not gate on it silently.
  - Also char-cap the list inside `HANDOFF_PIN_CAP_CHARS` (ADR-0049 says the pin must not unbound the render). Ten subjects is a count, not a byte bound.

### M4. Shadow mode as specified cannot measure the act gate (selection bias), and act mode costs more than stated.
- **Where:** RFC-043.md:165-167, :233-256, :327-329.
- **Ground truth:**
  - The model is consulted only when B3 "would already fire and is not cooling". In shadow mode B3 behaves as today, so the log only contains turns where B3 actually fires, about one per 10-turn cooldown window. Final turns inside a cooldown window are never logged, so "misses ≤1 in 10 final-turn opportunities" cannot be measured.
  - In act mode a suppressed B3 does not call `markNudged` (cli.ts:712-716 marks only `d.fired`). So once stale and suppressed, the model is consulted on **every** Stop for the rest of the session, a distribution shadow mode never sees, at up to 1.5 s each. :329 implies a rare call.
- **Fix:** in shadow mode, consult on every Stop where B3's trigger holds, ignoring cooldown. Log whether today's B3 cooled or fired. State the act-mode per-turn cost honestly, or add a suppress-cooldown.

### M5. Part B's "today's behaviour" contract is ambiguous on the rule paths.
- **Where:** RFC-043.md:165-170, :192-193, :227-231.
- **Ground truth:**
  - The hard suppress (`background_tasks`/`session_crons` non-empty) is a rule, not a model output. The RFC does not say whether it applies under `NullDecider` or in shadow mode. If it does, it changes today's behaviour and silences B3 for a whole `/loop`, cron or Monitor session.
  - The precondition and cooldown currently live inside the pure `decideStop` (stop-reminder.ts:117-151). The proposed flow needs that split ("would fire" → consult → final), and the RFC does not specify it.
  - Excluding non-user turns at UserPromptSubmit has no stated discriminator. The RFC rejects reading the transcript, and no payload source field is observed (fc07da198bfa records only `prompt`).
- **Fix:**
  - State that every rule suppress applies only under `VFKB_DECIDER_MODE=act`.
  - Write the ordering as pseudo-code: trigger → cooling → mode → hard-suppress → secrets → decide → policy. Make each null or error branch go to fire.
  - Name the discriminator, for example the `<task-notification` prefix filter turn-corpus.py already uses, or mark it UNVERIFIED and treat it as a build-time probe.

### M6. Both L4s have arms that cannot discriminate.
- **Where:** RFC-043.md:344-357.
- **Part A:** the agent is asked "what is the current state and what to do next". In both arms it can run `git log` (and /vfkb:brief cross-checks git by design), so the contrast arm can name the sentinel too, and treatment can pass without the annotation.
  - **Fix:** the predicate must tie the answer to the injected text. Either run with no Bash or git tools in both arms, or assert that the sentinel is named with no git tool call in the transcript and that the annotation appears in the SessionStart output. Add the B1 negative arm (squash-carried pin → no annotation).
- **Part B:**
  - With `ReplayDecider` the probabilities come from fixtures, so the L4 proves the plumbing and policy, not the capability (judging wrap-up). That capability is pushed to calibration "never as a gate input". So act mode would ship without its load-bearing claim observed. ADR-0050 requires that claim to be observed, or the status to be named "built, NOT yet verified" for act.
  - The mid-session treatment "B3 does not fire" is an absence: a crashed hook or a broken stale computation gives the same result (ADR-0051 §3).
  - The wrap-up arm has no contrast: NullDecider also fires there.
  - The first build ships *shadow* mode, and no L4 covers shadow (B3 unchanged and a log record written).
- **Fix:**
  - Assert a positive record: the decider log line for the turn showing consulted, the policy result, and suppressed.
  - Add a shadow-mode L4.
  - State that act-mode capability stays "built, NOT yet verified" until there is calibration evidence on vfkb data.

### M7. Ruling 5's gate is not met, and the RFC says it "holds".
- **Where:** RFC-043.md:334; brain 8b2aefd11171; survey §10.
- **Ground truth:** Ruling 5 says decision models stay opt-in, "gated on the decision-model survey §10 calibration spike". §10 step 1 is "a throwaway script, no production code": labelled pairs, ECE/AUROC, hard-case separability and repeat variance on vfkb data. The RFC replaces that with a shadow mode that ships production code: a UserPromptSubmit handler, prompt storage, JevDecider and plugin hooks.json, possibly to every consumer (Q2). The ruling e9c19cc5819e does not waive the spike.
- **Fix:** either add a §10 step-1 spike as Part B's entry gate (turn-corpus.py already produces about 112 turns, roughly a dollar of Jev calls), or disclose the departure from Ruling 5 as an operator question.

### M8. The B3 reminder text, the proximate cause of compliance, is left unchanged.
- **Where:** src/stop-reminder.ts:97-106 ("this one has no SessionEnd fallback … must be recorded before the session ends"); RFC-043.md:85-86.
- **Ground truth:** agents quote this clause when complying. In d5948d4c the corpus shows "that nudge has no end-of-session fallback" at turns 5, 15 and 29 of 31; the raw transcript shows it at prompts 13, 26, 38 and 49 of 52. With Part A, that clause becomes false.
- **Fix:** have Part A rewrite STALE_HANDOFF_REMINDER, drop the urgency clause, and name the new floor. Add "reword the reminder" to Alternatives, as the cheapest experiment.

---

## MINOR

| # | file:line | Claim | Ground truth | Fix |
|---|---|---|---|---|
| m1 | RFC:96-100 | "a stale pin has nothing" | On a topic branch, session-end.ts:203-211 writes a `handoff,next,auto` entry when the session added any non-handoff entry. That becomes the newest pin and clears staleness (a thin floor that lists entries, not commits). | Say "no floor on a clean tree, on main, or when the session added nothing". |
| m2 | RFC:151-152 | "Two extra git calls (rev-list plus log)" | handoffIsStale already makes 3 (rev-parse, rev-list, diff; stop-reminder.ts:311-349); Part A adds log, so 4. | Correct it. |
| m3 | RFC:121 | `git log <anchor>..HEAD` | When the handoff predates all history, base is `EMPTY_TREE_SHA` (:347), a tree, so `git log <tree>..HEAD` errors and Part A silently drops the note. | Fall back to `git log HEAD` in that branch. |
| m4 | RFC:269 | "one review measured about 105 ms server-side" | Not in the survey (grep). The survey's measured figure is p50 ~0.21 s end-to-end (§2.1 :139). | Cite the source or use 0.21 s. **UNVERIFIED.** |
| m5 | RFC:278 | "about 1–2% of answers change between identical calls" | The survey (§2.3) says "15 distinct answer sets in 50 identical calls; probability shifts up to 0.13". The RFC understates it. | Use the survey figure; this matters near thresholds. **WRONG.** |
| m6 | RFC:275 | "intent-style accuracy … 72.5%" | The survey's 72.5% is multi-task; Banking77 (intent) is 75.3–84.0%. | Relabel. |
| m7 | RFC:327-328 | Node start "about 60–110 ms" | I measured about 40–50 ms (trivial path) and about 120 ms (full Stop path, outside a repo). | Fine; cite it as measured. |
| m8 | RFC:85-86 | "Two of those handoffs … (turns 4/31 and 28/31)" | turn-corpus.py shows 3 (d5948d4c 5, 15, 29 of 31). The phrase is in the agent's final message, not in the handoff text. | Correct the count and the attribution. |
| m9 | brain :521/:523, :522 | e9c19cc5819e's Why and 4f5077d1b89b still assert that 61f0e751 "ended" on a stale pin | c5dd75a6661e corrects this, but as a separate fact. Its own replacement, "commits landing after the pin (#352 and later)", is also wrong: #352 (be8be65, 12:09Z) predates the pin a91f82e76700 (12:37Z). The post-pin commits are #354 (7d1429c, which **carried** the pin, see B1) and #355. | Fix c5dd75a6661e. Supersede or re-append 4f5077d1b89b without the claim. |
| m10 | nudge-fires.py:12 | Bash handoff writes are matched on `--tags` | The CLI flag is `--tag` (#355). CLI-written handoffs are undercounted as "declined". | Match `--tags?`. |
| m11 | RFC:229-230 | "opt-in per project: VFKB_DECIDER=jev" | An env var is per process; set in a shell profile, it turns on for every project. | Specify `.claude/settings.json` `env`, or a brain-local config. |
| m12 | RFC:173-176 | Prompts recorded into SessionState | Neither part says recording happens only when the decider is enabled. Records under `.vfkb/.sessions/` are kept indefinitely. They are gitignored here (.gitignore:10), but plugin-born consumer brains may lack init's stanza (**UNVERIFIED**), and `git add .vfkb` would commit raw prompts. | Record only when `VFKB_DECIDER` is set, bound retention, and add a doctor check. |
| m13 | RFC:335-341 | DoD | Shipping a new hooks.json entry is a plugin release, and ADR-0051 §2 requires "delivery is unproven" until install-path.json exists. Part A also changes ADR-0049's pinned-section render, which ADR-0001 says must be done by amendment, not by editing. | Add the ADR-0051 delivery-honesty clause. Have the accepting ADR state "amends ADR-0049 (render of the pin section)". |
| m14 | RFC:107-109 | "the same collision two sessions hit on 2026-10-19"; 61f0e751 turn 3 quote | Not checked. | **UNVERIFIED.** |

**Checked and found correct:**
- B3 has no RFC/ADR/L4 (stop-reminder.ts:84).
- The cooldown is 10 turns and fails open (:57, :126-131).
- The nudge trigger table matches decideStop.
- SessionEnd's early return on a clean brain and its default-branch guard (session-end.ts:170-196).
- `.vfkb/.signals/` is gitignored (.gitignore:11).
- The Stop payload fields and native prompt-hook figures match fc07da198bfa.
- Fire counts reproduce, with the +1 drift the README discloses.
- Part A's departure from ruling e9c19cc5819e is disclosed (Q1).
- ADR-0013 is respected: `fetch` on Node ≥20, no SDK, null on error.
- The Brake exclusion holds: the observer only removes Stop continuations and never touches tools.
- The README index row is fine.
