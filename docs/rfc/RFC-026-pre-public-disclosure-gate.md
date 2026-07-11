---
type: RFC
title: "RFC-026: Pre-public disclosure gate — the audit that gates the visibility flip"
description: "Flipping the repo public publishes all history retroactively. This RFC defines the audit that must complete first — full-history secrets sweep, explicit operator rulings on identity/infra exposure, brain triage — and the flip-day hardening checklist. The gate's evidence is recorded in the brain before the flip; a history rewrite, if ruled necessary, happens before the flip or not at all."
status: "Accepted → ADR-0054 (ratified 2026-07-11)"
timestamp: 2026-07-11
---

# RFC-026: Pre-public disclosure gate

- **Status:** Accepted → [ADR-0054](../adr/ADR-0054-pre-public-disclosure-gate.md) (ratified 2026-07-11)
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [RFC-025](RFC-025-going-public-release-engineering.md) (umbrella, W0 — this RFC
  gates the visibility flip; every other child RFC can land before it).

## Context

The repo was written in private. Three exposure classes exist that a credential scanner does not
cover, and all become permanent the moment visibility flips:

1. **Identity**: commit authorship carries a corporate email address across the entire history.
2. **Infrastructure names**: CLAUDE.md documents an internal npm registry host; brain entries and
   docs mention internal machines and adjacent private projects by name.
3. **Narrative**: the committed brain (200+ entries) is a candid engineering diary — that is its
   *value* (the README's proof point), but candor written for an audience of one deserves one
   deliberate read-through before the audience becomes everyone.

GitGuardian has scanned every push for credentials; that covers secrets, not judgment.

## Decision (proposed)

The visibility flip is **gated** on the following, in order. Evidence for each step is recorded
as brain entries tagged `public-audit` (observed, not asserted — the gate's own DoD):

1. **Full-history secrets sweep** — run a history-capable scanner (e.g. `gitleaks detect` over
   the full clone; tool choice made at execution time, result recorded, report NOT committed).
   Any hit: rotate first, then decide scrub-vs-accept.
2. **Targeted disclosure grep** — a checklist sweep of history + docs + `.vfkb/entries.jsonl`
   for: internal hostnames, personal/corporate email addresses, customer or colleague names,
   absolute paths that reveal machine layout. Output: a short exposure inventory (brain entry).
3. **Operator rulings, explicit and on the record** (one brain decision each):
   - commit-author email: acceptable as-is, or history rewrite required?
   - internal registry hostname in CLAUDE.md: keep (it documents a real env caveat) or scrub
     going forward (a docs edit; history still shows it unless rewritten)?
   - brain entries naming internal projects: keep (default — the brain is the demo), archive
     individual entries, or none.
   A history rewrite is a **one-way door with a deadline**: it happens before the flip or the
   exposure is accepted permanently. The ruling must say which.
4. **Flip-day hardening** (same day as the flip, one checklist, evidence = screenshots/settings
   recorded in a brain entry): enable GitHub secret scanning + push protection; verify branch
   protection on `main` requires `review-gate` **and** the RFC-027 test workflow; set repo
   description, topics, and social preview; verify the LICENSE and README render as intended.

## Consequences

- The flip acquires a defined "done": all four steps evidenced in the brain. Until then, the
  honest status of "going public" is *blocked on W0* regardless of how much of W1–W4 has landed.
- If a rewrite is ruled necessary, every clone/fork must re-clone, and all open PRs must be
  rebased — another reason this gate runs *now*, while the audience is one person.
- The audit itself produces public-visible artifacts (brain entries describing what was checked).
  They must be written knowing they too go public — describe classes, not findings' contents.

## Alternatives considered

- **Flip first, clean later**: rejected — history exposure is retroactive and permanent;
  "later" is never for a rewrite.
- **Automated-scan-only (skip the human read-through)**: rejected — the exposure classes that
  matter here (identity, narrative) are judgment calls no scanner flags.
- **Scrub-everything-by-default**: rejected — the committed brain's candor is the product demo;
  the default is keep, with explicit rulings on the short exposure inventory.
