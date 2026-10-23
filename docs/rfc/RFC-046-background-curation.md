---
type: RFC
title: "RFC-046: Background curation — a deterministic rule archives clear-cut old handoffs, an agent proposes the rest, one briefing line alerts the operator (amends ADR-0082 §6)"
description: "Operator direction 2026-10-23 (brain f119b9942af4): curation should run in the background, by rules, with clear-cut cases archived automatically and only uncertain cases surfaced. A probe on main found 122 live handoff/next facts beside the pin. Most say 'supersedes X', but often with qualifiers ('on the #330 question only', 'X's NEXT stands'), so the text cannot drive a rule without judgment. This RFC proposes: (1) one deterministic rule, keyed on structure not prose — a handoff-shaped fact at least 14 days older than the pin, with at least 3 newer handoff-shaped facts, is archived at SessionEnd and tagged with the rule; 72 of the 122 today; (2) everything else in scope goes to a curator agent that proposes, never archives; (3) one line in the session-start briefing reports what was archived (with the undo) and what awaits the operator; (4) declined proposals are never re-raised. It replaces ADR-0082 §6's operator-edited list, and relaxes ADR-0082's propose-only rule for the rule's cases only."
status: "Proposed"
timestamp: 2026-10-23
---

# RFC-046: Background curation

- **Status:** Proposed
- **Date:** 2026-10-23
- **Deciders:** operator + Claude
- **Origin:** operator direction 2026-10-23, brain decision `f119b9942af4`: *"ultimately I
  would like this to be done automatically in the background … start with clear cut cases
  being done automatically and new cases are the only ones that the agent should alert
  about."* Also the standing ruling that the operator does not hand-label (brain
  `00cff7e60454`).
- **Amends:** [ADR-0082](../adr/ADR-0082-propose-only-curation.md) §6, "the backlog is
  archived from the operator's edited list". It also relaxes ADR-0082's propose-only rule,
  **for the §2 rule's cases only**, by the operator's explicit direction above.
- **Relates:**
  - [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md): the curator's delta-only
    operations and the never-rewrite Brake. Both still hold: archiving changes a zone and a
    tag, never text.
  - [ADR-0033](../adr/ADR-0033-session-end-continuity.md): the SessionEnd hook that already
    writes the fallback handoff and auto-commits the brain. §2 runs beside it.
  - [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md): the session-start
    briefing, where §4's line goes.
  - [ADR-0041](../adr/ADR-0041-entries-jsonl-merge-union.md): merge=union, and the named
    cross-clone un-archive hazard in ADR-0082 §4, which applies here unchanged.
- **Evidence:** [`docs/v3/research/probes/background-curation-2026-10-23/`](../v3/research/probes/background-curation-2026-10-23/)
  (`probe.mjs` against the real engine's `latestHandoff` and `isInjectable`, output in
  `output.txt`, brain at the commit in `brain-commit.txt`).

## Context

ADR-0082 made new handoffs retire their predecessor on an explicit yes. It left the existing
pile to an operator-edited list. The operator has since said they will not edit such a list,
and that the pile recurs: any session that skips the yes adds one more.

The probe, on `main` at `97e796e` (pin `e622618cba19`):

1. **122 live handoff/next facts besides the pin.** 91 are handoff-shaped (they open
   `HANDOFF`, `SESSION HANDOFF` or `RESUME`); 31 are topical status facts ("SHIPPED …",
   "CLOSED OUT …", "NEXT-SESSION TASK …"), 25 of them tagged `status`.
2. **Most handoffs name what they replace, but not cleanly.** 56 of the 91 are named by id in
   a newer live entry, usually as "supersedes X". The wording is often partial:
   - "supersedes 023309109476 on the #330 question only";
   - "Supersedes be601e467329 / 6d04b01e15e9 on 'what happened last', NOT …";
   - "SUPERSEDES 78bbdd0ef2a7 — everything there still stands";
   - "Prior handoff 064a17d755b2 remains valid for everything …";
   - "the R7 NEXT of 0eb27512a01c stands".

   Some mentions are not supersession at all ("a zone edit of the oldest handoff
   1488c66658c4 made it the pin"). Reading these takes judgment. A deterministic rule must
   not parse them.
3. **Parallel streams exist.** On 2026-10-22 two live handoffs ran side by side, one for the
   Jev stream and one for R7, each naming the other's NEXT as standing. "Older than the pin"
   is therefore not the same as "replaced".
4. **Age separates the pile well.** 72 of the 91 shaped handoffs are at least 14 days older
   than the pin, and each has at least 3 newer shaped handoffs after it. The other 19 are all
   from the last 14 days, which includes both of item 3's parallel streams. Qualified
   handoffs (item 2) occur at every age; the rule does not try to read them, it lets age and
   the newer handoffs that carried their content forward decide.

## Proposal

### 1. Two tiers: a rule archives, an agent proposes

- **Tier 1, the rule (§2):** deterministic engine code with no model. It archives
  automatically, and only the cases it is sure of.
- **Tier 2, the curator agent (§3):** looks at everything else in scope and **proposes**.
  It never archives. The operator answers proposals in a session.
- A kind of proposal the operator keeps accepting is the evidence for a new Tier-1 rule.
  New rules arrive by RFC, not by the agent.

### 2. Tier 1: the old-handoff rule

A live fact is archived by the rule when **all** hold:
- it is a pin candidate (a `type: fact` tagged `handoff` or `next`, ADR-0082 §1) and not the
  pin;
- it is **handoff-shaped** (the existing `HANDOFF_SHAPE` in `src/curator.ts`), so topical
  status facts are never touched by the rule;
- its `created` is **at least 14 days** before the pin's `created`;
- **at least 3** handoff-shaped facts (the pin included) were created after it.

The rule reads `created`, tags and the shape test. It never reads what the text says about
other entries, for the reason in Context item 2.

The archive is the existing delta (zone `archive`), plus the tag
`auto-archived:old-handoff@<YYYY-MM-DD>`. Text is untouched. `vfkb curate restore <id>`
undoes it and removes the tag, and a restored entry is **exempt from the rule forever**,
marked by a `curation-kept` tag that restore adds. Without the exemption the next SessionEnd
would archive it again.

**Where it runs:** `vfkb curate auto`, a new CLI subcommand, called by the SessionEnd hook
**before** the existing auto-commit, so its archives ride the same brain-only commit on the
topic branch. On the default branch the hook already refuses to commit and warns; the
archives then stay uncommitted with the rest of the brain, as today. It is fail-open like the
rest of SessionEnd.

**Accepted risk, stated:** a handoff whose content a later one called "still valid" (e.g.
`064a17d755b2`, 39 days old) is archived once it is old enough. The reasoning: after 14 days
and 3 newer handoffs, what still matters has been carried forward or written as its own
entry. Archiving hides it from injection only, and the §4 line names it with its undo.

**Rejected rules:**
- **"Superseded by text":** fails Context item 2.
- **"Older than the pin":** fails Context item 3.
- **A shorter window:** at 7 days the count is 73, one more, and it reaches into the period
  of qualified handoffs. 14 days loses little and stays clear of it.

### 3. Tier 2: the curator agent

A plugin subagent, `vfkb:curator`, beside the existing `vfkb:briefer` and `vfkb:updater`.
Its job is fixed by a checklist, not open judgment:
- **Scope:** live pin candidates that the rule does not cover (today: 19 shaped, 31 topical),
  plus `vfkb curate stale`'s report.
- **For each, it either proposes archiving with one checkable reason, or says nothing.**
  Admissible reasons:
  - a newer live entry names this one and the agent reads that as full supersession (quoted);
  - it asserts a state the repo now contradicts (e.g. "PR #35 is open" when `gh` shows it
    merged), with the evidence;
  - its NEXT has since been recorded as done (quoting the entry that says so).

  With no such reason, it proposes nothing.
- **A proposal is a tag** on the entry: `curation-proposed:<reason-code>@<date>`, with the
  quoted evidence held in the report (§4). It changes no zone.
- **Where and when it runs:** this RFC's open item 1.

The operator answers proposals in a session. "Yes" runs `vfkb curate archive`. "No" runs
`vfkb curate keep <id>`, a new subcommand that adds `curation-kept` and clears the proposal,
so **the same entry is never proposed again**. That is how "only new cases alert".

### 4. The alert: one line in the session-start briefing

The session-start injection gains one line, placed after `## Last handoff`, and **only when
there is something to say**:

> Curation: archived 12 old handoffs since 2026-10-23 (`vfkb curate log` lists them; undo
> with `vfkb curate restore <id>`). 2 proposals need you: `vfkb curate proposals`.

- **The counts are derived from tags** (`auto-archived:…@date` since the previous session
  start, and live `curation-proposed:` tags), so no new store is added.
- **`vfkb curate log` and `vfkb curate proposals`** are read-only reports, like ADR-0082 §6's.
  `proposals` prints each entry's first line with the agent's reason and evidence.
- **Why this channel:** it is the one the operator and every agent already read at the start
  of every session. Email, issues or desktop notifications need new setup and are easier to
  miss. A GitHub-issue mirror can be added later if wanted.
- **Silence is honest:** when nothing was archived and nothing is proposed, there is no line.

### 5. The existing backlog

There is no special backlog pass. The first SessionEnd after the build runs §2 and archives
the 72. The next session's line reports it. The curator then proposes from the remaining 50.
The operator-edited list of ADR-0082 §6 (and its file
`~/GitHub/vfkb-handoff-backlog-2026-10-23.tsv`) is retired.

## Definition of Done (ADR-0029/0050/0051)

- **Structural** (unit tests, each observed red under a mutation of the code it guards):
  - The rule archives exactly the fixture's qualifying set, and never:
    - the pin;
    - a topical (unshaped) fact;
    - a shaped fact younger than 14 days before the pin;
    - one with fewer than 3 newer shaped facts;
    - one tagged `curation-kept`.
  - Text is byte-identical after the archive, and `curate restore` adds `curation-kept`, after
    which the rule leaves the entry alone.
  - `curate log`, `curate proposals` and the briefing-line renderer do not write.
  - The briefing renders no curation line when the counts are zero.
- **Agent-facing (L4, Tier 1 + §4):** a scenario running the vendored plugin on a fixture
  brain that holds old handoffs, plus two planted traps: a **recent** handoff named "still
  stands" by the pin, and an **old topical** status fact. It runs one session to its end,
  then a second session that is asked "what changed in curation?".
  - **Positive arm:** after session 1, exactly the qualifying set is archived and tagged, and
    both traps are live. Session 2's injection carries the line, and the agent's answer
    names the archived count and the undo command (a content assertion over its output,
    ADR-0051 §3).
  - **Can-fail contrast:** the same fixture under today's plugin. Nothing is archived and
    there is no line. The scenario must score this 0/3.
  - DEMONSTRATED needs ≥ 2/3 on the positive arm.
- **Tier 2 gets its own L4** when built, with a planted entry that has no admissible reason,
  which must draw no proposal, and a declined proposal that must not reappear.
- Until those records exist, the honest status is "built, NOT yet verified". Delivery stays
  unproven per ADR-0051 until the plugin release's install-path record is re-pinned.

## Open items for the operator

1. **Where the curator agent runs.** It is the only part with a real cost and a real choice.
   - **(a) Dispatched by the session.** When the briefing shows unreviewed candidates, the
     session's agent starts `vfkb:curator` in the background. This uses the operator's own
     subscription and runs where the brain is. But "dispatch it" is an instruction in the
     injection, a prose rule an agent can skip.
   - **(b) Scheduled in CI.** A weekly GitHub Actions job runs the curator with a model key
     (the DeepSeek key the plugin's L4 CI already uses) and opens a brain-only PR that adds
     only `curation-proposed:` tags. This is deterministic and visible as a PR, but needs a
     key in this repo and a scheduled job.
   - **Recommendation:** build Tier 1 and §4 first, since they need no agent, and choose (a)
     or (b) when Tier 2 starts. That way the choice can use real proposal volume from the
     first week.
2. **The thresholds.** 14 days and 3 newer handoffs fit the probe. Should they be settings
   (e.g. in `.vfkb/config`) or constants changed by RFC? Recommendation: constants, since
   changing what gets archived silently is the kind of change that should be reviewed.

## What this does not do

- It does not archive decisions, links or topical facts automatically. Those are Tier 2,
  propose-only.
- It does not change the pin rule, `retires`, or the handoff skill's yes-flow (ADR-0082
  §1–§5). Those keep working; the rule is the floor under a skipped yes.
- It does not change R1's gate (ADR-0081). Like ADR-0082's archives, these do not move the
  stage-1 metric.
