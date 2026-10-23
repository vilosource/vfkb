---
type: RFC
title: "RFC-046: Background curation — a deterministic rule archives clear-cut old handoffs, an agent proposes the rest, one briefing line alerts the operator (amends ADR-0082 §6)"
description: "Operator direction 2026-10-23 (brain f119b9942af4): curation should run in the background, by rules, with clear-cut cases archived automatically and only uncertain cases surfaced. A probe on main found 122 live handoff/next facts beside the pin. Most say 'supersedes X', but often with qualifiers ('on the #330 question only', 'X's NEXT stands'), so the text cannot drive a rule without judgment. This RFC proposes: (1) one deterministic rule, keyed on structure not prose — a handoff-shaped fact at least 14 days older than the pin, with at least 3 newer live handoff-shaped facts, and, if it carries a topic tag, at least one newer handoff sharing that tag — archived at SessionEnd on topic branches, only when the session is committing its own brain changes anyway, after the fallback-handoff decision; 50 of the 122 today; (2) a sticky `curation-kept` exemption that survives cross-branch merges; (3) everything else goes to a curator agent that proposes, never archives; (4) one line in the session-start briefing reports what was archived and what awaits the operator; (5) declined proposals are never re-raised. It replaces ADR-0082 §6's operator-edited list, and relaxes ADR-0082's propose-only rule for the rule's cases only."
status: "Proposed"
timestamp: 2026-10-23
---

# RFC-046: Background curation

- **Status:** Proposed
- **Date:** 2026-10-23
- **Deciders:** operator + Claude
- **Origin:** operator direction 2026-10-23, recorded (paraphrased) as brain decision
  `f119b9942af4`. In the operator's words: "ultimately I would like this to be done
  automatically in the background, we could have an agent with rules on how it should do the
  archive. We can start with clear cut cases being done automatically and new cases are the
  only one's that the agent should alert about". Also the standing ruling that the operator
  does not hand-label (brain `00cff7e60454`).
  - **One departure from that wording, stated:** the operator pictured an agent applying the
    rules. Here the clear-cut tier is plain engine code with no model (§2). A written rule
    applied by code is predictable, testable and free to run. The agent keeps the part that
    needs judgment (§4).
- **Amends:** [ADR-0082](../adr/ADR-0082-propose-only-curation.md) §6, "the backlog is
  archived from the operator's edited list". It also relaxes ADR-0082's propose-only rule,
  **for the §2 rule's cases only**, by the operator's explicit direction above.
- **Relates:**
  - [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md): the curator's delta-only
    operations and the never-rewrite Brake. Both still hold: archiving changes a zone and a
    tag, never text.
  - [ADR-0033](../adr/ADR-0033-session-end-continuity.md): the SessionEnd hook that writes
    the B2 fallback handoff and auto-commits the brain. §3 fixes where the rule runs relative
    to both.
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the session-start
    briefing, where §5's line goes.
  - [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md): merge=union, and ADR-0082 §4's
    named cross-clone un-archive hazard. §2's sticky exemption addresses its mirror image,
    which an automatic writer makes worse.
- **Evidence:** [`docs/v3/research/probes/background-curation-2026-10-23/`](../v3/research/probes/background-curation-2026-10-23/).
  `probe.mjs` and `stream.mjs` call the real engine's `latestHandoff`, `isInjectable` and
  `isPinCandidate`, on `main` at `97e796e` (pin `e622618cba19`). The outputs are in
  `output.txt` and `output-stream.txt`. The probe README gives the reproduction. The numbers
  shift on later brains; for example, this PR's own handoff becomes the pin.

## Context

ADR-0082 made new handoffs retire their predecessor on an explicit yes. It left the existing
pile to an operator-edited list. The operator has since said they will not edit such a list,
and that the pile recurs: any session that skips the yes adds one more.

The probe found:

1. **122 live handoff/next facts besides the pin.** 91 are handoff-shaped: they open
   `HANDOFF`, `SESSION HANDOFF` or `RESUME`, the existing `HANDOFF_SHAPE` in
   `src/curator.ts`. The other 31 are topical status facts ("SHIPPED …", "CLOSED OUT …",
   "NEXT-SESSION TASK …"), 25 of them tagged `status`.
2. **Most handoffs name what they replace, but not cleanly.** 56 of the 91 are named by id in
   a newer live entry, usually as "supersedes X". The wording is often partial:
   - "supersedes 023309109476 on the #330 question only";
   - "Supersedes be601e467329 / 6d04b01e15e9 on 'what happened last', NOT …";
   - "SUPERSEDES 78bbdd0ef2a7 — everything there still stands";
   - "Prior handoff 064a17d755b2 remains valid for everything …";
   - "the R7 NEXT of 0eb27512a01c stands".

   Some mentions are not supersession at all ("a zone edit of the oldest handoff
   1488c66658c4 made it the pin"). Reading these takes judgment, so a deterministic rule must
   not parse them.
3. **Parallel streams exist.** On 2026-10-22 two live handoffs ran side by side, one for the
   Jev stream and one for R7. Each named the other's NEXT as standing. So "older than the
   pin" is not the same as "replaced", and a paused stream can go weeks without a newer
   handoff of its own.
4. **Age and count separate most of the pile, and topic tags hold back the rest.**
   - 72 of the 91 shaped handoffs are at least 14 days older than the pin, and each has at
     least 3 newer live shaped handoffs.
   - Of those 72, 18 carry a topic tag that no newer handoff shares, such as `track-7`, `p12`
     or `rfc-041`. The same-stream guard (§2) holds those back. Broad kind-of-work tags such
     as `rfc`, `review` or `plugin` do not count as a stream (round-2 review: matching on them
     cleared entries from unrelated streams).
   - That leaves 54. Checking newest-first (§2, "Evaluation order") holds back 4 more,
     because a handoff archived in the same run no longer clears an older one. That leaves
     **50**.
   - 25 of the 50 carry no topic tag at all, so the guard cannot see their stream.
   - The generic set was drawn from this brain's own tags. It is not purely conservative:
     an entry whose only extra tag is now generic (e.g. `144aead6fa73 [public]`, genuinely
     superseded by `5af9df8be1a0`) counts as untagged and loses the guard. Cross-cutting ADR
     tags (`adr-0070`) still clear entries from other streams. A consumer project's own broad
     tags (`frontend`, `docs`, `bug`) are not in the set.
   - Qualified handoffs (item 2) occur at every age. The 14-day window does not avoid them.
     It relies on the newer handoffs that carried their content forward.
   - A 7-day window would add one entry, `d5667ac2c52c`, then 9.4 days old. The difference is
     small; 14 days is the more conservative of two nearly equal choices.

## Proposal

### 1. Two tiers: a rule archives, an agent proposes

- **Tier 1, the rule (§2, §3):** deterministic engine code with no model. It archives
  automatically, and only the cases it is sure of.
- **Tier 2, the curator agent (§4):** looks at everything else in scope and **proposes**.
  It never archives. The operator answers proposals in a session.
- A kind of proposal the operator keeps accepting is the evidence for a new Tier-1 rule.
  New rules arrive by RFC, not by the agent.

### 2. Tier 1: the old-handoff rule

A live fact X is archived by the rule when **all** of these hold:
1. X is a pin candidate (a `type: fact` tagged `handoff` or `next`, ADR-0082 §1) and not the
   pin.
2. X is **handoff-shaped** (`HANDOFF_SHAPE`), so topical status facts are never touched.
3. X's `created` is **at least 14 days** before the pin's `created`.
4. **At least 3 live, handoff-shaped pin candidates were created after X.** The pin counts
   only if it is itself shaped, and archived entries never count.
5. **The same-stream guard:** if X carries any topic tag, then at least one of those newer
   shaped handoffs shares one of X's topic tags. A topic tag is any tag outside the generic
   set, which has two parts:
   - lifecycle words: `handoff`, `next`, `status`, `auto`, `verified`, `v2`, `v3`;
   - kind-of-work words that span streams: `review`, `escalation`, `rfc`, `adr`, `plugin`,
     `l4`, `guard`, `release`, `tooling`, `cross-repo`, `distribution`, `roadmap`, `public`.
6. **No line of X's id**, archived or not, carries `curation-kept`. See "Sticky exemption"
   below.

The rule reads `created`, tags and the shape test. It never reads what the text says about
other entries, for the reason in Context item 2.

**Evaluation order: newest first.** The rule checks candidates from newest to oldest
`created`, and an entry it archives stops counting as live for the older entries checked
after it. So a handoff archived in this run never clears an older one under conditions 4
and 5. The order is fixed, so the result is deterministic.
- **Rejected: one snapshot taken before the run.** It archives 54 rather than 50. The 4 extra
  (`6ad082a76acf`, `fe25618937e4`, `7be0d80841de`, `023309109476`) were cleared only by a
  handoff that the same run archived.
- After a snapshot run, 10 archived tagged entries would have no live newer handoff sharing a
  tag, which breaks the guard's premise. Newest-first can only hold back more.

**What it writes.** The existing archive delta (zone `archive`), plus the tag
`auto-archived:old-handoff@<YYYY-MM-DD>`. Text is untouched (ADR-0021).

**Effect, stated fully.** An archived entry leaves the injection. It also drops out of
`kb_search` and query results unless the caller passes `includeStale`
(`src/read.ts:125`). It stays in `entries.jsonl` and `vfkb curate log` lists it.

**Undo.** `vfkb curate restore <id>`. This is new behaviour in `restore`, proposed here:
- For an entry with an `auto-archived:` tag, restore removes that tag and adds
  `curation-kept`.
- For an entry archived by `curate retire` or by hand, restore is unchanged, as ADR-0082 §4
  defines it, so an operator-confirmed retirement does not become permanently exempt.

**Sticky exemption across branches.** Each id resolves to its newest line by `updated`
(`src/storage.ts:147`). Under merge=union, a branch that forked before a restore can
auto-archive the entry later, from its own copy without `curation-kept`, and that copy then
wins the merge. So:
- the rule checks **every raw line** of an id for `curation-kept`, not just the materialized
  one (condition 6);
- **the repair:** the rule looks at the id's materialized line and at its newest line that
  the rule did not write. "Newest" means by `updated`, as `materialize` orders them, never by
  file position, because a union merge orders lines arbitrarily. A line the rule wrote is one
  carrying an `auto-archived:` tag. The repair's own restore line carries none, so a later
  run treats it as an ordinary line. If the materialized line is a rule-written archive, and that newest
  other line is live and carries `curation-kept`, the rule restores the entry and re-adds
  `curation-kept`;
- **the operator's own later archive wins.** If the newest line the rule did not write is an
  archive, for example a later `curate archive` by the operator, the rule leaves it alone.

Each stale branch can cause at most one re-archive and one repair, so this cannot loop.
Between the merge and the next qualifying SessionEnd, the entry is hidden. That window is
stated, not closed.

**Accepted risks, stated:**
- **A handoff that a later one only partly superseded** is archived once it is old enough.
  For example, `e5f8db235235` superseded `6d04b01e15e9` only "on the #330 question", and
  the rule archives `6d04b01e15e9`. After 14 days and 3 newer handoffs, what still matters has usually been
  carried forward or written as its own entry.
- **A paused stream with no topic tag** cannot be told apart from the main stream. After 14
  days and 3 newer handoffs elsewhere, its last handoff is archived. 25 of today's 50 have no
  topic tag. Context item 3's own example is like this: the Jev handoffs `d00e40d78b33` and
  `bfec144852c2` carry only `handoff,next`, so once they are old enough the guard cannot
  protect them. The §5 line reports every archive with its undo. The cheap mitigation is
  tagging handoffs by stream, which the handoff skill could suggest; it is left to the
  build.
- **The guard's protection is one shared topic tag, not proof of the same stream.** A
  handoff tagged `r7,jev` is cleared by any later `r7` handoff.

**Rejected rules:**
- **"Superseded by text":** fails Context item 2.
- **"Older than the pin":** fails Context item 3.
- **No same-stream guard:** it would archive the 18 entries above, including the last
  handoffs of streams no later handoff shares a topic tag with.
- **A guard over every non-lifecycle tag:** broad tags such as `rfc` and `review` cleared
  entries from unrelated streams (round-2 review).

### 3. Where the rule runs

`vfkb curate auto` is a new CLI subcommand. The SessionEnd hook calls it as follows:
- **Only when the session's own brain changes are being committed anyway** (operator ruling
  2026-10-23, brain `ca519225196e`, option A). The test is that the session added at least
  one new id since HEAD. That is the same set the B2 fallback reads once it counts by id
  (below); today's hook counts added lines (`newEntriesSinceHead`, `src/session-end.ts`). A
  session that wrote nothing archives nothing and commits nothing. A session that only
  edited existing entries still commits them, as today, but does not curate. That is
  narrower than "whenever the brain is committed", and it errs safe. So curation never adds a commit of its own to any branch.
  - **Why:** a curation-only commit after a PR's reviewed sha would fail the review gate,
    which strips only review-record commits from the tip (`scripts/review-gate.mjs:89`,
    `candidateShas` at `:274`). It would also add brain commits to code PRs in other
    projects.
  - **Rejected:** committing anyway and teaching the review gate to skip brain-only commits
    (an exception that lets unreviewed brain changes through). Also rejected: archiving at
    session start and leaving the result uncommitted (a dirty brain in every session).
  - **The cost:** curation happens a little less often. Read-only sessions, such as reviews
    and briefings, never curate.
- **On a topic branch only.** On the default branch the hook already refuses to commit. A rule
  that archived there would leave `entries.jsonl` dirty after most sessions and could block a
  `git pull`, so on the default branch the rule does not run.
  - **Consequence, stated:** a project whose sessions all run on its default branch never
    gets Tier 1. Its backlog is never auto-archived, and with ADR-0082 §6's list retired,
    only Tier 2's proposals and the existing manual `curate archive` reach it.
- **After the B2 fallback decision, before the commit.** Today the fallback test reads every
  line added since HEAD (`fresh.some(isHandoff)`, `src/session-end.ts:205`). An archive
  appends a full copy of the entry with its `handoff` tag. If the rule ran first, any
  archive would read as "this session left a handoff" and switch off the fallback. The
  reviewer observed exactly that in a sandbox. Running the rule afterwards keeps the fallback
  decision blind to it.
- **"New entries" means new ids.** The fallback's `fresh` set and the commit message's count
  are computed over ids absent at HEAD, not over added lines. Then an archive line is never
  counted as a new entry wherever the rule runs.
- **One commit.** The archives ride the session's own brain-only commit, whose message adds
  `, <n> curated`.
- It is fail-open, like the rest of SessionEnd.

### 4. Tier 2: the curator agent

A plugin subagent, `vfkb:curator`, beside the existing `vfkb:briefer` and `vfkb:updater`
(vfkb-claude-plugin `plugin/agents/`). Its job is fixed by a checklist, not open judgment:
- **Scope:** live pin candidates that the rule does not archive (today 41 shaped, among them
  the 22 held back by the stream guard and the evaluation order, plus 31 topical), and `vfkb curate stale`'s report.
- **For each, it either proposes archiving with one checkable reason, or says nothing.**
  Admissible reasons:
  - a newer live entry names this one and the agent reads that as full supersession, quoted;
  - it asserts a state the repo now contradicts (e.g. "PR #35 is open" when `gh` shows it
    merged), with the evidence;
  - its NEXT has since been recorded as done, quoting the entry that says so.

  With no such reason, it proposes nothing.
- **A proposal is a tag** on the entry: `curation-proposed:<reason-code>@<date>`. The quoted
  evidence goes in the report (§5). No zone changes.
- **Where and when it runs:** open item 1.

The operator answers proposals in a session:
- **"Yes"** runs `vfkb curate archive`.
- **"No"** runs `vfkb curate keep <id>`, a new subcommand that adds `curation-kept` and clears
  the proposal. The same entry is then never proposed again. That is how "only new cases
  alert".

### 5. The alert: one line in the session-start briefing

The session-start injection gains one line, placed after `## Last handoff`, and **only when
there is something to say**:

> Curation: auto-archived 12 old handoffs in the last 7 days (`vfkb curate log` names them;
> undo with `vfkb curate restore <id>`). 2 proposals need you: `vfkb curate proposals`.

- **The counts come from tags.** The archived count is the number of `auto-archived:…@date`
  tags dated within the last 7 days. The proposal count is the number of live
  `curation-proposed:` tags. The dates live in the committed brain, so every clone reads the
  same line, and no session record is needed.
- **`vfkb curate log` and `vfkb curate proposals`** are read-only reports, like ADR-0082 §6's.
  `log` names each archived entry, its rule and date. `proposals` prints each entry's first
  line with the agent's reason and evidence.
- **Why this channel:** the operator and every agent already read it at the start of every
  session. Email, issues or desktop notifications need new setup and are easier to miss. A
  GitHub-issue mirror can be added later if wanted.
- **Silence is honest:** when nothing was archived in the window and nothing is proposed,
  there is no line.

### 6. The existing backlog

There is no special backlog pass. The first topic-branch SessionEnd after the build runs §2
and archives the qualifying set (50 at `97e796e`). The next session's line reports it. The
curator then proposes from what remains.

ADR-0082 §6's operator-edited list is retired, along with its file
`~/GitHub/vfkb-handoff-backlog-2026-10-23.tsv`.

## Definition of Done (ADR-0029/0050/0051)

- **Structural.** These are unit tests, and each must be observed red under a mutation of the
  code it guards.
  - The rule archives exactly the fixture's qualifying set. It never archives:
    - the pin;
    - a topical fact;
    - a shaped fact younger than 14 days before the pin;
    - a shaped fact with fewer than 3 newer live shaped facts, counting an archived newer
      handoff and an unshaped pin as absent;
    - a shaped fact whose topic tag no newer handoff shares;
    - an id with `curation-kept` on any line.
  - **The fallback still fires.** A session that adds one non-handoff entry, on a brain where
    the rule archives an old handoff, still gets the B2 fallback handoff. The commit
    message's count excludes archive lines.
  - **Sticky exemption.** On a fixture with a restored, `curation-kept` line followed by a
    newer `auto-archived:` line (a simulated cross-branch merge), the rule restores the entry.
    On the same fixture with an operator `curate archive` line between them, it does not.
  - **Newest first.** On the fixture X[p12], Y[p12,q], Z[q], W[q] (oldest to newest, all
    qualifying by age and count), Y is archived and X is then held back. A mutation to
    snapshot or oldest-first evaluation archives X, and the test must go red.
  - **Only with the session's own writes.** On a clean brain, SessionEnd archives nothing and
    makes no commit. With one new entry it archives, and the archives ride that one commit.
  - **Text and restore.**
    - Text is byte-identical after the archive.
    - `curate restore` adds `curation-kept` only to `auto-archived:` entries.
    - The rule leaves a restored entry alone afterwards.
  - **Default branch.** The rule does not run there.
  - **Read-only.** `curate log`, `curate proposals` and the briefing-line renderer do not
    write.
  - **Silence.** The briefing renders no curation line when the counts are zero.
- **Agent-facing (L4, Tier 1 and §5).** The scenario runs the vendored plugin on a fixture
  brain on a topic branch. Fixture dates are relative to the run's date, so the rule's
  windows hold whatever entry ends up as the pin. Before session 1 the harness appends one
  uncommitted non-handoff entry through the CLI. That way the rule's precondition (§3) does
  not depend on what the agent chooses to write. The brain holds old handoffs and three
  planted traps:
  - (a) a recent handoff named "still stands" by the pin;
  - (b) an old topical status fact;
  - (c) **an old, shaped, still-live handoff of a paused stream**. It is more than 14 days
    old with 3 newer handoffs after it, and it carries a topic tag that none of them shares.
    This is the case the rule is most likely to get wrong. Only the stream guard saves it.

  The scenario runs one session to its end, then a second session that is asked "what
  changed in curation?".
  - **Positive arm.** After session 1:
    - exactly the qualifying set is archived and tagged;
    - all three traps are live.

    The B2-fallback interaction is a unit test (above), not an L4 predicate, because whether
    session 1's agent writes its own handoff is the agent's choice.

    Session 2's injection carries the line. The agent's answer names the archived count and
    the undo command, a content assertion over its output (ADR-0051 §3).
  - **Guard-removed arm, can-fail.** The same fixture, run against a pinned, sha-checked
    engine bundle with the stream guard removed. This mirrors `handoff-retires.mjs`'s pinned
    contrast fixture; the shipped engine has no switch that turns a safety guard off. Trap
    (c) is archived. This shows the trap can detect the failure it is planted for, and the
    scenario must see it happen. Tier 1 involves no model, so one trial is enough for this
    arm.
  - **Contrast arm.** The same fixture under today's plugin. Nothing is archived and there is
    no line.
  - DEMONSTRATED needs ≥ 2/3 on the positive arm, with the guard-removed arm archiving trap
    (c) and the contrast archiving nothing.
- **Tier 2 gets its own L4 when built.** It needs a planted entry that has no admissible
  reason, which must draw no proposal, and a declined proposal that must not reappear.
- **Until those records exist,** the honest status is "built, NOT yet verified". Delivery
  stays unproven per ADR-0051 until the plugin release's install-path record is re-pinned.

## Open items for the operator

1. **Where the curator agent runs.** It is the only part with a real cost and a real choice.
   - **(a) Dispatched by the session.** When the briefing shows unreviewed candidates, the
     session's agent starts `vfkb:curator` in the background. This uses the operator's own
     subscription and runs where the brain is. But "dispatch it" is an instruction in the
     injection, a prose rule an agent can skip.
   - **(b) Scheduled in CI.** A weekly GitHub Actions job runs the curator with a model key
     and opens a brain-only PR that adds only `curation-proposed:` tags. This is
     deterministic and shows up as a PR. But it needs a key in this repo (today only the
     plugin repo's L4 CI has one) and a scheduled job.
   - **Recommendation:** build Tier 1 and §5 first, since they need no agent. Choose (a) or
     (b) when Tier 2 starts, using real proposal volume from the first week.
2. **The thresholds.** 14 days, 3 newer handoffs and the generic-tag set fit the probe.
   Should they be settings (e.g. in `.vfkb/config`) or constants changed by RFC?
   Recommendation: constants. Changing what gets archived without notice is the kind of
   change that should be reviewed.

## What this does not do

- It does not archive decisions, links or topical facts automatically. Those are Tier 2 and
  propose-only.
- It does not change the pin rule, `retires`, or the handoff skill's yes-flow (ADR-0082
  §1–§5). Those keep working, and the rule is the floor under a skipped yes.
- R1's gate (ADR-0081) is not re-measured here. ADR-0082 found that its archives cannot move
  the stage-1 metric the gate measures, because stage 1 ranks archived entries too. That
  finding is inherited for these archives, not re-run.
