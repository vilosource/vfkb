# ADR-0019: vtfkb self-hosts its own design-brain (commit `.vtfkb/`; ADRs link-not-copy)

- **Status:** Accepted
- **Date:** 2026-06-25
- **Deciders:** operator + Claude
- **Origin:** [RFC-004](../rfc/RFC-004-self-hosted-design-brain.md) (accepted on implementation).
- **Applies (does not amend):** [D2c](../DESIGN.md) (per-project brain single-homed at
  `<main-repo>/.vtfkb`) and [D1 constraint 4](../DESIGN.md) (docs integrate via the `link`
  primitive, not by copying content) — to vtfkb's **own** repo. Dogfoods
  [ADR-0001](ADR-0001-record-decisions-as-adrs.md) / [ADR-0004](ADR-0004-decision-is-adr-grade.md);
  bounded by [D1 constraint 2](../DESIGN.md) (git-committed, no secrets) and
  [ADR-0014](ADR-0014-index-freshness.md) (index rebuildable, never committed).

## Context

vtfkb is "the substrate the factory's agents stand on," but it did not stand on itself.
[D2c](../DESIGN.md) **locks** that a project's brain is single-homed and git-committed at
`<main-repo>/.vtfkb`, yet the vtfkb repo committed **no** brain (only a gitignored
`.vtfkb-spike/`). So an agent working on vtfkb could not query the substrate for vtfkb's
own decisions, and vtfkb's native operating knowledge (the relevance-floor bug, the
dogfood check-6 MCP race, the dist/test ordering) lived only in kb journals — with no
agent-consumable home, the exact gap vtfkb exists to close for other projects.

The apparent blocker was a dual-source-of-truth conflict: ADRs are authoritative as
**markdown** ([ADR-0001](ADR-0001-record-decisions-as-adrs.md)), while the product stores
decisions as **JSONL entries**. That conflict was already resolved in the locked design —
[D1 constraint 4](../DESIGN.md): *"`docs/` integrate via the `link` primitive … vtfkb owns
the links/index, not the file content."* The brain links to ADRs; it never copies them.

## Decision

vtfkb adopts its own per-project tier — a committed `.vtfkb/` brain:

1. **Commit `.vtfkb/entries.jsonl` (append-only, `merge=union`) as the brain SoR.** The
   derived index (`index-meta.json`, `.sessions/`) is gitignored and rebuilt on read, never
   committed ([ADR-0014](ADR-0014-index-freshness.md)).
2. **ADRs/RFCs stay markdown SoR; the brain holds a `link` entry per ADR/RFC**
   (repo-relative path in the entry text), never a copied `decision`
   ([D1 constraint 4](../DESIGN.md)). [ADR-0001](ADR-0001-record-decisions-as-adrs.md)'s
   markdown record stays the single authority; nothing to keep in sync.
3. **The brain's `fact`/`gotcha`/`pattern` entries carry only vtfkb-NATIVE knowledge** —
   the operating lessons with no markdown home (the floor bug, the check-6 race, the
   dist/test ordering, the evidence-gated-build and deterministic-backstop patterns).
4. **Seed via the engine's own write path** (`scripts/seed-self-brain.mjs`, the
   `migrate-seed`/`addEntry` mechanism), so self-hosting exercises vtfkb's seed + write +
   no-secrets-lint on itself.
5. **No secrets, low-trust** ([D1 constraint 2](../DESIGN.md)); the existing write-time
   no-secrets lint guards the committed brain.

*Implemented* (this commit): `scripts/seed-self-brain.mjs`, committed
`.vtfkb/entries.jsonl` (22 ADR/RFC links + 10 native entries), `.gitignore` updated to
track the brain SoR while ignoring the rebuildable index.

## Consequences

- **+** vtfkb stands on itself — agents query the substrate for its decisions/gotchas/
  patterns instead of grepping `docs/`. The product thesis is demonstrated on its own repo.
- **+** No dual-SoR drift: markdown ADRs canonical, brain links to them. The only new SoR
  is native JSONL knowledge, which had no other home.
- **+** Continuous dogfood of seed + write + lint + rebuild against a real, growing brain;
  captures operating knowledge that previously evaporated when a journal scrolled past.
- **−** One committed JSONL that grows with the repo and yields `merge=union` diffs on
  writes — exactly the model D2b/D4 designed for.
- **−** A discipline cost: a new ADR/RFC should get a matching `link` entry; native lessons
  must actually be written to accrue value (the H1/H2 write-methodology gap, scoped down to
  "capture what today goes only into a handoff").
- **Neutral:** the global tier (D2a/H3), promotion (D2f), and area model (D2e) are
  untouched — purely the per-project tier applied to one more project (vtfkb itself).

## Alternatives Considered

- **Copy ADRs into the brain as `decision` entries (brain = decision SoR).** Rejected —
  inverts [ADR-0001](ADR-0001-record-decisions-as-adrs.md), fights
  [ADR-0009](ADR-0009-decision-identity-and-numbering.md)'s ordinal-at-merge, and
  contradicts [D1 constraint 4](../DESIGN.md).
- **Dual-write markdown + a parallel `decision` entry with a reconcile test.** Rejected —
  manufactures the dual-SoR drift D1.4 was written to prevent, for no SoR benefit over links.
- **Status quo (no committed brain; read `docs/` directly).** Rejected — vtfkb keeps
  failing to dogfood its own D2c tier and native knowledge keeps evaporating.
- **Commit the index too / keep the brain in `~/.vtfkb`.** Rejected —
  [ADR-0014](ADR-0014-index-freshness.md) (index is derived, never the record); host-home
  is the un-shared spike default, not D2c's `<main-repo>/.vtfkb`.

## Related

[D1](../DESIGN.md) (vtfkb owns links/index to docs not content — c4; git-committed/no-secrets — c2),
[D2b/D2c/D2g](../DESIGN.md) (per-project tier git-local, single-homed, v1 scope),
[ADR-0001](ADR-0001-record-decisions-as-adrs.md) (markdown ADRs authoritative; dogfooding named),
[ADR-0004](ADR-0004-decision-is-adr-grade.md), [ADR-0009](ADR-0009-decision-identity-and-numbering.md)
(ordinal at merge), [ADR-0014](ADR-0014-index-freshness.md) (index rebuildable),
[ADR-0007](ADR-0007-rfc-is-proposed-decision.md), [RFC-004](../rfc/RFC-004-self-hosted-design-brain.md)
(origin). Code: `scripts/seed-self-brain.mjs`, `src/storage.ts` (`brainDir`/`entriesFile`/`indexMeta`),
`.gitignore`, `.vtfkb/entries.jsonl`.
