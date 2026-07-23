---
type: Index
title: "vfkb — Architecture Decision Records"
description: "Index of this project's Architecture Decision Records (Nygard format, immutable once decided — ADR-0001)."
status: living
timestamp: 2026-07-08
---

# vfkb — Architecture Decision Records

Immutable records of significant vfkb architecture decisions, in
[Nygard ADR format](https://asdlc.io/concepts/architecture-decision-record/)
(Title/ID · Status · Context · Decision · Consequences · Alternatives Considered).

**Rules (per ADR-0001):**
- One decision per file; **immutable** — never edit a decided ADR's body. Record a
  follow-on as a **new** ADR: to **replace** it, `Superseded by ADR-XXXX`; to
  **refine** it without replacing (the original still holds, evidence or scope
  changed), `Amended by ADR-XXXX`. The only permitted edit to a decided ADR is this
  one-line status pointer.
- Status lifecycle: `Proposed → Accepted → Amended by ADR-XXXX | Deprecated | Superseded by ADR-XXXX`.
- **That status is the DECISION's lifecycle, never the implementation's.** `Accepted` means
  *we decided this*, not *we built this*. **Do not write build state into an ADR** — no
  "Status honesty" section, no "Decided, NOT yet built". It is mutable state in an immutable
  document, so it rots: ADR-0064 said "NOT yet built" while the journal was shipping to all 12
  consumers, and ADR-0065's single frozen sentence could not describe a decision that ships in
  parts. Correcting them needed an explicit maintainer exception to the immutability rule
  (2026-07-19).
  Build state belongs where it is *allowed* to change — the tracking issue,
  [the roadmap](../H4-DEVELOPMENT-ROADMAP.md), the brain, and machine-derived files like the
  plugin's `DELIVERY-STATUS.json`. Have the ADR **point** there instead:
  `## Build status — tracked in #NNN, not here`.
  Enforced by [`scripts/adr-lint.mjs`](../../scripts/adr-lint.mjs) in CI, because this rule was
  already written here and got skipped three times anyway.
- This log is the **authoritative decision record**; `vfkb-DESIGN.md` is the
  narrative that points into it. The narrative's locked `Dn`/`D-On` decisions
  migrate here over time.

| ID | Title | Status |
|---|---|---|
| [ADR-0001](ADR-0001-record-decisions-as-adrs.md) | Record vfkb architecture decisions as immutable ADRs | Accepted |
| [ADR-0002](ADR-0002-greenfield-reimplementation.md) | vfkb is a greenfield reimplementation; mykb is a studied spike | Accepted |
| [ADR-0003](ADR-0003-language-typescript.md) | Implementation language = TypeScript | Accepted |
| [ADR-0004](ADR-0004-decision-is-adr-grade.md) | `decision` is a first-class, ADR-grade entry type in vfkb | Accepted |
| [ADR-0005](ADR-0005-injection-filters-stale.md) | Auto-injection filters known-stale entries; injects unverified (labeled) | Accepted |
| [ADR-0006](ADR-0006-context-map.md) | Context Map — a derived navigational artifact (v1 = Index/Topology) | Accepted |
| [ADR-0007](ADR-0007-rfc-is-proposed-decision.md) | RFCs are `proposed` decisions, not a new entry type | Accepted |
| [ADR-0008](ADR-0008-constitution-tier.md) | Constitutional rules = flagged decisions + a derived Constitution | Accepted |
| [ADR-0009](ADR-0009-decision-identity-and-numbering.md) | Decision identity = nanoid; ADR ordinal assigned at merge-to-`main` | Accepted |
| [ADR-0010](ADR-0010-product-vision.md) | Product Vision = context-doc narrative + heuristic `pattern`s (no new type) | Accepted |
| [ADR-0011](ADR-0011-envelope-richness.md) | Envelope v1 adopts validity window + structured provenance origin; trust is derived (D-A) | Accepted |
| [ADR-0012](ADR-0012-two-stage-retrieval.md) | Two-stage retrieval; v1 ships Heuristic reranker (default); Stage-1 narrowing right-sized for per-project (D-B) | Accepted (Amended by ADR-0016) |
| [ADR-0013](ADR-0013-no-hard-native-dep.md) | No hard native dep; pluggable `Index`, pure-JS in-memory default, SQLite/FTS5 optional (D-C) | Accepted |
| [ADR-0014](ADR-0014-index-freshness.md) | Index freshness = content-derived token + explicit rebuild, never mtime (D-D) | Accepted |
| [ADR-0015](ADR-0015-cross-harness-auto-layer.md) | Cross-harness auto-layer = tiered parity; per-turn push Pi-only on Claude Code; narrowed Phase 0 spike (D-E) | Accepted |
| [ADR-0016](ADR-0016-search-ranking-and-embedding-revisit.md) | Explicit search is relevance-primary; EmbeddingReranker un-deferred to Planned-pending-verification (amends ADR-0012) | Accepted (Amended by ADR-0017, ADR-0018) |
| [ADR-0017](ADR-0017-search-relevance-floor.md) | Explicit search applies a relative relevance floor (distinct query-term ratio; default 1/3); amends ADR-0016 | Accepted |
| [ADR-0018](ADR-0018-honest-no-match-contract.md) | Search reports a cause-distinguished honest no-match (empty_topic/no_match/all_filtered); amends ADR-0016 | Accepted |
| [ADR-0019](ADR-0019-self-hosted-design-brain.md) | vfkb self-hosts its own design-brain (commit `.vfkb/`; ADRs link-not-copy); applies D2c + D1.4 to vfkb's repo | Accepted |
| [ADR-0020](ADR-0020-session-continuity-record.md) | Session continuity = a derived, append-only knowledge-continuity record (vfkb's half of the vtf/vfkb seam) | Accepted (build sequenced) |
| [ADR-0021](ADR-0021-auto-distill-and-curator.md) | Auto-distill + ACE curator — capture distils to `incoming`; curation is deltas + counters, never rewrites | Accepted (Amended by ADR-0024) |
| [ADR-0022](ADR-0022-l4-evaluation-methodology.md) | L4 evaluation methodology = dockerized, reproducible, contrast-based, multi-trial, dual-harness (self-contained images) | Accepted (build sequenced) |
| [ADR-0023](ADR-0023-scenario-contract-first.md) | Agent-observable features are scenario-contract-first — the L4 scenario is the DoD, run RED before implementation (invariants stay unit tests) | Accepted |
| [ADR-0024](ADR-0024-relabel-trust-on-promotion.md) | Corroborated promotion re-stamps provenance verified (trust elevation is agent-observable); distiller stops baking "(unverified)" into text | Accepted |
| [ADR-0025](ADR-0025-project-context-doc-and-kb-context.md) | The project context doc + `kb_context` — an assembled "agent's first read" (authored spine + derived Constitution/Map/decisions), read on demand | Accepted |
| [ADR-0026](ADR-0026-rebrand-to-vfkb.md) | Rebrand vtfkb → vfkb (ViloForge KnowledgeBase) — full hard rename (identity/env/dirs/repo) to align the VF-family with vfwb | Accepted |
| [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md) | Reliable decision capture — a conditional end-of-turn (Stop-hook) reminder | Accepted |
| [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) | Auto-layer wiring is validated in a throwaway sandbox before promotion to live (the wiring smoke-gate) | Superseded by [ADR-0048](ADR-0048-retire-wiring-smoke-gate.md) |
| [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) | Definition of Done — a capability is proven by an agent-driven, sandboxed, e2e use-case simulation that can fail | Accepted |
| [ADR-0030](ADR-0030-consumer-integration-and-distribution.md) | Consumer integration & distribution contract — portable engine (`$VFKB_HOME` + single-file bundles), `vfkb init`, `import`, `doctor` | Accepted |
| [ADR-0031](ADR-0031-bootstrap-engine-resolution-guard.md) | A committed bootstrap guards engine resolution and informs the user when `$VFKB_BUNDLE_DIR` is unset | Accepted |
| [ADR-0032](ADR-0032-env-var-rename-data-dir-bundle-dir.md) | Rename env vars for clarity — `VFKB_DATA_DIR` (brain) + `VFKB_BUNDLE_DIR` (engine); old names kept as deprecated aliases | Accepted |
| [ADR-0033](ADR-0033-session-end-continuity.md) | Session-end continuity — a `SessionEnd` brain auto-commit (GAP 2; branch-guarded, pathspec-scoped) + a deterministic B2 handoff floor (GAP 1); B1 nudge open | Accepted |
| [ADR-0034](ADR-0034-b1-handoff-nudge.md) | GAP-1 B1 — the agent-authored handoff nudge (settles RFC-011 §B) | Accepted |
| [ADR-0035](ADR-0035-hooks-anchor-to-project-dir.md) | `vfkb init` anchors the Claude Code hooks to `$CLAUDE_PROJECT_DIR` | Accepted |
| [ADR-0036](ADR-0036-v2-two-branch-strategy.md) | v2 development uses a dedicated long-lived `v2` branch; `main` stays release-only | Accepted |
| [ADR-0037](ADR-0037-contradiction-surfacing-at-write.md) | Deterministic contradiction surfacing at write time — conflict candidates in the add result, never blocking (accepts RFC-012) | Accepted |
| [ADR-0038](ADR-0038-cross-project-brain-query.md) | Cross-project brain query — read-only, provenance-labeled recall from a registered sibling `.vfkb` (accepts RFC-013) | Accepted |
| [ADR-0039](ADR-0039-session-backbone.md) | v2 session backbone — real session identity from hook stdin, entry attribution (accepts RFC-014; `--resume` id-stability precondition verified live) | Accepted |
| [ADR-0040](ADR-0040-native-concurrency-lock.md) | A vfkb-native advisory lock scoped to the read-decide-append critical section (accepts RFC-015) | Accepted |
| [ADR-0041](ADR-0041-entries-jsonl-merge-union.md) | `entries.jsonl` merges via built-in `merge=union`; custom driver deferred (accepts RFC-016 as revised) | Accepted |
| [ADR-0042](ADR-0042-schema-honesty.md) | Schema honesty — structural `why`, read-boundary envelope validation, `contradicts` field (accepts RFC-017) | Accepted |
| [ADR-0043](ADR-0043-rebuildable-index-shape.md) | Rebuildable index — shape ratified, build evidence-gated (accepts RFC-018; trigger settled) | Accepted (build gated) |
| [ADR-0044](ADR-0044-storage-backend-abstraction.md) | A pluggable storage-backend interface; JSONL stays the shipped default (accepts RFC-019) | Accepted |
| [ADR-0045](ADR-0045-vfkb-claude-code-plugin.md) | vfkb ships as a Claude Code plugin from a dedicated repo (`vfkb-claude-plugin`) — primary distribution for the Claude Code harness face (accepts RFC-021) | Accepted |
| [ADR-0046](ADR-0046-layered-knowledge-capture-understand-publish.md) | Layered knowledge management — vfkb captures, graphify understands, OKF publishes; one-way trust ratchet with deterministic Brakes (accepts RFC-020) | Accepted (Phase 1 gated on Q3) |
| [ADR-0047](ADR-0047-brain-export-projections.md) | Brain export projections — `vfkb export agents-md` + `vfkb export okf`, pure-function-of-the-brain determinism, ratchet as publish filter (accepts RFC-022) | Accepted — **built 2026-07-08**, both L4s DEMONSTRATED |
| [ADR-0048](ADR-0048-retire-wiring-smoke-gate.md) | Retire the in-repo wiring smoke gate — premise ended with the plugin migration; relocated check deferred to vfkb-claude-plugin#6 (supersedes ADR-0028) | Accepted |
| [ADR-0049](ADR-0049-session-start-handoff-pinning.md) | Session-start briefing — deterministic handoff pinning + an on-demand, Haiku-pinned briefing skill (accepts RFC-023) | Accepted |
| [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) | The sandboxed agent-driven L4 Definition of Done is constitutional and mechanically enforced (amends ADR-0029) | Accepted (Amended by ADR-0051) |
| [ADR-0051](ADR-0051-delivery-honesty.md) | Delivery is a capability, it is unproven, and saying so is mechanically enforced (amends ADR-0050; accepts RFC-024) | Accepted |
| [ADR-0052](ADR-0052-review-gate.md) | The adversarial review of every implementation change is mechanically enforced | Accepted |
| [ADR-0053](ADR-0053-going-public-sequencing.md) | Going public — the five-workstream sequencing (umbrella; accepts RFC-025) | Accepted |
| [ADR-0054](ADR-0054-pre-public-disclosure-gate.md) | The pre-public disclosure gate — audit + explicit exposure rulings before the visibility flip (accepts RFC-026) | Accepted |
| [ADR-0055](ADR-0055-public-ci-and-community-hygiene.md) | Public CI (test.yml required Brake, can-fail-proven) + community hygiene files (accepts RFC-027) | Accepted |
| [ADR-0056](ADR-0056-versioning-and-release-automation.md) | Versioning + release automation via release-please — the release is a reviewable PR (accepts RFC-028) | Accepted |
| [ADR-0057](ADR-0057-npm-delivery-channel.md) | The npm delivery channel — trusted publishing behind a pack-based install proof, born delivery-proven (accepts RFC-029) | Accepted |
| [ADR-0058](ADR-0058-update-awareness.md) | Update awareness — GitHub Releases canonical + opt-in doctor --check-remote npm currency; no phone-home (accepts RFC-030) | Accepted |
| [ADR-0059](ADR-0059-inactive-signal-guard.md) | Restore the 'vfkb INACTIVE' signal under plugin wiring — a deterministic, engine-free repo-side guard (accepts RFC-032) | Accepted |
| [ADR-0060](ADR-0060-plugin-release-tagging.md) | Tag every plugin release `vfkb--v{version}` — durable version refs (unblocks the install-path delivery L4) | Accepted |
| [ADR-0061](ADR-0061-plugin-release-version-automation.md) | Enforce bump-and-tag mechanically — a version Brake plus tag-on-merge (release-please rejected) | Accepted |
| [ADR-0062](ADR-0062-engine-delivery-signal.md) | Engine changes surface automatically as a ready-to-prove plugin release PR — producer-side automation over a normalized-bundle drift signal | Accepted |
| [ADR-0063](ADR-0063-cross-repo-brain-write.md) | Cross-repo brain write — read the target's brain first, then one deliberate `cross-repo` record per operation, delivered via a second pinned section (accepts RFC-033) | Accepted |
| [ADR-0064](ADR-0064-durable-capture-journal.md) | Durable capture — untracked write-ahead journal + `(id, updated)`-pair recovery closes the brain-loss window between write and commit (accepts RFC-034) | Accepted |
| [ADR-0065](ADR-0065-write-health-loudness.md) | Write-health loudness — probe-first: silent MCP-disconnect must never look like successful capture (accepts RFC-035) | Accepted |
| [ADR-0066](ADR-0066-pi-package-delivery.md) | The pi face ships as a package, not a path — separate `vfkb-pi-package` repo, git-only, vfkb's own MCP bridge kept, install-path L4 with an AGENTS.md-only contrast arm (accepts RFC-037) | Accepted |
