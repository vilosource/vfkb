---
type: RFC
title: "RFC-043: The stale-handoff nudge fires on a fact, not a moment — fix its anchor, give it a floor, and gate any decision model on evidence"
description: "B3, the stale-handoff Stop nudge, has no RFC, ADR or L4, and it is the nudge that fires 'all the time'. Adversarial review found that a large share of its fires are a deterministic false positive: a squash merge makes the handoff it carries look stale, because the staleness anchor uses committer date. So the first fix is deterministic (Part 0: count only first-parent commits after the pin, excluding the commit that carries it and rebased pre-pin work; chosen by a prototype over 18 sandbox cases). It is followed by a reminder-text change (Part 1) and a read-only stale-pin floor in the shared resume render (Part A), which makes suppressing B3 safe. A decision-model observer such as TypeSafe Jev (Part B) is kept as a design, but it is built only if B3 still fires mid-session after Part 0 and a throwaway calibration spike shows the model beats a rule-only baseline."
status: "Accepted in part → ADR-0084 (2026-10-27; Parts 0, 1, A; Part B gated)"
timestamp: 2026-10-20
---

# RFC-043: The stale-handoff nudge fires on a fact, not a moment

- **Status:** **Accepted in part 2026-10-27 → [ADR-0084](../adr/ADR-0084-handoff-nudge-next-prompt.md)** (Parts 0, 1 and A, as written; Part B gated on the [#388](https://github.com/vilosource/vfkb/issues/388) re-measurement; open questions settled in [RFC-047](RFC-047-less-intrusive-handoff-nudge.md) §8). Previously: Proposed (revised after adversarial review rounds 1–3 and a Part 0 prototype,
  2026-10-20; round 3 escalated at the ceiling, and the operator chose prototype-first)
- **Date:** 2026-10-20
- **Deciders:** operator + Claude
- **Governs:** the **B3 stale-handoff nudge** in `src/stop-reminder.ts`. B3 shipped as a
  "pragmatic patch, built NOT yet verified — no RFC/ADR/L4 yet" (its own code comment). This
  is its first governing proposal.
- **Operator ruling it implements:** brain `e68ad28f11b6` (2026-10-19; the live head of the
  chain `e9c19cc5819e` → `4bbe73188958` → `e68ad28f11b6`, whose only changes are a corrected
  *Why* and the `handoff` tag removed). The
  ruling: scope is B3; a decision model only times B3 and never creates a fire; a stale-pin
  fallback makes a wrong "stay quiet" safe; Jev is the leading candidate but not pre-chosen;
  the shape is an observer seam, opt-in, consistent with Ruling 5. **Where this revision
  departs from that ruling, it says so and asks (Q1, Q4).**
- **Relates:**
  - [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md) (the Stop-hook
    reminder pattern),
    [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (the B2 missing-handoff floor),
    [ADR-0034](../adr/ADR-0034-b1-handoff-nudge.md) (B1),
    [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) (the handoff pin; Part A
    amends how its section renders, not how it is selected) and
    [ADR-0077](../adr/ADR-0077-compaction-survival-guard.md) (the resume render re-runs after
    compaction).
  - [ADR-0013](../adr/ADR-0013-no-hard-native-dep.md): degrade to deterministic behaviour,
    take no hard dependency.
  - [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) and
    [ADR-0051](../adr/ADR-0051-delivery-honesty.md): the L4 contract and the content
    assertion it must use.
  - v3 PRD Ruling 5 (brain `8b2aefd11171`): decision models stay an optional seam, **gated on
    the decision-model survey's §10 calibration spike.**
- **Evidence:**
  - brain `68ea8f1db58d` (a squash merge makes its own handoff stale) and `583374f75808` (a
    topical `handoff` tag hijacks the pin). Both were found by the round-1 review and
    reproduced on 2026-10-20.
  - brain `a91f82e76700` (the first B3 count; its session denominator is corrected below),
    `4f5077d1b89b` (the hand-labelled use-case measurement) and `c5dd75a6661e` (a
    correction).
  - brain `fc07da198bfa`: what the native `type:"prompt"` Stop hook can and cannot see.
  - brain `aa294b2708c4`: a decision model can never be a Brake.
  - the probe kit in
    [`docs/research/probes/stop-nudge-2026-10-19/`](../research/probes/stop-nudge-2026-10-19/);
  - the decision-model survey,
    [`docs/research/decision-models-2026-10.md`](../research/decision-models-2026-10.md)
    §6.3, §9 and §10.

## Context

### What the nudge does today

`decideStop` (`src/stop-reminder.ts`) has three nudges:

| Nudge | Fires when | Governed by |
|---|---|---|
| decision | uncommitted `src/` or `docs/` changes and no `decision` entry since HEAD | ADR-0027 |
| handoff (B1) | the same, plus at least 3 new entries and no `handoff`/`next` entry | ADR-0034 |
| stale-handoff (B3) | `handoffIsStale`: the tree at HEAD differs, outside the brain, from the commit nearest the pinned handoff's `updated` time | **nothing** |

Each repeats at most once every `NUDGE_COOLDOWN_TURNS = 10` turns (operator ruling
2026-07-31).

### Which nudge actually fires

Re-run 2026-10-20 with the probe kit, restricted to this repo's real session directory
(`~/.claude-cldp/projects/-Users-jasonviloria-GitHub-vfkb/`). **The first count's "104
sessions" also matched about 85 sandbox and probe sessions,** whose directory names contain
`vfkb`; the fires themselves all come from real sessions.

| | Count |
|---|---|
| Real repo sessions with prompts | 19 |
| B1 handoff fires | **0** |
| decision fires | 1 |
| **B3 stale-handoff fires** | **24, in 11 sessions** |
| … in 6 interactive operator sessions | 19 |
| … in 5 ADR-0052 review-gate sessions (4 single-prompt, 1 multi-round) | 5 |

B3 is the nudge the operator experiences as "fires all the time". It fired on the first turn
of the session that wrote this RFC, before any work had happened.

### Why it fires: three causes, mixed together

1. **A squash merge makes its own handoff stale.** This is a deterministic false positive,
   found by the round-1 review and reproduced on 2026-10-20 (brain `68ea8f1db58d`).
   `handoffIsStale` picks its anchor with `git rev-list -1 --before=<pin.updated> HEAD`, which
   uses **committer date**. This repo squash-merges. A squash commit is dated **after** the
   handoff it carries, and it also contains the PR's non-brain changes. So the very merge that
   lands a correct, end-of-session handoff makes that handoff "stale".
   - At squash merges `8114d76`, `cf6343a` and `480e5bc`, the only non-brain commit between
     the anchor and the merge is the carrier merge itself, and `git diff --quiet` exits 1.
   - The reviewer reproduced this at 5 merges and counted 12 of the last 60 `main` commits
     with this shape. A rebase does the same, because it rewrites committer dates.
2. **A topical `handoff` tag moves the pin.** `latestHandoff` (ADR-0049) pins the newest
   injectable entry tagged `handoff` or `next`, whatever its type. An entry *about* handoffs
   with that tag becomes the pin, and B3's anchor moves with it (brain `583374f75808`). It
   happened on 2026-10-19, and was repaired in a brain-only PR on 2026-10-20.
3. **Real staleness.** A commit genuinely landed after the handoff, so the pin really is
   behind.

**The split of the 24 fires across these causes is not measured.** Classifying them needs
each session's HEAD at fire time, which the transcripts do not record directly. It could be
reconstructed approximately from record timestamps, `gitBranch` and `main`'s commit dates;
the re-measurement after Part 0 is the cheaper and more reliable answer. So the size of the
problem that a decision model would address (cause 3, mid-session) is **unknown** until Part 0
ships and B3 is measured again.

### What it costs

- **It produces premature handoffs.** The agent complied, writing a handoff before the next
  user prompt, in **18 of the 24 fires**: all 5 in review-gate sessions, and 13 of 19 in
  interactive ones. Only 1 interactive fire was on a session's final turn. In one session
  (`d5948d4c`) the agent says 4 times that it wrote the handoff because "that nudge has no
  end-of-session fallback". That clause is in B3's own reminder text.
  *(Counts re-verified 2026-10-20 with a fixed probe script. The first run matched only
  `--tags`, so it missed CLI writes using `--tag` and reported 14 acted, 10 declined.)*
- **It makes reviewers write handoffs.** In all 5 review-gate sessions (one prompt each,
  launched to review a PR), B3 fired and the reviewer wrote a `HANDOFF` fact. Being the newest
  handoff-tagged entry, such a fact becomes the pin for the next session that reads that
  brain, displacing the operator's own handoff.
- **It feeds a loop.** A mid-session handoff goes stale at the next merge, or by cause 1, at
  its own merge, which re-arms B3. Sessions with 4–6 handoff writes show it (`d5948d4c`:
  5 fires, 5 writes; `edf377bb`: 4 fires, 7 writes).

### B3 has no floor

B1 has ADR-0033's SessionEnd fallback underneath it. A *stale* pin has nothing. That is a
structural fact about `stop-reminder.ts` and `session-end.ts`. So declining or suppressing B3
rests entirely on the agent remembering to write a handoff later. Session `61f0e751` declined
B3 ("I'll record a fresh handoff before the session ends"). It was still running at
2026-10-20 08:52Z, so whether it keeps the promise was open when this was written.

One partial exception: on a topic branch with uncommitted brain entries, ADR-0033's B2
auto-handoff becomes the new pin and so clears staleness. It does nothing on a clean tree or
on `main`.

### Why a SessionEnd write cannot be the floor

`runSessionEnd` (`src/session-end.ts`) returns early when the brain file is clean (step 2), and
it never commits on the default branch (step 3). The defining B3 case is the opposite of a
dirty topic branch: the PR has merged and the checkout is back on `main`, clean. Sessions do
reach that state (`61f0e751`, turn 3: "Both repos are on `main` with nothing uncommitted").
A fallback written at SessionEnd would miss exactly that case. If it wrote anyway, it would
leave an uncommitted line in the main checkout's brain. Two concurrent sessions hit that
collision on 2026-10-19: one session's `kb_add` writes landed in the other's working copy on
`main`, and were carried over by hand.

## Decision (proposed)

Four parts, in order. **Parts 0, 1 and A are deterministic and need no model.** Part B is
contingent on what they leave behind.

### Part 0 — count only the commits that came after the pin, never the one that carries it

**This text was rewritten from a prototype, not argued from first principles.** Three review
rounds each found that the previous anchor rule broke a case the round before had fixed. So
the rule below was chosen by running four candidates over 18 sandbox cases and keeping the one
whose observed answers match. The script is
[`anchor-proto.sh`](../research/probes/stop-nudge-2026-10-19/rfc043-review/sandbox/anchor-proto.sh)
and its saved output is `anchor-proto.out`, next to it. The table is in
[the review README](../research/probes/stop-nudge-2026-10-19/rfc043-review/README.md#part-0-prototype-2026-10-20).

**The rule.** Inputs are the pin `p` (selected as below), its `updated` time `u`, and
`handoffIsStale`'s existing pathspec rules for in-tree, root and outside-tree brains.

1. **Select the pin with `latestHandoff`** (`src/engine.ts`, ADR-0049) over the materialized
   (last-write-wins) entry set. B3's own `newestHandoffTimestamp` reads raw lines today, so an
   old `handoff`-tagged version of an entry that has since been retagged can still win there,
   while the engine pins a different entry (R3-M3). This was reproduced on a three-line brain:
   B3's scan picks `HIJACK@10:00`, which has been retagged to `handoff-topic` since; the engine
   pins `REALPIN@09:00`. After Part 0, B3, Part A and the rendered pin use **one selector**.
2. **First-parent timestamp anchor:**
   `T = git rev-list -1 --first-parent --before=<u> HEAD`. This may be empty, meaning the pin
   predates all history. `--first-parent` keeps `T` on HEAD's own chain: without it, a
   second-parent commit can be chosen. That commit is incomparable with everything on the
   first-parent chain (R3-M1), and listing from it shows main commits made before the pin
   (R3-M2).
3. **Carrier `C`, if the pin's current version is committed at HEAD.** That requires
   `git show HEAD:<entries path>` to contain a line with `p.id` **and** `p.updated`. Then `C` is
   the first commit on first-parent history that added that version:
   `git log --first-parent --reverse --format=%H -G'"id":"<id>".*"updated":"<updated>"' HEAD -- <entries path>`,
   first result, with `<id>` and `<updated>` regex-escaped (`.` is a metacharacter in `-G`).
   Entries serialize `id` first and `updated` last (534/534 lines checked), so one line
   matches both. A writer with another key order gets no match, which means there is no
   carrier. In every other case there is no carrier: the pin is uncommitted, the brain is
   outside the tree, HEAD holds an older version, or the lookup fails.
4. **Candidates:** `S = git log --first-parent --format=%H [T..]HEAD -- <pathspec>`. These are
   the first-parent commits after `T` that touch non-brain paths. `--first-parent` with a
   pathspec does list a `--no-ff` merge whose changes come from its second parent
   (prototype cases 5 and 6).
5. **Drop from `S`:**
   - **the carrier itself.** It contains the pin, so the handoff was written knowing its
     content, apart from the disclosed loss below;
   - **any commit that is an ancestor of `C` and whose *author* date is at or before `u`.**
     That is pre-pin work which a rebase re-dated: a rebase rewrites committer dates and keeps
     author dates. Dates are compared as **instants** (`%at` epoch seconds against `u`
     parsed), never as strings: this operator's commits carry `+03:00` offsets.
     The converse does not hold: an old author date does not prove pre-pin work (see the
     amend/fixup disclosure below).
6. **The pin is stale iff `S` is non-empty.** Part A lists exactly `S`.

**What the carrier does, and does not do.** Rounds 1–2 used the carrier to **move** the anchor
forward ("the later of carrier and timestamp"). That silences a pin whose own session went on
to commit code before committing the brain, which is the SessionEnd default on topic branches
(R3-B1; prototype case 7: r2 says quiet, the expected answer is stale). Here the carrier is
only **excluded**. Commits between `T` and `C` still count unless rule 5 identifies them as
rebased pre-pin work.

**Observed (git 2.50.1), summarised; the full table is in the README:**

| Case | Expected | today | r2 (RFC @5d4c2e5) | A (round-3 proposal) | **Part 0 (A + author-date rule)** |
|---|---|---|---|---|---|
| squash carries pin (cause 1) | quiet | STALE | quiet | quiet | **quiet** |
| squash, then another PR | STALE {#2} | STALE | STALE | STALE | **STALE {#2}** |
| committed pin, then a true merge (R3-M1) | STALE {M} | STALE | *undefined* | STALE {M} | **STALE {M}** |
| uncommitted pin, true merge after (R3-M2) | STALE {M} | STALE | STALE {M, P (pre-pin)} | STALE {M} | **STALE {M}** |
| handoff → code → brain commit (R3-B1) | STALE {K} | STALE | **quiet** | STALE {K} | **STALE {K}** |
| rebase onto a main that moved after the pin | STALE {M1} | STALE | **quiet** | STALE {A1, M1} | **STALE {M1}** |
| force-rebase, no upstream change | quiet | STALE | quiet | **STALE {A1}** | **quiet** |
| pre-pin-authored PR rebase-merged after the pin, below `C` | STALE {O} | STALE | quiet | STALE {O} | **quiet — the residual miss** |

The other 10 cases give the expected answer under all three new rules: no-ff carrier,
retag before and after code, uncommitted pin with and without later code, outside-tree brain
with and without later code, root brain with and without later code, and handoff → code →
brain → squash. Today's rule gets 9 of them right; it flags the last one, which is cause 1.
**Round 3's proposal (A) would have been the fourth rule in a row to break a case.** A rebase
re-dates pre-pin work, so A lists that work as new. It fires on a rebase that changed nothing
upstream, and it pads the list of one that did.

What Part 0 still gets wrong, disclosed:
- **Code inside the carrier.** Whatever commit carries the pin hides the non-brain work it
  also carries. Every rule except today's makes this trade, and it is inherent to excluding
  the carrier. That covers:
  - a squash of a PR whose handoff was written early: the later code in the PR is not
    flagged on `main`;
  - **a single `git add -A` commit holding both post-handoff code and the brain**, on the
    topic branch too (round 4, N1: quiet, where today's rule flags it). This happened in 0 of
    64 topic-branch brain commits in this repo, because SessionEnd commits the brain alone,
    but a consumer that commits everything together will hit it;
  - a merge of `main` into the topic branch, or an octopus merge, that carries the pin: other
    PRs' post-pin work inside that merge is not listed (round 4, N6 and N7).
  When the brain is committed separately after the code, which is the SessionEnd default, the
  code **is** flagged (prototype case 7).
- **Amend, fixup and back-dated commits** (round 4, N2–N4). An amend or a `--fixup` that
  autosquash folds into a pre-pin commit keeps the pre-pin author date while adding post-pin
  content, and so does a commit back-dated with `--date`. Rule 5 drops such a commit when it
  sits below the carrier, so that post-pin work goes unflagged (quiet, where today's rule
  flags it). This is new with rule 5 and fails toward silence. It is the price of removing
  the rebase false positive: no git field records "authored before the handoff was
  written".
- **No-carrier rebases still fire** (round 4, N5 and N5b). Rule 5 needs a carrier, so with an
  uncommitted pin (a mid-session handoff, then a rebase before pushing) or an outside-tree
  brain (which never has a carrier), a rebase lists the re-dated pre-pin work as new, and a
  rebase that changed nothing upstream fires. This matches today's rule, so it is not a
  regression. The variant that closes it is **Q5**.
- **Rebase-merged pre-pin work from another PR** (prototype case 11). Another PR whose commits
  were authored before the pin lands by rebase-merge after the pin, below our carrier. After
  a rebase, git cannot distinguish "the handoff writer's own rebased work" from "someone
  else's older work that landed later". Part 0 chooses the reading that removes the frequent
  false positive (rebasing your own branch) and accepts this rarer false negative. It fails
  toward silence, which is B3's existing posture. A merge-commit landing of that other PR
  **is** flagged, because the merge carries the merge-time author date. A squash landing is
  flagged when the squash's author date is the merge time. That is git's own default for
  `merge --squash`, and it is **observed for GitHub on this repo**: author date equals
  committer date on 300 of 300 first-parent `main` commits (round 4, re-checked 2026-10-20).
  Case 9 depends on this as well. Other hosts are UNVERIFIED and need a Tier-0 probe before
  the build relies on them.
- **Boolean semantics change slightly.** Today B3 asks "do the trees differ?" Part 0 asks
  "did any later first-parent commit touch non-brain paths?" These diverge only when later
  commits net to zero, for example a change and its revert. Part 0 flags that and today's rule
  does not. This is accepted: the handoff predates both commits.
- **Clock skew** between the machine that wrote `updated` and the committer dates still
  affects `T`, exactly as today.

**Failure posture is unchanged.** `handoffIsStale` fails toward **silence** ("fail-open (don't
nag)", `src/stop-reminder.ts`); only the cooldown fails toward reminding. Each new step that
fails degrades to a defined case. A failed carrier lookup means no carrier: rule 5 is
skipped and the squash case is flagged exactly as today. That is today's false positive, not
a new failure mode. A failed `log` for `S` means not stale. A failed `merge-base` or an
unreadable author date **drops** that commit from `S`, toward silence like the rest.
**Shallow clones** are mostly benign. `T` is empty only when the pin predates every visible
commit, and those commits really are later than the pin. **One exception:** at the shallow
boundary, `-G` sees the grafted root as adding the whole file, so the boundary commit becomes
the carrier even when the pin was added below it, and its own work is excluded (round 4,
`--depth 2`: it lists only the second of two post-pin commits). This is rare in interactive
checkouts and fails toward silence; it is disclosed and not specially handled.

**Cost.** Up to one `git show`, one `git log -G` over the brain file's history (about 0.12 s on
this repo, 188 first-parent brain commits, measured in round 2), one `git log` for `S`, and,
only when there is a carrier, one `merge-base --is-ancestor` plus one author date per member of
`S`. This runs on every Stop where a pin exists. **The build caches the result per (pin id,
`updated`, HEAD)** in the gitignored `.vfkb/.sessions/` record. Part A shares that cache (see
its Cost paragraph for pi).

**Then re-measure.** After Part 0 ships, count B3 fires again over at least 10 interactive
sessions. That number, not the 24 above, decides Part B (below).

### Part 1 — stop B3's reminder from demanding an immediate handoff

B3's reminder ends: *"unlike the other nudges, this one has no SessionEnd fallback for a
STALE … pin, so a fresh handoff/next entry must be recorded before the session ends."* Agents
quote that clause when they write a premature handoff. Once Part A exists, the clause is no
longer true. **Reword it in the same change as Part A:** say what moved, say that the next
session will see the same list, and ask for a handoff only if the agent is wrapping up. It is
the cheapest experiment in this RFC, and the re-measurement after Part 0 will show its effect.

### Part A — the stale-pin floor: annotate the pin where it is rendered

**Where.** In the **shared** resume render, `renderContextBundle` (`src/engine.ts:544`), which
renders `## Last handoff`. That function is behind `renderResume`, and so behind every face:
the Claude Code SessionStart hook, `kb_resume` through `resumePayload` (`src/heal.ts:170`),
and pi (`src/pi-extension.ts:85`). Computing it in one face only would recreate the #205
divergence between faces.

**What.** When Part 0 says the pin is stale, append a neutral line under the pinned handoff,
listing **exactly Part 0's set `S`** (first-parent, after the timestamp anchor, non-brain,
minus the carrier and rebased pre-pin work), newest first, as `%h %s`. B3 and the annotation
therefore cannot disagree: they come from one computation (prototype rows above, "Part 0"
column).

```
Commits since this handoff was recorded (3):
  b0afd71 fix: capture-fallback hint advertised --tags, which add rejects (#355)
  …
```

- **Neutral wording, with no call to action.** The render also re-runs after every compaction
  (ADR-0077). An imperative such as "may be out of date — write a handoff" would recreate the
  premature-handoff trigger through a second channel.
- **Bounded in characters, with its own reserved slice.** Real pins are long: 17 of the last
  20 handoff-tagged entries in this brain exceed 2,000 characters (range 1,630–7,750). So the
  annotation cannot share leftover room inside `HANDOFF_PIN_CAP_CHARS`, which would leave it
  none in most cases. It gets a fixed slice of at most 400 characters. The count line
  (`Commits since this handoff was recorded (N):`) always survives. Then come subjects, each
  **truncated to 100 characters plus "…"** (12 of the last 40 subjects on `main` exceed 100
  characters, measured 2026-10-20, and this branch's `5d4c2e5` is about 300, so untruncated
  lines could leave room for none), as many as fit, then "(+N more)". When an annotation is present, the **pin text** is truncated to
  `HANDOFF_PIN_CAP_CHARS` minus the slice the annotation used, with the existing
  "(truncated — kb_get <id> for the rest)" marker, so the section stays within today's cap.
- **When the pin predates all history,** `T` is empty and Part 0's `[T..]HEAD` lists from
  the root (prototype: the empty-`T` path is the same code). `<empty-tree>..HEAD` is not
  valid `git log` input, so the empty-tree SHA that today's tree diff uses is not reused.
- **Any git failure → no annotation.** That makes the render no worse than today. Like
  B3, the floor fails toward silence, because a wrong annotation would mislead. The two
  share Part 0's anchor code, so a git failure silences both together. That is today's
  posture, not a new gap.
- **The engine never runs git.** The storage seam has no git surface: git-layer consumers
  "stay file-based BY DESIGN … a backend without that property simply doesn't wire them"
  (`src/backend.ts:11-13`). So `renderContextBundle` and `renderResume` take an optional,
  injected `pinStaleness` provider (pin → anchor and commit list, or nothing). It is
  implemented in the git layer next to `handoffIsStale`, sharing Part 0's anchor code, and
  wired once at each shared entry point: `resumePayload` (`src/heal.ts:176`), the
  SessionStart hook (`src/cli.ts:626`), pi (`src/pi-extension.ts:85`) **and the
  `context-block` CLI command** (`src/cli.ts:365`, which calls `renderContextBundle`
  directly), so every face that renders `## Last handoff` stays in parity (#205). Without a
  provider, the render is exactly today's. A non-file backend wires none, and engine unit tests, including the ADR-0077
  compaction-survival test, stay independent of the checkout's git state.

**Why read-only beats a written fallback:**
- It works on a **clean tree** and on **`main`**.
- It writes nothing, so it cannot collide with another session's working copy, dirty `main`,
  or add to the handoff sprawl that PRD R7 counts.
- It is computed **fresh at read time,** so it also covers merges that land between sessions.
- It does not change pin selection under ADR-0049. It changes how the pinned section
  renders, so **the accepting ADR amends ADR-0049** for that.

**This departs from the ruled mechanism.** The ruling names "a SessionEnd fallback for a stale
pin". Part A serves the same purpose by a different mechanism, for the reasons above. **That
substitution is the operator's call (Q1).**

**Cost.** Part 0's computation, at most once per render, when a pin exists. **pi renders on
every prompt**, not once per session: `before_agent_start` calls `renderResume` each time
(`src/pi-extension.ts:81-85`). So the (pin id, `updated`, HEAD) cache from Part 0 is
**required**, not optional. With it, an unchanged HEAD costs one `git rev-parse HEAD` per pi
prompt. Today's `handoffIsStale` already makes three git calls on every Stop.

### Part B — a decision-model observer, contingent

Part B is kept as a design so its shape is reviewed now. **It is built only if both gates
pass:**

1. **The B3 re-measurement after Parts 0, 1 and A** still shows B3 firing mid-session in a
   meaningful share of interactive sessions. The proposed bar is at least one mid-session fire
   per 3 interactive sessions, over at least 10. If Part 0 removes most fires, Part B is not
   built.
2. **Ruling 5's calibration spike** (survey §10): a throwaway script, no production code.
   Label turns from the probe kit's corpus as wrap-up or not, call the candidate model on
   each window, and show that its probabilities separate the two classes better than the
   rule-only baseline below. **Shadow mode is production code** (a hook handler, prompt
   storage, a Decider), so under Ruling 5 it must wait for this spike.

If either gate fails, this RFC's accepting ADR records Part B as **not built**, with the
evidence.

#### Design, if built

**The question:** "is it likely that no more substantive work happens in this session after
this turn?"

**Evaluation order at Stop, for B3 only.** Every branch that cannot complete leads to
today's behaviour:

```
if stop_hook_active                         → allow stop             (unchanged)
trigger = handoffIsStale()                  (Part 0 anchor)
if !trigger                                 → no B3                  (unchanged)
if mode == shadow:
    consult model on every Stop where trigger holds, IGNORING the cooldown;
    log probabilities + facts + what the policy would do + what B3 actually does;
    then run today's decideStop unchanged   → act on nothing
if mode == act:
    if B3 cooling                           → no B3                  (unchanged)
    if background_tasks or session_crons non-empty → defer B3 this turn
    p = decider.decide(window)              (null on ANY error)
    if p == null                            → fire B3                (today's behaviour)
    if policy(p) == fire                    → fire B3, mark nudged
    else                                    → defer, and mark "consulted" so the model
                                              is asked at most once per N turns
```

- **Shadow mode consults outside the cooldown.** Otherwise it would log only the turns where
  B3 fires today, about one per 10-turn window, and final turns inside a cooldown would never
  be logged. That bias would make the switch-to-act gate impossible to measure. **The cost:**
  up to 1.5 s (the timeout) added to every Stop while the pin is stale, in shadow mode.
- **Act mode rate-limits consultations.** A deferred fire does not mark the nudge as fired.
  Without its own "consulted" mark, the model would be called on every Stop for the rest of
  the session.
- **The background-task deferral applies only in act mode.** With no decider configured,
  nothing changes.
- **The cooldown check moves out of the pure `decideStop`** into the shell, so both modes
  can share it. The build PR has to make that split, with unit tests.

**The window, about 2k tokens at most:**
- **The last 3 user prompts,** newest last, each truncated to 600 characters, recorded by a
  new `hook user-prompt-submit` handler that makes no network call and injects nothing.
  **Recorded only when a decider is configured.** With no decider, no prompts are stored.
  The prompt arrives in the payload's `prompt` field (observed on CLI 2.1.292).
- **The tail of the agent's final message,** from the Stop payload's
  `last_assistant_message`, last 1,000 characters (field observed on CLI 2.1.292).
- **Excluded:** hook-injected text including B3's own reminder, system reminders, pasted
  blocks, tool output, diffs, file contents, brain entry text, and the transcript file.
- **Turns Claude Code starts on its own** (task notifications, crons) must be excluded. The
  hooks reference says `UserPromptSubmit` fires for them too, and the observed payload has no
  field saying who sent the prompt. **How to tell them apart in the hook is UNVERIFIED.** The
  transcript does mark them (`promptSource:"system"` on a task-notification turn in
  `dbb5c056`), so the spike can label its corpus from that either way.
- **Secrets:** a window in which `detectSecrets` (`src/secrets.ts`) finds anything is not
  sent; that turn takes today's behaviour.

**The questions,** atomic and phrased positively, because the candidate handles negation
inconsistently:

| Id | Question |
|---|---|
| `close` | In the most recent user message, the user indicates the work is finished or asks to finish up. |
| `more` | The recent user messages ask for further work or name work to do next in this session. |
| `ask` | The assistant's final message ends by asking the user a question or waiting for a decision. |
| `done` | The assistant's final message reports that the requested work is complete. |

**Policy:** fire if `close ≥ T1`, or if `done ≥ T2` and `ask < T3` and `more < T4`. The
thresholds come from calibration, not from guesses.

**The seam:**

```ts
interface Decider {
  /** Probabilities per question id, or null for "no decision" (any failure). */
  decide(window: TurnWindow, questions: Question[]): Promise<Record<string, number> | null>;
}
```

- `NullDecider` is the default and returns `null`.
- `JevDecider` makes one `POST` to `https://api.typesafe.ai/v1/systemone` with `fetch` (no
  SDK, survey §9). The model is pinned to `jev-1.13.0`, the key comes from
  `TYPESAFE_API_KEY`, and the timeout is 1.5 s. Any failure returns `null`.
- `ReplayDecider` reads recorded responses for tests and the L4.
- **Enablement must be per project, not per shell.** An environment variable set in a shell
  profile would enable it for every project. The build reads the setting from the project,
  for example the project's `.claude/settings.json` `env` block, which ships with the repo.
  This is a build-time detail with a binding requirement.

**The rule-only baseline.** A keyword classifier over the same window ("wrap up", "that's
all", "handoff", "commit and push", a final message ending in a question mark) runs in the
spike and in shadow mode. **If it performs as well as the model, ship the rules instead:** no
egress, no key, fully deterministic.

**The gate for switching from shadow to act** (Q3): at least 100 consulted Stops; on the
labelled log the policy suppresses at least half the mid-session B3 fires, misses at most
1 in 10 final-turn opportunities, and beats the rule-only baseline. **Today's corpus has about
1 genuine interactive final-turn B3 fire,** so this gate cannot be evaluated until shadow mode
has collected data.

**Why Jev is the leading candidate.** The text the agent sees is vfkb's own fixed reminder, so
the model only answers yes or no. That favours a model that returns a probability over a
generative judge.

| | Jev | Native `type:"prompt"` Stop hook | Rules only |
|---|---|---|---|
| Returns | a probability per question, so thresholds can be tuned | ok/blocked plus a reason, no threshold | yes/no |
| Can see the user's prompt | yes, vfkb builds the window | **no.** `$ARGUMENTS` is the Stop payload only (observed, `fc07da198bfa`) | yes |
| Loop guard | vfkb's | **none unless its prompt handles one.** It re-blocked 10 times on "Say hi" (observed) | vfkb's |
| Latency | survey: vendor 70–500 ms, p50 about 0.21 s on real traffic | 1,979 ms, one timed pass (observed) | about 0 |
| Cost per consultation | about $0.0001 (≈2k tokens at $0.042/M) | about 2.9k Haiku input tokens (observed) | 0 |
| Data egress | yes, to TypeSafe | stays with Anthropic | none |

**Known limits of Jev, from the survey's §2.3, each with its handling here:**
- **Accuracy:** about 72.5% multi-task, and 75.3–84% on Banking77 intent classification.
  Handled by calibrating on vfkb's own data, with the rule-only baseline as a bar it must
  clear.
- **Confidence:** `noul` answers tend to be underconfident. Handled with per-question
  thresholds, not 0.5.
- **Not deterministic:** 15 distinct answer sets in 50 identical calls, with probability
  shifts up to 0.13. It only times a nudge, and Part A covers a miss.
- **Injectable by its input:** the agent's final message is in the window, so the agent
  could talk B3 quiet. The cost is one late handoff, which Part A covers: a relevance cost,
  not a correctness one, the only placement the survey's §4 allows.
- **Not a Brake.** The deterministic trigger stays. Every Brake listed in `aa294b2708c4`
  stays out of scope.

### Follow-ons — listed, not built

| Item | Evidence | Status |
|---|---|---|
| **Pin hygiene:** stop topical tags hijacking the pin, for example pin only `type: fact`, or require an explicit pin tag | happened on 2026-10-19 (`583374f75808`) | **Follow-on, high value.** It amends ADR-0049's selection, so it needs its own RFC |
| **Reviewer sessions writing handoffs:** B3 in one-shot review sessions makes reviewers write handoffs that displace the operator's pin | 5 fires, 5 `HANDOFF` writes | Follow-on. The observed Stop payload has no field that identifies a headless session (UNVERIFIED whether one exists) |
| Rulings stated in the user's prompt are captured as `decision` entries | 17 rulings: 11 recorded within 2 turns, 4 only in a fact, handoff or harness memory, 2 missed (`4f5077d1b89b`) | Follow-on to Part B |
| Promises the agent makes are followed through | about 6 promises; the operator had to poll 3 times; a 4th is still open | Needs a better question first |
| The decision nudge (survey §6.3 as written), B1, tool-output capture (§6.2) | B1 fired 0 times; decision once | Follow-on |
| Work mentioned in passing | 2 instances, both captured | **Dropped** |

## Alternatives considered

- **Lengthen the cooldown.** It changes how often B3 nags, not why. Rejected.
- **Delete B3.** With Parts 0 and A in place, this becomes a real option. The re-measurement
  will show whether B3 still earns its place.
- **A SessionEnd write for the stale-pin floor.** It misses clean trees and `main`, and it can
  dirty another session's working copy. Q1.
- **Start with a decision model.** Rejected: cause 1 is a deterministic bug, and a model
  would have learned to suppress a false positive that code can remove.
- **The native `type:"prompt"` hook.** It cannot see the user's prompt. Rejected for this
  question.
- **An agent hook (`type:"agent"`) that reads the transcript, or parsing the transcript at
  Stop.** Experimental or undocumented surfaces. Rejected.
- **The `@typesafe-ai/sdk` package.** One `POST` does not need a dependency (survey §9).

## Consequences

- **Parts 0 and 1 change behaviour for every consumer** at the next plugin release: B3 will
  fire less, and its text changes. Release notes must say so. The plugin release flow
  carries ADR-0051's delivery disclosure as usual.
- **Part A changes the resume render for every face** (Claude Code, `kb_resume`, pi). It
  costs git calls at session start when a pin exists.
- **Part B, if built, is cross-repo.** The `UserPromptSubmit` hook entry lives in
  [vilosource/vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin)'s
  `hooks.json` and must pass the R6 `claude plugin validate --strict` gate. v3 R1 also plans
  a `UserPromptSubmit` hook; the two should share one entry and one handler.
- **Part B's data egress (opt-in only):** with Jev enabled, the last 3 user prompts and the
  final-message tail go to TypeSafe, a new third-party processor, on turns where B3's
  trigger holds. Off by default and per project. This must carry into the ADR and the
  plugin README.
- **Ruling 5 holds.** No production decision-model code ships before the calibration spike.
- **B3 gains governance.** The accepting ADR is B3's first ADR. Its "built, NOT yet verified"
  status ends only with the Part 0 L4 below.

## Definition of Done

Each part that changes agent-facing behaviour needs an agent-driven L4 under ADR-0050/0051:
committed, reproducible, DEMONSTRATED at 2 of 3 or better, with an arm that can fail, and
predicates that are content assertions, never exit codes or absences. In each scenario the
vfkb plugin is disabled per sandbox and the scenario asserts that it stayed off, because it
is enabled at user scope on this machine (brain `fb712c13f39e`).

- **Part 0 — `scenarios/stale-handoff-anchor.mjs`.** A sandbox repo where a topic branch
  carrying a handoff is squash-merged to `main`, then the agent runs a scripted turn.
  - **Squash arm:** the transcript shows the Stop hook **ran** (a `hook_success` record for
    the Stop command), and its output does not contain the B3 text.
  - **Can-fail arm:** add a later non-brain commit. The same hook output contains the B3
    text.
  - **Unit tests port every row of the prototype table** (`anchor-proto.sh`, 18 cases)
    as fixtures with the same expected answers, including the expected **set** for Part A:
    squash; squash then another PR; `--no-ff` carrier; retagged pin before and after code;
    uncommitted pin with and without later code; committed pin then a true merge (R3-M1);
    uncommitted pin then a true merge, listing only the merge (R3-M2); handoff → code → brain
    commit, which must be stale (R3-B1); the same then squashed; outside-tree and root brains,
    each with and without later code; rebase onto a moved main, listing only the upstream
    commit; force-rebase with no upstream change, which must be quiet; and the rebase-merged
    pre-pin PR, asserted **quiet** as the disclosed residual miss, so a future change to it is
    a deliberate one.
  - Plus: a failed lookup at each step degrades to its defined case; a regex metacharacter in
    the id or `updated` is escaped; and **pin selection (R3-M3)**: an old `handoff`-tagged line
    plus a newer version of the same id without the tag must not be the pin, so B3 and
    `latestHandoff` pick the same entry.
  - Plus round 4's cases (`rfc043-review/sandbox/r4/`) as fixtures, each with its disclosed
    answer: a mixed code-and-brain commit (N1); amend, back-date and fixup (N2–N4);
    no-carrier rebases (N5, N5b, whose answer depends on Q5); an octopus merge and a
    merge into the topic branch that carry the pin (N6, N7); and the shallow boundary.
- **Part 1** rides Part 0's scenario: the can-fail arm also asserts the new reminder text.
- **Part A — `scenarios/stale-pin-floor.mjs`.** Seed a pinned handoff, then a later non-brain
  commit whose subject carries a sentinel. Run the agent **with no shell or git tools**
  (`--tools` limited to the vfkb MCP tools), so it can learn the commit only from the render.
  - **Treatment:** the SessionStart hook output contains the sentinel, and the agent names
    it.
  - **Contrast,** annotation disabled: the agent cannot name it.
  - **Squash negative arm:** a squash-carried pin. The SessionStart hook output **contains**
    `## Last handoff` and the pin's own sentinel (proving the render ran and pinned it), and
    does not contain "Commits since this handoff".
- **Part B, only if built.** It ships in shadow mode first, so the first L4 proves shadow
  mode. With `ReplayDecider` fixtures, a consulted Stop must produce a positive
  `decider.jsonl` record with the four probabilities and the would-have action, while B3's
  output is unchanged from `NullDecider`. Act mode stays "built, NOT yet verified" until
  its own L4 exists. That L4 needs a wrap-up arm with a contrast, where `NullDecider` fires
  mid-session and the decider does not, each asserted by a positive log record. Replay
  fixtures prove the plumbing and the policy, **not** the model's judgment; that evidence
  comes from the spike and the shadow log, recorded separately and never as a gate input.

## Open questions (operator)

1. **The floor's mechanism.** Part A's read-only annotation in the shared render
   (recommended), or the SessionEnd write the ruling names?
2. **Part B's gate.** Is "at least one mid-session B3 fire per 3 interactive sessions, over at
   least 10, after Part 0" the right bar for building Part B at all?
3. **The gate for switching to act,** if Part B is built: the thresholds above?
4. **Sequencing,** which departs from the ruling's emphasis: Parts 0, 1 and A first, then
   re-measure, and Part B only if both gates pass. This puts the decision model behind a
   deterministic fix that may make it unnecessary.
5. **Rule 5 without a carrier (round 4's B′).** When there is no carrier (an uncommitted pin
   or an outside-tree brain), should rule 5 also drop any commit whose author date is at or
   before `u`? Round 4 ran it over all 33 cases. It changes no answer on the 18 prototype
   cases, fixes both no-carrier rebase cases (N5, N5b), and extends the amend/fixup silence to
   the no-carrier path. Recommended: adopt it, because a mid-session handoff followed by a
   rebase is a normal workflow here. Disclosure alone is also acceptable.