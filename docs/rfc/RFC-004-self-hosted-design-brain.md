# RFC-004: vfkb self-hosts its own design-brain (commit `.vfkb/`; ADRs link-not-copy)

- **Status:** Accepted → [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md)
- **Date:** 2026-06-25
- **Deciders:** operator + Claude (accepted on implementation)
- **Refines (on acceptance):** applies [D2c](../DESIGN.md) (brain single-homed at
  `<main-repo>/.vfkb`) and [D1 constraint 4](../DESIGN.md) (docs integrate via the
  `link` primitive, not by copying content) **to vfkb's own repo**. Dogfoods
  [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) /
  [ADR-0004](../adr/ADR-0004-decision-is-adr-grade.md). Bounded by
  [D1 constraint 2](../DESIGN.md) (git-committed, no secrets) and
  [ADR-0014](../adr/ADR-0014-index-freshness.md) (index is rebuildable, never committed).

## Context

vfkb's stated identity is "the shared memory the other three products' agents stand
on" (STATUS-AND-ROADMAP §1) and "the substrate the ingest agents stand on." Yet **vfkb
does not stand on itself.** The per-project tier (v1, built and green) is the engine for
exactly this use case, and [D2c](../DESIGN.md) **locks** that a project's brain is
single-homed and git-committed at `<main-repo>/.vfkb`. The vfkb repo has **no committed
`.vfkb/`** — only `.vfkb-spike/`, which `.gitignore` discards as a throwaway. So:

- An agent (human or LLM) working **on** vfkb cannot query vfkb-the-substrate for
  vfkb's own decisions, gotchas, or patterns. It must read `docs/` by hand.
- vfkb's hard-won **native operating knowledge** — the relevance-floor bug
  ([ADR-0016](../adr/ADR-0016-search-ranking-and-embedding-revisit.md)), the dogfood
  check-6 MCP cold-start race, the "dist is gitignored; `npm test` rebuilds first"
  gotcha, the `merge=union` write discipline — lives only in kb journals/handoffs and
  commit messages. It has **no agent-consumable home**, which is precisely the gap vfkb
  exists to close for *other* projects.
- vfkb therefore fails to dogfood its own D2c / per-project tier — the same dogfooding
  [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) already names as a value.

**The blocker that has kept this open is an apparent dual-source-of-truth conflict.**
[ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) makes the **markdown ADRs in
`docs/adr/` the authoritative decision record** (immutable Nygard records, ordinal stamped
at merge per [ADR-0009](../adr/ADR-0009-decision-identity-and-numbering.md)). The product,
meanwhile, stores decisions as **JSONL `decision` entries**. Committing both invites
drift: which is canonical, and who keeps them in sync?

**That conflict is already resolved in the locked design.** [D1 constraint 4](../DESIGN.md):
*"`docs/` integrate via the `link` primitive (extended to repo-relative paths). vfkb owns
the links/index, **not the file content**."* The D1 ownership table is explicit: vfkb holds
*"links/index to `docs/` (the docs themselves are repo files)."* The design never intended
ADRs to be **copied** into the brain as decision entries — the markdown stays SoR, and the
brain holds **`link` entries** that point at the repo-relative ADR paths. No second copy,
no drift surface.

## Decision

vfkb adopts its **own per-project tier**: a committed `.vfkb/` brain in the vfkb repo,
populated and maintained so the substrate serves vfkb's own knowledge.

1. **Commit `.vfkb/entries.jsonl` (+ the project context doc); keep the index out.**
   The append-only JSONL is the source-of-truth for the brain's *native* entries and is
   `merge=union`-friendly (D2b / D1 constraint 2). The derived index (`index-meta.json`,
   `.sessions/`, any FTS db) stays **gitignored and rebuilt** on read — content-hash
   freshness, never committed ([ADR-0014](../adr/ADR-0014-index-freshness.md)). `.gitignore`
   changes from blanket-ignoring the brain to ignoring only the rebuildable index artifacts.

2. **ADRs/RFCs stay markdown SoR; the brain holds `link` entries, not copies**
   ([D1 constraint 4](../DESIGN.md)). Each ADR/RFC is represented by one `link` entry whose
   target is its repo-relative path (`docs/adr/ADR-00NN-….md`). The decision *content* is
   never duplicated into a `decision` entry — so [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md)'s
   markdown record stays the single authority and there is nothing to keep in sync.

3. **The brain's `decision`/`fact`/`gotcha`/`pattern` entries carry only vfkb's
   *native* knowledge** — the operating lessons that have no markdown home today
   (the floor bug, the check-6 race, the dist/test ordering, write-discipline patterns).
   This is the knowledge an agent working on vfkb actually needs and currently cannot get
   from the substrate.

4. **Seed from the existing engine path, not by hand.** The brain is populated via the
   engine's own write API / the `migrate-seed` mechanism (`VFKB_SEED_AREAS`,
   commit `1143fb8`) so the act of self-hosting exercises vfkb's own seed + write +
   no-secrets-lint path on itself — extra dogfood coverage for free.

5. **No secrets, low-trust** ([D1 constraint 2](../DESIGN.md)). The committed brain holds
   knowledge and secret *references* only; the existing write-time no-secrets lint guards
   it. vfkb's design corpus has no secrets, so this is satisfied by construction.

6. **Proposed, not speculative — but cheap and directly actionable.** Per
   [ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md) this is a proposed decision with
   an open comment period. Unlike [RFC-003](RFC-003-embedding-accuracy-mode.md) (genuinely
   evidence-gated), the build here is small, low-risk H0/H4 hygiene; recommendation is to
   **accept and build** (commit the brain + seed the native entries + the ADR/RFC link
   index), then let the substrate accrue vfkb's knowledge from here forward.

## Consequences

- **+** vfkb finally **stands on itself** — agents working on vfkb query the substrate
  for its decisions/gotchas/patterns instead of grepping `docs/`. The product's central
  claim ("turns one-shot agents into a team with a memory") is demonstrated on its own repo.
- **+** **No dual-SoR drift.** Markdown ADRs remain canonical; the brain links to them
  (D1.4). The only new SoR is the *native* JSONL knowledge, which has no other home anyway.
- **+** Self-hosting exercises seed + write + lint + rebuild on a real, growing brain —
  continuous dogfood beyond the spike harness; regressions surface against vfkb's own data.
- **+** Captures operating knowledge that is currently **lost** the moment a kb journal
  scrolls past — making it agent-consumable, which is the whole product thesis.
- **−** One committed JSONL file that grows with the repo and produces `merge=union` diffs
  on knowledge writes. Accepted — append-only + union is exactly the model D2b/D4 designed
  for, and ADR markdown already produces commits per decision.
- **−** A discipline cost: native lessons must actually be *written* into the brain to
  accrue value (the same write-methodology gap H1/H2 already track). Mitigated — the bar is
  "capture what today goes only into a handoff," not new ceremony.
- **Neutral:** the global tier (D2a/H3), promotion (D2f), and area model (D2e) are
  untouched — this is purely the per-project tier applied to one more project (vfkb itself).

## Alternatives Considered

- **Copy ADRs into the brain as `decision` entries (brain = decision SoR), generate the
  markdown from the brain.** Rejected — inverts [ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md)'s
  human-authored Nygard record, fights [ADR-0009](../adr/ADR-0009-decision-identity-and-numbering.md)'s
  engine-owns-the-ordinal-at-merge, and directly contradicts [D1 constraint 4](../DESIGN.md)
  (links, not content). The whole point of D1.4 was to avoid this.
- **Dual-write: author ADR markdown *and* a parallel `decision` entry, with a reconcile
  test.** Rejected — manufactures the exact dual-SoR drift D1.4 was written to prevent, and
  buys a maintenance burden for no source-of-truth benefit over the link model.
- **Status quo — no committed brain; agents read `docs/` directly.** Rejected — vfkb keeps
  failing to dogfood its own D2c per-project tier, native operating knowledge keeps
  evaporating into journals, and "the substrate the factory stands on" cannot serve its own
  project. The gap this RFC names stays open.
- **Commit the index too (not just JSONL).** Rejected — violates
  [ADR-0014](../adr/ADR-0014-index-freshness.md) (index is derived, content-hash-rebuilt,
  never the record) and would produce noisy, conflict-prone binary/db diffs.
- **Keep it in `~/.vfkb` (host home), uncommitted.** Rejected — that is the spike default;
  it is not shared, not reviewable, not version-controlled, and not what D2c specifies
  (`<main-repo>/.vfkb`). It cannot serve a *team* (or the next session) memory.

## Related

[D1](../DESIGN.md) (scope: vfkb owns links/index to docs, not content — constraint 4;
git-committed/no-secrets — constraint 2), [D2b/D2c/D2g](../DESIGN.md) (per-project tier is
git-repo-local, single-homed at `<main-repo>/.vfkb`, the v1 scope),
[ADR-0001](../adr/ADR-0001-record-decisions-as-adrs.md) (markdown ADRs are the authoritative
decision record; dogfooding named as a value),
[ADR-0004](../adr/ADR-0004-decision-is-adr-grade.md) (the ADR-grade decision capability),
[ADR-0009](../adr/ADR-0009-decision-identity-and-numbering.md) (ordinal at merge),
[ADR-0014](../adr/ADR-0014-index-freshness.md) (index is rebuildable, not committed),
[ADR-0007](../adr/ADR-0007-rfc-is-proposed-decision.md) (this RFC's own status model).
Code: `src/storage.ts` (`brainDir`, `entriesFile`, `indexMeta`), `spike/devops-kb/migrate-seed.mjs`
+ `VFKB_SEED_AREAS` (commit `1143fb8`), `.gitignore` (currently discards `.vfkb-spike/`).
