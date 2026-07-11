---
type: Decision
title: "ADR-0054: The pre-public disclosure gate (accepts RFC-026)"
description: "The visibility flip is gated on a four-step audit with evidence recorded in the brain: full-history secrets sweep, targeted exposure inventory (identity/hostnames/narrative), explicit operator rulings — including the history-rewrite question, which must be answered before the flip because afterward it is permanent — and flip-day hardening (secret scanning + push protection, required checks verified, repo metadata)."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0054: The pre-public disclosure gate

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-026](../rfc/RFC-026-pre-public-disclosure-gate.md) (accepted 2026-07-11; the
  step-by-step audit definition and rejected alternatives live there)
- **Relates:** [ADR-0053](ADR-0053-going-public-sequencing.md) (umbrella; this is W0, the flip
  gate); [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the committed brain whose candor is
  both the demo and the exposure surface).

## Context

Flipping repo visibility publishes all history retroactively. Credential scanning (GitGuardian)
has covered every push, but the exposure classes that matter here are judgment calls no scanner
flags: commit-author identity, internal infrastructure names in docs, and the committed brain's
candid narrative — which is the README's proof point and therefore *kept by default*, but
deserves one deliberate read-through before the audience becomes everyone.

## Decision

The flip is **blocked** until four steps are complete, each evidenced by brain entries tagged
`public-audit` (observed, not asserted):

1. **Full-history secrets sweep** with a history-capable scanner; hits are rotated first, then
   ruled scrub-vs-accept.
2. **Targeted exposure inventory**: internal hostnames, email addresses, person/customer names,
   machine-revealing paths — across history, docs, and `.vfkb/entries.jsonl`.
3. **Explicit operator rulings, one brain decision each**: commit email; the internal registry
   hostname in CLAUDE.md; brain-narrative entries. **A history rewrite happens before the flip
   or not at all** — the ruling must say which.
4. **Flip-day hardening**: GitHub secret scanning + push protection on; branch protection
   verified to require `review-gate` and the ADR-0055 test check; repo description/topics/
   social preview; LICENSE + README render check.

Until all four are evidenced, the honest status of "going public" is **blocked on W0**,
regardless of how much of ADR-0055..0058 has landed.

## Consequences

- The audit's own artifacts go public with the repo — they are written as class descriptions,
  never reproducing a finding's content.
- If a rewrite is ruled necessary, every clone rebases; ruling now, while the audience is one
  person, is the cheap moment this ADR exists to force.
- "Flip first, clean later" and "scrub everything by default" are rejected in RFC-026 and stay
  rejected.
