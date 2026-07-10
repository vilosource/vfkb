# Review records

One file per reviewed commit: `reviews/<full-head-sha>.json`. Written by `/review` after an
adversarial subagent has read the diff; verified in CI by `scripts/review-gate.mjs` (ADR-0052).

A PR that touches implementation paths (`src/`, `test/`, `scenarios/`, `scripts/`,
`.claude/commands/`, `.github/workflows/`) fails CI without one. Docs, `.vfkb/`, `README.md`,
`CLAUDE.md` and `reviews/` itself are exempt.

## Which sha?

The sha of the commit that was **reviewed**. Adding the record changes the head sha, so the gate
accepts a record filed against `HEAD` *or* against the commit you get by stripping trailing
commits that touch only `reviews/`. A commit that touches code after the review invalidates it —
re-review.

## Schema

```jsonc
{
  "recordVersion": 1,
  "sha": "<the full sha this review read>",
  "governing": ["docs/adr/ADR-0051-delivery-honesty.md"],   // must exist; ≥1
  "reviewer": { "agent": "general-purpose", "model": "opus", "rounds": 9 },
  "generated": "2026-07-10T04:00:00Z",
  "findings": [
    {
      "id": "F1",
      "severity": "blocking",        // blocking | major | minor
      "status": "fixed",             // fixed | accepted | open
      "summary": "disclosure passed while buried in an HTML comment",
      "acceptedBy": null             // REQUIRED to waive a blocking finding
    }
  ],
  "findingsCount": 1,                 // optional; must equal findings.length if present
  "ruledOut": [],                     // REQUIRED when findings is empty
  "verdict": "MERGE"                  // a CLAIM — the gate recomputes it
}
```

## What the gate checks

It **recomputes** the verdict from the findings and compares: a record may not assert `MERGE`
while carrying a `blocking` finding whose status is `open`. This is the same rule the plugin's
release gate applies to L4 records — the verdict field is testimony, the findings are evidence
(RFC-024 §2a).

It also fails when: the record is filed against a sha it does not name; it names no governing
document, or one that does not exist; it does not say who reviewed it, or over how many rounds;
it reports zero findings without saying what it ruled out; `findingsCount` disagrees with the
array; or a `blocking` finding is waived with no `acceptedBy`.

## What it cannot check

**That a review happened.** An author determined to lie can hand-write this JSON. That is
deliberate: the failure actually observed on 2026-07-09 was *omission* under end-of-chain
momentum — four PRs self-merged, two of them substantial implementations — not forgery, and
CLAUDE.md forbids building for a defect nobody has seen. What the Brake changes is that skipping
the review is no longer **silent**. It now requires a deliberate false statement, committed under
your name.

It also cannot check that the review was any *good*. The rubric in
[`.claude/commands/review.md`](../.claude/commands/review.md) is the standard; the gate only
enforces that a record exists, binds to this diff, and does not contradict itself.
