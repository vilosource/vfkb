---
type: Decision
title: "ADR-0083: Background curation — a deterministic SessionEnd rule archives clear-cut old handoffs, a curator agent only proposes, one briefing line reports both (accepts RFC-046; amends ADR-0082 §6)"
description: "Accepts RFC-046 with the operator's ruling of 2026-10-23. Tier 1 is model-free engine code. At SessionEnd, on a topic branch, and only when the session is committing its own brain changes, it archives a handoff-shaped fact that is at least 14 days older than the pin, has at least 3 newer live shaped handoffs, passes a same-stream topic-tag guard, and has never been restored. It checks candidates newest-first. Tier 2 is a vfkb:curator agent that proposes with one checkable reason and never archives; a declined proposal is never raised again. One session-start line reports both. Thresholds are constants. Where the curator runs is decided when Tier 2 starts. The operator-edited backlog list of ADR-0082 §6 is retired, and ADR-0082's propose-only rule is relaxed for Tier 1's cases only."
status: "Accepted"
timestamp: 2026-10-23
---

# ADR-0083: Background curation

- **Status:** Accepted (2026-10-23, operator ruling; brain decision `fe2a8f4e7919`).
- **Date:** 2026-10-23
- **Accepts:** [RFC-046](../rfc/RFC-046-background-curation.md). The operator accepted it
  without answering its two open items, so the RFC's own recommendations are taken (§7). The
  operator can override either.
- **Amends:** [ADR-0082](ADR-0082-propose-only-curation.md).
  - §6, its last bullet only: the backlog is no longer archived from an operator-edited
    list; §6 below replaces that bullet. §6's read-only reports (`curate handoffs`,
    `curate stale`) stand, and §4 below uses `curate stale`.
  - The propose-only rule: relaxed **for the §2 rule's cases only**, by the operator's
    direction (brain `f119b9942af4`).
  - The rest of ADR-0082 stands: §1–§5 (the pin rule, `retires`, `curate retire` /
    `curate restore`, the handoff skill's yes-flow), §6's reports, §7 and §8.
- **Relates:**
  - [ADR-0021](ADR-0021-auto-distill-and-curator.md): archiving is a zone-and-tag delta, and
    text is never rewritten.
  - [ADR-0033](ADR-0033-session-end-continuity.md): the SessionEnd fallback handoff and
    auto-commit.
  - [ADR-0041](ADR-0041-entries-jsonl-merge-union.md): merge=union, and ADR-0082 §4's
    cross-clone hazard.
  - [ADR-0049](ADR-0049-session-start-handoff-pinning.md): the session-start briefing.
  - [ADR-0070](ADR-0070-guards-that-can-fail.md) §4: round 2 of RFC-046's review was
    escalated under it, which produced the option-A ruling (brain `ca519225196e`).
- **Evidence:** RFC-046 and its probe
  ([`docs/v3/research/probes/background-curation-2026-10-23/`](../v3/research/probes/background-curation-2026-10-23/)),
  plus the three adversarial review rounds of [vfkb#376](https://github.com/vilosource/vfkb/pull/376).

## Context

ADR-0082 left the existing pile of live handoff facts to an operator-edited list. The
operator will not hand-edit such a list. They asked for curation that runs in the
background by rules, archives clear-cut cases on its own, and alerts only on new cases.

RFC-046's probe (`main` at `97e796e`) found:
- **122 live handoff/next facts** beside the pin: 91 handoff-shaped, 31 topical.
- **Handoff wording that needs judgment to read.** "Supersedes X" is often partial ("on the
  #330 question only", "X's NEXT stands").
- **Parallel streams,** so a handoff can be older than the pin without having been replaced.

So the rule may use only structure (dates, tags, shape), and judgment goes to a tier that
proposes.

## Decision

### 1. Two tiers

- **Tier 1** (§2–§3) is deterministic engine code with no model. It archives
  automatically.
- **Tier 2** (§4) is an agent that proposes and never archives.
- A new Tier-1 rule arrives by RFC, never by the agent.

### 2. The Tier-1 rule

A live fact X is archived when **all** of these hold:
1. X is a pin candidate (ADR-0082 §1) and not the pin.
2. X matches `HANDOFF_SHAPE` (`src/curator.ts`).
3. X's `created` is at least **14 days** before the pin's `created`.
4. At least **3** live, handoff-shaped pin candidates were created after X. The pin counts
   only if it is shaped, and archived entries never count.
5. **Same-stream guard.** If X carries any topic tag, at least one of those newer shaped
   handoffs shares one of X's topic tags. A topic tag is any tag outside the generic set:
   - lifecycle tags: `handoff`, `next`, `status`, `auto`, `verified`, `v2`, `v3`;
   - kind-of-work tags: `review`, `escalation`, `rfc`, `adr`, `plugin`, `l4`, `guard`,
     `release`, `tooling`, `cross-repo`, `distribution`, `roadmap`, `public`.
6. No line of X's id carries `curation-kept`.

Further terms:
- **Evaluation order is newest-first.** An entry archived in a run stops counting as live for
  the older entries checked after it.
- **What it writes:** zone `archive` plus the tag `auto-archived:old-handoff@<YYYY-MM-DD>`.
  Text is untouched.
- **Effect:** the entry leaves injection, and leaves search and query results unless the
  caller passes `includeStale`. It stays in `entries.jsonl`, and `vfkb curate log` lists
  it.
- **Restore:** `vfkb curate restore` on an `auto-archived:` entry removes that tag and adds
  `curation-kept`. Restore of any other archive is unchanged from ADR-0082 §4.
- **The repair:** a line the rule wrote is one carrying an `auto-archived:` tag. If an id's
  materialized line is a rule-written archive, and its newest line not written by the rule
  (newest by `updated`, never by file position) is live with `curation-kept`, the rule
  restores the entry and re-adds `curation-kept`. The repair's own restore line carries no
  `auto-archived:` tag, so later runs treat it as an ordinary line. If that newest non-rule
  line is an archive, such as an operator's own `curate archive`, it stands.

**Accepted risks** (RFC-046 §2):
- partially superseded handoffs are archived once old enough;
- a paused stream with no topic tag cannot be protected;
- one shared topic tag is evidence of a shared stream, not proof.

### 3. Where Tier 1 runs

`vfkb curate auto`, called by the SessionEnd hook:
- **only when the session added at least one new id since HEAD** (option A, brain
  `ca519225196e`). Curation never makes a commit of its own;
- **only on a topic branch.** A project whose sessions all run on its default branch gets no
  Tier 1;
- **after the B2 fallback decision.** Both the fallback's "new entries" and the commit
  message's count are computed over new ids, not added lines;
- in the session's single brain-only commit, whose message adds `, <n> curated`, fail-open.

### 4. Tier 2: the curator agent

A plugin subagent, `vfkb:curator`.
- **Scope:** live pin candidates that Tier 1 does not archive, plus `vfkb curate stale`'s
  report.
- **For each, one of two outcomes:** a proposal with one checkable reason, or nothing. The
  admissible reasons are listed in RFC-046 §4.
- **A proposal is a tag,** `curation-proposed:<reason-code>@<date>`.
- **Answering it:** "yes" runs `curate archive`. "No" runs `curate keep`, which adds
  `curation-kept` **and clears the proposal tag**, so the entry leaves §5's count and is
  never proposed again.

### 5. The alert

One line after `## Last handoff` in the session-start briefing, shown only when there is
something to report:
- the count of `auto-archived:` tags dated in the last 7 days, with `vfkb curate log` and
  the undo;
- the count of live `curation-proposed:` tags, with `vfkb curate proposals`.

Both reports are read-only.

### 6. The backlog

There is no separate backlog pass. The first qualifying SessionEnd after the build archives
the qualifying set (50 of 122 at `97e796e`), and the next briefing reports it. The
operator-edited list is retired.

### 7. The open items, settled by the RFC's recommendations

- **Where the curator runs** (session-dispatched, or scheduled CI opening a brain-only PR)
  is decided when Tier 2 starts. RFC-046 says to use "real proposal volume from the first
  week". Proposals cannot exist before Tier 2 runs, so this ADR reads that as the first
  week of Tier-1 results plus the remaining candidate count (brain `fe2a8f4e7919` words it
  as "Tier-1/proposal volume"). The operator can rule otherwise when Tier 2 starts.
- **The thresholds** (14 days, 3 newer handoffs, the generic-tag set) are **constants**,
  changed only by RFC.

### 8. Order

Tier 1 and §5 go first, since neither needs an agent. Tier 2 follows, with §7's choice made at
its start.

## Definition of Done (ADR-0029/0050/0051)

RFC-046's Definition of Done governs. This is a summary.
- **Structural unit tests,** each observed red under a mutation:
  - the six conditions, and newest-first order on the X/Y/Z/W fixture;
  - the fallback still firing when the rule archives, and the commit count excluding archive
    lines;
  - text byte-identical after an archive (the ADR-0021 Brake); restore adding
    `curation-kept` only to `auto-archived:` entries; the rule then leaving them alone;
  - the sticky repair, and the operator's archive winning over it;
  - no curation and no commit on a clean brain or the default branch; with one new entry,
    the archives ride that one commit;
  - read-only reports;
  - no line when the counts are zero.
- **A Tier-1 L4, scenario-first and RED first:**
  - a fixture on a topic branch with dates relative to the run, a harness-appended entry, and
    three planted traps (a recent "still stands" handoff, an old topical fact, an old live
    handoff of a paused tagged stream);
  - a positive arm (≥ 2/3): the exact set is archived and all traps stay live. The next
    session's agent's answer names the archived count and the undo command, a content
    assertion over its output (ADR-0051 §3);
  - a guard-removed arm on a pinned, sha-checked bundle, which must archive trap (c);
  - a contrast arm under today's plugin, which archives nothing.
- **A Tier-2 L4** at Tier 2's build. An entry with no admissible reason must draw no
  proposal, and a declined proposal must not reappear.
- **Status until those records exist:** "built, NOT yet verified". Delivery stays unproven
  per ADR-0051 until the plugin release's install-path record is re-pinned.

## Consequences

- The live handoff count stops growing between confirmed retirements. A skipped yes no
  longer leaves a permanent extra entry.
- The operator's ongoing curation work drops to answering proposals, each named once.
- A topic-branch session that writes to the brain may also archive old handoffs in the same
  commit, so brain diffs in PRs carry archive lines.
- Projects that work only on their default branch get Tier 2 and manual archiving, not
  Tier 1.
