# RFC-020: Layered knowledge management — vfkb (capture), graphify (understand), OKF (publish)

- **Status:** Proposed
- **Date:** 2026-07-07
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the committed brain this
  RFC exports *from*, never replaces), [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md)
  (curator/corroboration gate this RFC reuses as its export threshold), [ADR-0009](../adr/ADR-0009-decision-identity-and-numbering.md)
  (ADR/RFC file shape this RFC proposes lightly retrofitting), `docs/H4-DEVELOPMENT-ROADMAP.md`
  Track 9 Q3 ("AGENTS.md export projection" — this RFC proposes widening that render-target work
  rather than duplicating it), `CLAUDE.md` §graphify (this repo's own graphify wiring)

## Context

Two new tools entered this project this session with no prior design record: **OKF** (Open
Knowledge Format — a directory of markdown files with YAML frontmatter, zero SDK, human- and
agent-readable via `cat`) and **graphify** (turns any folder into a queryable, community-clustered
knowledge graph with an EXTRACTED/INFERRED/AMBIGUOUS honesty tiering). Both are now available
alongside vfkb in every session here, and both are, on the surface, "knowledge management" —
raising the obvious question this RFC answers: what does each one *own*, and how does knowledge
move between them without three independent, drifting sources of truth?

The three systems are not competing — they capture fundamentally different **shapes** of knowledge:

| System | Shape | Write model | Confidence model |
|---|---|---|---|
| **vfkb** | append-only chronological log, typed entries | live, session-hook-integrated, deliberate (`kb_add`) or curator-promoted | `provenance.status` (verified/unverified/stale/expired) + decision `status` (proposed/accepted/superseded) |
| **graphify** | derived structural graph, rebuildable | never hand-authored — mechanically extracted from source+docs, disposable like `dist/` | edge `confidence` (EXTRACTED/INFERRED/AMBIGUOUS + numeric score) |
| **OKF** | curated static reference corpus, directory of typed docs | explicit, infrequent, meant to be portable outside any one harness | none built in — producer discipline only ("never fabricate a resource/timestamp you haven't verified") |

This session independently demonstrated why treating these as interchangeable would be a mistake:
graphify's own extraction was found to have real, reproducible correctness bugs this session
(non-deterministic duplicate document nodes across re-extraction runs, ~200 dangling edges from
AST/semantic ID-scheme mismatches) — its INFERRED/AMBIGUOUS output is a good *lead* for a human to
follow, not a safe thing to publish as fact. Meanwhile vfkb already has a working, exactly-fitting
confidence gate for "this is settled enough to be durable": `promoteIfCorroborated`
(`src/curator.ts`, `PROMOTION_THRESHOLD = 2` net corroborating signals) re-stamps an entry
`verified`. **The design problem this RFC solves is making that existing gate the mandatory
checkpoint before anything reaches OKF — not inventing a new one.**

## Decision

Adopt a three-layer model — **Capture → Understand → Publish** — and assign each system to
exactly one layer. Knowledge flows one direction down this stack via explicit, reviewed steps; it
is never hand-authored in parallel in two layers at once.

```
┌─────────────────────────────────────────────────────────────────┐
│ CAPTURE  —  vfkb (.vfkb/entries.jsonl)                           │
│ Live, low-friction, session-integrated. Every fact/decision/     │
│ gotcha/pattern/link is *born* here (kb_add, curator promotion).  │
└───────────────────────────┬───────────────────────────────────────┘
                             │ export, gated on verified+accepted
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ PUBLISH  —  OKF (.okf/, docs/adr/, docs/rfc/)                    │
│ Curated, durable, portable. Zero-tooling readable by any future  │
│ human/agent/harness. Never hand-edited in parallel with vfkb.    │
└───────────────────────────┬───────────────────────────────────────┘
                             │ (source + docs + .okf/, all just files)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ UNDERSTAND  —  graphify (graphify-out/, gitignored, rebuildable) │
│ Read-only, disposable, derived structural index over EVERYTHING  │
│ above (code + vfkb's committed docs + the OKF bundle). Never     │
│ originates knowledge; only computes connectivity from it.        │
└─────────────────────────────────────────────────────────────────┘
```

**The one-way ratchet (the load-bearing rule):** OKF has no confidence field of its own, so
crossing *into* it is where confidence gets *spent*, never laundered. Nothing reaches `.okf/`
below its origin system's highest trust tier — vfkb: `verified` **and**, for decision-family
entries, `accepted` (never `proposed`); graphify: `EXTRACTED` only, and even then only via human
review, never auto-published. A `superseded` decision or a demoted/archived entry does not get
silently deleted from OKF either — it moves to that bundle's `log.md` (OKF's own reserved
convention for a chronological record of updates), so history stays honest instead of vanishing.

### Integration Point 1 — `vfkb export okf` (extends Track 9 Q3, doesn't duplicate it)

Track 9 Q3 ("AGENTS.md export projection", `docs/H4-DEVELOPMENT-ROADMAP.md`) already scopes a
deterministic render target over the existing `renderContext`/`renderContextBundle`
(`src/engine.ts`) — generated-marked, regenerate-on-demand, never auto-committed. Propose Q3's
scope widen to **two render targets sharing one deterministic-projection engine**: the existing
flat `AGENTS.md` (a whole-brain digest for a cold agent with no vfkb integration) and a new
`.okf/` bundle (individually addressable, typed, linkable concept docs for a reader who wants
*one* thing, not the whole brain). These solve adjacent, not identical, problems — see Alternatives.

Field mapping needs no translation layer, because it's already aligned:
- vfkb `EntryType` (`fact`/`decision`/`gotcha`/`pattern`) → OKF `type` directly. OKF's spec is
  explicit that `type` values are producer-chosen, not a fixed enum — vfkb's own type strings are
  valid as-is.
- vfkb `tags` → OKF `tags`. Direct copy.
- vfkb entry text (already includes the `foldWhy()`-folded `Why: …` line — ADR-0013/existing
  behavior) → OKF body. Reuse verbatim; do not re-derive rationale.
- vfkb `refs`/`link`-type entries → OKF cross-links (bundle-root-relative, per OKF's own
  preference).

**Decision-family entries are a near-zero-cost special case, not an export target:** this repo's
ADRs and RFCs are *already* one-file-per-decision, immutable, Nygard-format markdown — 90% of the
way to being OKF concept documents. Rather than duplicating their content into `.okf/`, retrofit
`docs/adr/*.md` and `docs/rfc/*.md` with minimal frontmatter (`type: Decision` / `type: RFC`,
`title`, `status`) so they become a conformant OKF bundle **in place**, with the existing
`docs/adr/README.md` / `docs/rfc/README.md` tables serving the role `index.md` plays in a fresh
bundle. Only entries that never earned their own ADR — curator-promoted facts/gotchas/patterns
living solely in `.vfkb/entries.jsonl` — need an actual generated `.okf/` bundle.

### Integration Point 2 — graphify reads the whole stack, originates nothing

No new code is required for graphify to already benefit from this: it treats any folder of files
as corpus, so once `docs/adr/`/`docs/rfc/` carry OKF frontmatter and `.okf/` exists, a normal
`/graphify` run picks them up as more `document` nodes automatically — closing the loop of "does
our published documentation still match the code" via graphify's own cross-reference and
community-detection output (exactly the kind of question this session's own graphify run answered
for `src/storage.ts::brainDir()`).

Two things this RFC does **not** propose building yet, flagged explicitly as future/gated:
- **Graphify-assisted OKF draft generation** (turning a `graphify explain`/community summary into
  a proposed `.okf/` concept-doc draft) — genuinely useful, but only as a human-reviewed suggestion
  engine, never an auto-publish path. Given this session's own finding that graphify's extraction
  has reproducible non-determinism bugs, feeding its raw output into OKF without the same kind of
  manual dedupe/health-check pass performed this session would reintroduce exactly the
  confidence-laundering problem this RFC exists to prevent.
- **Staleness detection** (periodically re-running graphify and diffing against `.okf/` content to
  flag docs that now describe stale code) — a real and valuable idea, but needs a concrete trigger
  before it's built (this repo's evidence-gated-builds rule), not built speculatively here.

### Integration Point 3 — `link` entries, ships today, zero new code

vfkb already has a `link` `EntryType` that flows through the existing `isInjectable`/
`renderContext` pipeline (`src/engine.ts:513`) into the live session's resume digest and context
bundle. An OKF concept doc's path is just another file path — **today**, with no build required:
`vfkb add link "orders-table concept doc" ".okf/tables/orders.md" --role human` already makes a
live session surface that OKF doc at the right moment. Recommend documenting this explicitly (a
CLAUDE.md line, not code) as the immediate, ship-now half of this RFC, independent of whether/when
Integration Point 1's actual export tooling gets built.

### Related housekeeping (small, uncontroversial, worth doing regardless of this RFC's fate)

`graphify-out/` is currently untracked and **not** in `.gitignore` — it is a derived, rebuildable
artifact exactly like `dist/` (this session alone regenerated it four times with different
content). Recommend adding `graphify-out/` to `.gitignore`, matching `dist/`'s existing precedent.
`GRAPH_REPORT.md` could optionally be committed as a point-in-time architecture snapshot if the
team wants that in history, but the default should be fully gitignored.

## Alternatives Considered

- **Skip OKF, build only Track 9 Q3's flat `AGENTS.md` as already scoped** — rejected as
  insufficient, not wrong: `AGENTS.md` is a whole-brain digest (good for "give a cold agent
  everything at once"); OKF is an addressable directory of individually-linkable typed docs (good
  for "let a reader — human or agent — pull just the one concept they need"). Different shapes,
  not a strict subset of each other. Recommend building both, sequenced, sharing one engine.
- **Have graphify auto-generate OKF bundles directly from its own semantic extraction, skip vfkb
  entirely** — rejected: graphify's node schema (`id`/`label`/`file_type`/`source_file`) has no
  corroboration or verified/unverified concept, and this session directly observed its extraction
  non-determinism. Wiring it straight to a "publish" layer would systematically launder
  INFERRED/AMBIGUOUS structural guesses into flat OKF fact — precisely the anti-pattern
  `CLAUDE.md`'s "VERIFIED = observed, not asserted" rule exists to prevent.
- **Make OKF the primary store; have vfkb read from it instead of `.vfkb/entries.jsonl`** —
  rejected: OKF has no append-only write path, no session hooks, no trust/corroboration model, no
  MCP surface. It is designed to be minimal and static; that is a feature for a *publish* target
  and a disqualifying gap for a live *capture* substrate.
- **Two-way sync — let hand-edits to an exported OKF doc flow back into vfkb** — rejected for now:
  reconciling free-form hand-edits back into a structured, typed, provenance-tracked JSONL is a
  hard sync problem with no evidence yet that anyone needs it. Treat as its own future,
  evidence-gated RFC if a real case shows up, per this repo's own build discipline.

## Definition of Done

This RFC decides the *shape*; it does not commit fully to the build (this repo's evidence-gated-
builds rule). Phased:

- **Phase 0 (near-zero-cost, ship alongside this RFC's acceptance):** add `graphify-out/` to
  `.gitignore`; retrofit `docs/adr/*.md` and `docs/rfc/*.md` with minimal OKF frontmatter; add a
  `CLAUDE.md` line documenting that `link`-type entries may point at `.okf/` docs today. No new
  code, no scenario needed — pure docs/config housekeeping (exempt under ADR-0029).
- **Phase 1 (gated on Track 9 Q3 actually being drafted/built):** `vfkb export okf` as a second
  render target beside `vfkb export agents-md`, sharing Q3's deterministic-projection contract.
  *DoD:* deterministic-projection unit tests (matching Q3's own pattern) + an L4 scenario
  `okf-bundle-cold-agent` — a naive arm (no MCP, no hooks) given only the exported `.okf/` bundle
  answers a seeded project question that a no-bundle contrast arm misses, mirroring Q3's own
  `agents-md-cold-agent` design (ADR-0022/0029: must be able to fail). RED first.
- **Phase 2 (explicitly gated, not committed):** graphify-assisted OKF draft suggestions
  (human-reviewed only) and staleness/drift detection. Needs a concrete trigger — the first project
  that actually hits documentation drift pain, or an explicit request — not built speculatively.

## Open Items

- Should Phase 1 be its own RFC/ADR, or literally fold into whatever RFC eventually drafts Track 9
  Q3 (two render targets, one engine, one DoD pattern)? Leaning toward folding it in — this RFC is
  effectively a scoping pre-read for that eventual RFC — but not pre-decided; left for whoever
  drafts Q3 to reconcile, matching RFC-019's own precedent of leaving a similar fold-or-split
  question open.
- Exact OKF `type:` vocabulary beyond direct reuse of vfkb's `EntryType` strings hasn't been
  checked against how OKF is used in any other, non-vfkb context the operator may already have.
- Whether `docs/adr/README.md` / `docs/rfc/README.md` should be lightly adapted toward OKF's
  `index.md` conventions, or simply left as-is and treated as functionally equivalent — not
  resolved here.
- Phase 2's concrete trigger condition is intentionally left undefined pending real signal, per
  this repo's evidence-gated-build culture.
