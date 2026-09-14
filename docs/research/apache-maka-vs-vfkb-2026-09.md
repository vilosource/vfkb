# Apache Maka (Incubating) vs vfkb — September 2026

> **Research comparison.** Prompted by a report that Maka is "similar to what we
> are trying to do with vfkb". It tests that premise rather than assuming it.
> Companion to [`agent-memory-landscape-2026-07.md`](agent-memory-landscape-2026-07.md),
> which surveyed the memory-product field; this one examines a single adjacent
> project in depth.
>
> **Verification discipline.** Maka was cloned and read at `main`, 2026-09-14;
> every substantive claim cites a path in that tree. Claims are from source and
> committed docs, **not** the README's marketing surface.
>
> Provenance, stated because this repo's rule is that relayed evidence is not a
> conclusion: the reading was done by a research agent. The maintainer
> independently verified the repo's existence and metadata, and spot-checked the
> two claims the verdict rests on — `searchByKeys` having no caller outside the
> storage layer and its tests, and the FTS5 ban at
> `packages/core/src/thread-search.ts:55`. Both held. The remaining file:line
> citations are the agent's reads, not re-verified line by line.
>
> **One relayed claim did NOT survive checking**, and the correction is kept
> visible in §4 rather than quietly applied: the agent reported that vfkb "has no
> pointer to evidence." It has one — `ProvenanceOrigin`, ADR-0011 — written but
> never exposed or read. That changes a headline Maka advantage from "has the
> concept vs lacks it" to "wired vs specified-and-dormant", and it changes the
> top learning from *add a field* to *consume the field you already specified*.
> Both schemas in §3b were read by the maintainer directly for that reason.
>
> **Maka was not built or run.** Nothing here is a behavioural observation.

---

## 1. Verdict

**Maka is a harness. vfkb is a substrate. They compose rather than compete, and
vfkb is not redundant.**

Maka is an **agent runtime** — Electron app, TUI, CLI and benchmark rig that runs
the agent loop. It competes with Claude Code and Codex, and benchmarks itself
against both (`docs/eval/`). Its headline claim, *"a complete record of everything
it did,"* means a **session transcript**: an append-only `RuntimeEvent` ledger —
precisely what vfkb's README says vfkb is *not*. At the level the premise was
offered, it is a category error.

**But the premise is right at a level nobody mentioned.** Buried inside Maka is a
curated project-memory subsystem (`packages/core/src/long-term-memory.ts`,
`packages/storage/src/sqlite-long-term-memory-store.ts`,
`packages/runtime/src/memory-extraction.ts`) that *is* attacking vfkb's problem.
That subsystem — not Maka-the-harness — is the real comparison, and it is where
the learnings are.

On that comparison vfkb leads: no decision type, no rationale field, no supersede
chain, no constitutional tier, no honest no-match, and it lives in Electron
`userData` rather than the repo. Its shipping layer is a single `MEMORY.md`; the
richer typed tier is **write-complete and read-dead**.

**Is vfkb redundant? No.** Adopting Maka means replacing Claude Code, not
replacing vfkb. The star count (5,374 on a four-month-old podling) is attention,
not evidence: **no Apache release yet**, software grant and committer ICLAs
incomplete (`DISCLAIMER-WIP`), root `package.json` at `0.2.0`, all workspace
packages `private: true`, npm `latest` for the CLI a `0.0.0-alpha.0` stub.

**The honest competitive concern** is not replacement. It is that Maka is
building vfkb's feature set *inside its own harness* — and a harness with native
memory does not reach for an external one. That argues for moving on the
learnings below, not for stopping.

---

## 2. What Maka is

11-workspace TypeScript monorepo; Electron + TUI + CLI + eval rig + a Rust native
addon. 4,590 commits, 127 authors, first commit 2026-05-20 — four months old at
high velocity, though the top three authors account for ~61% of commits.
Apache-2.0, incubating.

**Spine** (`ARCHITECTURE.md`): `Desktop / TUI / CLI → Runtime Host →
SessionManager → AgentRun → Tool Runtime → Runtime Event Log → projections`.

**The event ledger.** `packages/core/src/runtime-event.ts` (1,606 lines,
hand-rolled interfaces, no Zod). Discrimination via `content.kind` — `text |
thinking | function_call | function_response | error | system_note |
invocation_opened`. The governing claim
(`docs/architecture/runtime-core-architecture-draft.md:67`): *"The Runtime Event
Log is the semantic source of truth… System state at a point in time is a
projection over that ordered log."*

**Persistence.** SQLite via `node:sqlite`, under
`~/Library/Application Support/Maka` (`packages/storage/src/workspace-root.ts`).
`runtime.sqlite`, `memory.sqlite`, `context-offload.sqlite`. **Nothing lands in
the user's repo** — the root `.gitignore` has zero `maka` entries because there is
nothing to ignore. The only project-tree convention is `<cwd>/.maka/skills/`.

**Append-only, enforced structurally.**
`packages/storage/src/sqlite-runtime-store.ts` contains exactly one ledger write —
`INSERT INTO runtime_events` at line 4002 — and **no `UPDATE` or `DELETE`** in
production storage code. Post-terminal appends throw `RunSealedError`, and
`packages/core/src/runtime-event-store.ts` states that a test double skipping it
*"is manufacturing a ledger no supported store can produce."*

**Read path is replay, not retrieval.** Compaction writes its checkpoint back *as
a RuntimeEvent*: *"compaction is projection, not mutation"*
(`docs/architecture/llm-compaction-events-log-projection-draft.md`).

**No hooks.** `PreToolUse|PostToolUse|SessionStart|UserPromptSubmit` returns zero
across the repo. Extension is an in-process Cordis-style plugin kernel
(`packages/runtime/src/plugin-kernel.ts`) with host-guarded service bindings.

**MEMORY.md — what actually ships.** `packages/core/src/local-memory.ts:21` is
explicit: *"V0.1 describes one user-visible Markdown file. It does not implement
hidden durable memory, extraction, embeddings, recall, or agent tools."* It is
nonetheless structured — `origin`, `status`, `scope`, `tags`, `approvedBy`,
`decayTtlMs` — and reaches the model via
`packages/runtime-host/src/server/interactive-run-composer.ts:773`, wrapped as
*"Local Memory (user-authorized, untrusted context…)"*. Agent read is **off by
default**.

**`memory.sqlite` — the unwired tier.** `MemoryItem` carries `kind`
(preference/identity/context/knowledge/**failure**/note), `statementType`,
`temporalType` with event/observed timestamps, `scopeType`, `lifecycleState`,
`origin`, `version`, `contentHash`; plus `MemoryItemKey` (keyType, keyOrigin
**deterministic/llm/user**) and `MemoryItemSource`. Agent write tools
`memory_remember` / `memory_extract` exist with an LLM proposal pipeline.

**Nothing reads it.** `searchByKeys` — the only query API
(`packages/core/src/long-term-memory.ts:331`) — has no caller outside the storage
layer's own wrapper (`packages/storage/src/long-term-memory-store.ts:157`) and its
tests. *Maintainer-verified.* The module header confirms the staging: MEMORY.md
*"remains a separate legacy product surface while the automatic memory lifecycle
is introduced incrementally."*

---

## 3. Comparison

**Problem solved.** vfkb preserves **engineering judgment** — typed, deliberate,
with rationale and lifecycle. Maka preserves **execution history**. Near-opposites.
Maka's memory tier is a third thing: its vocabulary (`preference`, `identity`,
`failure`, auto-extracted from conversation) is **personalization-flavoured**,
closer to mem0/Zep than to vfkb.

| | Maka memory tier | vfkb |
|---|---|---|
| Store | SQLite in Electron `userData` | JSONL in the repo (ADR-0019) |
| Travels with a clone | No | Yes |
| Diffable / branchable / PR-reviewed | No | Yes, `merge=union` (ADR-0041) |
| Mutability | `update` with `expectedVersion` CAS — mutable, versioned | Decisions immutable, supersede-only |
| Retrieval | key-overlap query — **built, dead code** | deterministic injection + on-demand search |
| Honest no-match | none | `empty_topic` / `no_match` / `all_filtered` |
| Durability caveat | *"an upgraded workspace can show empty threads"* | journal-first WAL + recovery (ADR-0064) |

**Trust.** Maka: 2-valued `origin` (agent_extracted/user_requested). vfkb:
3-valued derived trust × 4-state provenance, with trust **derived from role**,
never self-declared. Maka has **no decision concept** — grepping `decision` yields
only `ModelRetryDecision`, `permissionDecision`, `CompactionDecision`. No `why`.

**Injection.** vfkb renders constitution → pinned handoff → cross-repo → map →
ranked entries into a 10,000-char budget, filtering archived/superseded/stale
*before* the agent sees anything. Maka's shipping path is flat-file injection of
`AGENTS.md`/`CLAUDE.md`/`GEMINI.md` plus the MEMORY.md projection — the same
baseline vfkb's README already compares against.

**The anti-embeddings convergence — the most interesting finding.**
`embedding|vector|cosine|sqlite-vec|fts5` across all packages returns **only
incidental hits** (Unicode bidi, IPv6, AES IVs, a cursor animation's `Math.cos`).
Maka does not merely lack semantic retrieval — it **bans the lexical index too**:
`packages/core/src/thread-search.ts:55` lists *"Hard no-go (enforced by source
gate at review): … No FTS5 / SQLite / better-sqlite3."* *Maintainer-verified.*

Two independent projects, one with 127 contributors and an ASF podling behind it,
refused embeddings **and** full-text indexing for agent memory, both landing on
term-overlap-plus-recency. vfkb's RFC-003/S1 gate looks **well-judged rather than
merely stubborn** — external corroboration of a bet held on faith.

**Evidence discipline.** Maka publishes adversarial benchmarks against an
**external** verifier (Terminal-Bench 2.1, official scorer) including results
where Maka *loses* — Codex 82.0%, Maka 77.5%, Claude Code last. vfkb has 14 L4
harnesses, 32 committed records, dual-harness, ≥2/3 DEMONSTRATED with contrast
arms. Maka's are more externally credible; vfkb's measure *causation* rather than
aggregate task completion. Maka has **no ADR practice** — four unnumbered decision
files, no index, no template.

Notably, Maka encodes vfkb's ADR-0051 honesty rule as prose in a skill: *"Never
present an unverified design assumption as current implementation."* vfkb enforces
the same rule with a CI brake.

---

## 3b. Feature matrix — memory substrate only, harness stripped

Maka-the-harness is not comparable to vfkb; this section removes it and compares
the two knowledge substrates like for like. Both schemas were read directly
(`packages/core/src/long-term-memory.ts` and `src/types.ts`). `▲` marks a
meaningful lead.

### Knowledge model

| | Maka memory tier | vfkb |
|---|---|---|
| Taxonomy | `preference · identity · context · knowledge · failure · note` | `fact · decision · gotcha · pattern · link` ▲ |
| Orientation | **personalization** — who the user is, what they prefer | **engineering judgment** — what the project decided |
| Rationale (`why`) | **zero occurrences** in the schema | first-class field (`src/types.ts:83`) ▲ |
| Statement type | `fact · plan · prediction` ▲ | none |
| Decision concept | none | `proposed → accepted → deprecated → superseded` ▲ |
| Constitutional tier | none | `constitutional` flag, pinned every session ▲ |
| Contradiction edges | none | `contradicts[]` (ADR-0042 §3) ▲ |

The taxonomies barely overlap. Maka's `failure` has no vfkb analogue; vfkb's
`decision` has no Maka analogue — and "what was decided and why" is vfkb's entire
premise.

### Trust and provenance

| | Maka | vfkb |
|---|---|---|
| Origin | 2-valued: `agent_extracted · user_requested` | 7 author roles → 3-valued derived trust ▲ |
| Trust derivation | self-declared at write | **derived from role**, never self-declared ▲ |
| Provenance state | none | `verified · unverified · stale · expired` ▲ |
| Evidence pointer | `memory_item_sources` FK → exact event ▲ | `ProvenanceOrigin` — exists, **unexposed, unread** |
| Key provenance | `deterministic · llm · user`, per key ▲ | none |

### Lifecycle and mutation

| | Maka | vfkb |
|---|---|---|
| Mutation model | `create · update · archive · restore`, CAS on `expectedVersion` | append-only; decisions **immutable, supersede-only** ▲ |
| Lifecycle states | `active · archived` | `incoming · established · archive` + 4 decision statuses ▲ |
| History of belief | version bump — **loses what you used to think** | supersede chain preserves it ▲ |
| Temporal model | `undated · point · interval · open_ended`, validated at commit ▲ | fields stored, **never read** |

### Retrieval and injection

| | Maka | vfkb |
|---|---|---|
| Query | key-overlap, exact/prefix, ranked by distinct terms then recency | stemmed term-overlap, ⅓ relevance floor ▲ |
| **Wired?** | **no production caller** | shipping ▲ |
| Keys | pre-extracted at write, typed ▲ | computed at read |
| Injection | flat `MEMORY.md`, agent read **off by default** | ranked bundle, budgeted, filtered pre-injection ▲ |
| Stale filtering | archived only | archived + superseded + deprecated + stale + expired ▲ |
| Honest no-match | none | `empty_topic · no_match · all_filtered` ▲ |
| Embeddings / FTS | **banned at review gate** | not built, RFC-003 gated — *convergent* |

### Storage

| | Maka | vfkb |
|---|---|---|
| Location | SQLite in Electron `userData` | JSONL **in the repo** ▲ |
| Travels with clone / branches / PR-reviewable | no | yes ▲ |
| Append-only enforced | **in the data layer** — `INSERT`-only, `RunSealedError` ▲ | hook + convention, outside the data |
| Concurrency | CAS + idempotency receipts ▲ | lockfile + last-write-wins |
| Crash durability | SQLite | journal-first WAL + recovery (ADR-0064) — comparable |

**Reading the matrix.** vfkb leads on everything that makes knowledge *judgment*
— types, rationale, decision lifecycle, trust derivation, honest failure — and on
being repo-native. Maka leads on everything that makes storage *rigorous* —
structural append-only, CAS, evidence FKs, consumed temporal modelling — and on
having wired its retrieval. The split is not accidental: vfkb was designed by
people arguing about decisions, Maka by people building a durable event store.

---

## 4. Where Maka is genuinely better

1. **Evidence citations as a hard foreign key.** Every proposed item carries 1–8
   `{sourceRef, quote}` citations, and `memory_item_sources(item_id, session_id,
   run_id, turn_id, event_id)` is an FK from each curated claim back to the exact
   event that produced it. A database-level invariant, not an advisory field.

   **Correction to an earlier draft of this note**, which said vfkb "has no
   pointer to evidence." **It has one.** `ProvenanceOrigin`
   (`src/types.ts`, ADR-0011) supports `{kind:'commit', repo, sha, path, line}`,
   `message`, `tool_call` and `manual`. It is *written* — `src/distiller.ts:100`
   and capture at `src/engine.ts:835` — but exposed by **neither** `kb_add` (zero
   mentions in `src/mcp-server.ts`) **nor** the CLI (`add` accepts `--role`,
   `--tag`, `--why`, `--contradicts`, `--status`, `--prov-status`,
   `--valid-until`, `--zone`, `--constitutional` and nothing else), and it is read
   nowhere. *Maintainer-verified.* So Maka's lead here is narrower than stated:
   not "has the concept vs lacks it", but **"wired vs specified-and-dormant."**
2. **Append-only enforced in the data layer**, not by a hook outside it — which
   ADR-0070 ("guards that can fail") already flags as the weaker shape.
3. **Bi-temporal modelling that is actually consumed**, with commit-time
   validation. vfkb's equivalent field is dead weight.
4. **Concurrency rigour** — `expectedVersion` CAS, idempotency receipts,
   resumable cursors. Stronger than vfkb's lockfile-plus-LWW.
5. **Release machinery.** `ASF_SOURCE_RELEASE.md` requires the release manager to
   rebuild the archive on their own hardware and assert byte-identity, rejecting
   *"a workflow-produced digest alone"* — a harder standard than vfkb's canary.

## 5. Where vfkb is better

1. **Git-native — and Maka pays for not being.** Its memory does not travel with
   a clone, does not branch, cannot be PR-reviewed, and per its own README *"an
   upgraded workspace can show empty threads."* **Nothing in Maka demonstrates
   git-nativeness is unnecessary** — Maka is an app with no repo to put it in.
2. **Decision lifecycle.** No decision kind, no `why`, no supersede chain, no
   constitutional tier. Preserving engineering judgment needs exactly this.
3. **Honest no-match** — "nothing recorded" vs "all matches stale".
4. **Harness portability.** vfkb runs under anything speaking MCP; Maka's memory
   runs under Maka.
5. **A real decision process** — 73 ADRs with a lint, 38 RFCs, 57 review records,
   a CI gate. The clearest place vfkb's apparatus looks justified rather than
   excessive.
6. **It ships.** vfkb on npm with provenance and a canary. Maka: no Apache
   release, private packages, an alpha stub.

## 6. Learnings, ranked

**1. EXPOSE AND CONSUME `provenance.origin` — the field ADR-0011 already
specified.** Not "add an evidence field": vfkb has one, dormant. The work is
surfacing it on `kb_add` and `vfkb add`, rendering it in the context bundle, and
having `doctor` flag load-bearing entries that carry no receipt.
*Cost:* lower than the earlier framing implied — no schema change, only surface
and render work.
**The strict form is not available to us, and the reason matters:** Maka can make
it an FK because it has a durable event table to point at. vfkb has no
transcript, so a `sourceRef` is an opaque string with no integrity guarantee.
Honest adoption: **require it for `verified` provenance, validate the shape, and
document that the referent is uncheckable** — a weaker guarantee stated openly,
not silently. Budget the schema change; do **not** budget an event store.

**2. Write-time key extraction instead of read-time stemming.** Store per-entry
`keys` with `keyType` and `keyOrigin` (deterministic/llm/user); retrieve by
distinct-key-overlap. Semantic work happens **once at write**. This is a **third
option** for the S1/RFC-003 gate — phrasing-robustness without embeddings, without
a service, without a retrieval round-trip, with the deterministic subset staying
deterministic. *Cost:* medium; ADR-0043/0044's seams exist for it. This is the
direct answer to vfkb's longest-gated question, arriving with independent
corroboration that embeddings were the wrong first resort.

**3. Consume the bi-temporal fields already stored.** Read `recorded_invalid_at`
at the injection gate — or delete the field. Closes a "schema-now, consume-later"
item open since ADR-0011. *Cost:* small either way.

**4. Move append-only enforcement into the data layer.** Make the backend refuse
mutation structurally rather than relying on the `PreToolUse` hook plus engine
convention. vfkb's own ADR-0070 argues guards must fail loudly; this makes the
invariant not need a guard. *Cost:* low-to-medium, partly already true. Ranked
fourth because it hardens an invariant not yet observed to break.

**The theme these three share, which is the real finding.** vfkb has *specified
but unconsumed* capability in three places: `provenance.origin` (written, never
read, never exposed), `recorded_invalid_at` (stored, never read), and key
extraction (done at read rather than write). Maka is ahead on all three not by
having designed better, but by **wiring what it designed**. That is a cheaper gap
to close than a design gap, and it is the same "schema-now, consume-later" pattern
`docs/FEATURES.md` §6 already names — now observed three times.

**Not adopting:** SQLite-in-app-data, mutable versioned entries, per-item CAS —
each trades away something vfkb deliberately bought.

## 7. Composition

**The zero-new-code path exists today.** Maka is an MCP **client**
(`packages/mcp/src/index.ts:39`); vfkb ships an MCP **server**. Point Maka at
`vfkb-mcp` with `VFKB_DATA_DIR` set and the nine `kb_*` tools appear in a Maka
session. A second zero-config path: Maka reads project `AGENTS.md`, and
`vfkb export agents-md` generates exactly that.

**A deeper "Maka face" would be a plugin, not a hook set** — so it would be shaped
much closer to the existing Pi in-process extension than to the Claude Code hook
face. vfkb has already built that shape once.

**The split is the plausible outcome, and Maka's own architecture argues for it.**
Maka records what happened; vfkb records what was decided. `MemoryItemSource` is
the seam — Maka already believes curated claims should cite transcript events. A
vfkb entry carrying `evidence: {sourceRef: 'maka:<session>/<run>/<turn>/<event>',
quote}` is that composition made real, and is the same change as learning 1.

## 8. Not verified

- **Maka's runtime behaviour** — not built, not run. All claims are from source.
- **Whether the unwired tier is wired on an unmerged branch.** Absent as of `main`
  @ 2026-09-14.
- **Maka's eval reproducibility** — only pass/fail CSVs are committed; no prompts,
  traces or verifier output.
- **Relative retrieval quality** — no shared benchmark exists and none was built.
  The structural similarity is verified; the performance comparison is not.
- **Governance depth** — `maka-proposal-zh-review.txt` records that most proposed
  committers have not previously run an Apache release, read but not independently
  verified.
- **File:line citations** beyond the two spot-checks named in the header.
