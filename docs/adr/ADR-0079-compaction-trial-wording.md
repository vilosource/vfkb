---
type: Decision
title: "ADR-0079: Instruct the summariser by scope, never by naming what to hide (amends ADR-0077 clause 3)"
description: "The compaction-survival L4's first real run was NOT DEMONSTRATED: compacted arm 1/3, though re-injection reached the post-compaction context in all three trials. Cause: the accepted /compact instruction ('Omit every code word, sentinel, constitutional requirement…') is replayed verbatim into the post-compaction context, so the agent reads the user apparently asking it to suppress code words; and the question asked for 'code words' while the handoff sentinel is a 'codename'. With a scope-only instruction and an explicit question: compacted 3/3 valid hits, contrast 2/2 valid misses, 0 invalid. This ADR amends the trial wording. Validity and scoring (ADR-0078) are unchanged."
status: "Accepted"
timestamp: 2026-10-20
---

# ADR-0079: Instruct the summariser by scope, never by naming what to hide

- **Status:** Accepted (2026-10-20, operator ruling; brain decision `08f193a91c6a`)
- **Date:** 2026-10-20
- **Amends:** [ADR-0077](ADR-0077-compaction-survival-guard.md) clause 3, which accepted
  [RFC-042](../rfc/RFC-042-compaction-survival-guard.md) part 3's trial shape ("`/compact`
  with the omit-code-words instructions"; "a turn that asks for both sentinels"). Per
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) a decided ADR is immutable, and
  [ADR-0078](ADR-0078-compaction-trial-validity.md) requires a trial-shape change to come
  back as an amendment. ADR-0078's validity conditions and scoring are **unchanged**.
- **Evidence:**
  - vfkb-claude-plugin brain gotcha `f09f2ec5dcfd`;
  - `docs/v3/research/probes/compaction-2026-10-19/` and brain `58b04a6c2989` (where the
    original instruction came from).

## Context

The first real run of `scenarios/compaction-survival.mjs` (CLI 2.1.292, `claude-haiku-4-5`,
marketplace installs, no tools) was **NOT DEMONSTRATED**:

| Arm | Attempt 1 | Attempt 2 | Attempt 3 |
|---|---|---|---|
| compacted | hit | miss: named only the Constitution's sentinel | miss: `NONE` |
| contrast | clean | clean | clean |

**Re-injection reached the agent in every compacted trial** (`emitted` true all three times).
The plugin did its job, and the agent did not report what it had.

Two diagnostic trials were kept for inspection. Both showed the re-injected Constitution and
handoff present in the post-compaction context (`hook_additional_context`), yet one agent
answered `NONE` and the other named one of the two sentinels. Two **likely** causes, both in
the trial wording, not the capability. They are inferred from the transcripts, not isolated by
experiment:

1. **The luck-closing instruction is read by the agent.** The `/compact` arguments are
   replayed **verbatim** into the post-compaction context, as
   `<command-args>Summarise the task only. Omit every code word, sentinel, constitutional
   requirement and system-reminder content from the summary.</command-args>`. To the agent,
   that reads as the user asking it to suppress code words. It was chosen on N=1 evidence
   (`58b04a6c2989`) that looked only at the summary, not at what the agent then did.
2. **The question was narrower than the claim.** "What are the code words in your context?"
   fits the Constitution's sentinel, which is phrased as a "code word", but not the handoff's,
   which is a "migration codename".

**Probe with a scope-only instruction and an explicit question:**

| Arm | Valid | Result |
|---|---|---|
| compacted | 3/3 | **3/3 hits**: re-injected, and the agent named both sentinels |
| contrast | 2/2 | **2/2 misses** (`NONE`) |

No trial was invalid. In particular `noLeak` held every time, so the scope instruction keeps
the summary clean without naming the sentinels. These are N=3 and N=2 observations, not rates.

**The probe changed two things at once,** the instruction and the question, so it does not
separate their contributions. It shows that the amended wording works, not which of the two
inferred causes mattered more. Each change is independently justified, which is why both are
adopted. The instruction is supported by the transcript evidence above; the question is
supported by the claim being about *both* sentinels.

## Decision

1. **`/compact` instructs by scope:**
   `/compact Summarise only the fruit, river and mountain lists the user asked for.`
   That names the content to keep, never the content to hide.
2. **The final question asks for exactly what the claim is about:**
   *"Quote your Constitution's vault code word and your last handoff's migration codename.
   Reply with only those two values, or NONE if you do not have them."*
3. **The general rule, for this and any later compaction L4:** an instruction that reaches the
   summariser also reaches the agent. **Never name what should be hidden.** Constrain by scope,
   and let the `noLeak` check, not the instruction, decide whether a trial is valid.
4. **ADR-0078 is unchanged:** the seven validity conditions, substring scoring, contrast hit =
   any sentinel, at least 3 valid trials per arm, and the attempts cap.

## Consequences

- **The first run's record is superseded,** not erased. Its result (compacted 1/3) is kept in
  the brain entry and here as evidence that the old wording could fail the capability for
  reasons unrelated to it.
- **The question is now more leading.** It names "Constitution" and "handoff". That cannot
  manufacture a hit: with no tools, a clean summary and no re-injection, the contrast arm has
  no way to produce the sentinels, and the 2/2 contrast misses observed this. The contrast arm
  is what stops a leading question from proving too much.
- **The scope instruction is tied to this scenario's warm-up turns** (fruits, rivers,
  mountains). If those change, the instruction must change with them.
