# The Claude Code harness has moved — October 2026

> **Research survey.** What the Claude Code harness offers now versus what vfkb's
> auto-layer was built against, with the gap enumerated per surface. Prompted by an
> operator observation on 2026-10-07 that "technology has moved since the current
> version of vfkb". Input to [`../PRD.md`](../PRD.md). **Nothing here is decided or
> built.**
>
> **Verification discipline.** Claims are tiered:
>
> | Marker | Means |
> |---|---|
> | **[cli]** | observed by running the installed CLI (`2.1.273`) on this machine |
> | **[repo]** | measured in this repo at `185822b` |
> | **[docs]** | from `code.claude.com/docs`, fetched 2026-10-07 — describes the *latest* release, not necessarily `2.1.273` |
> | **[secondary]** | press/blog reporting |
>
> **⚠ The single most important caveat, and it bounds this entire document:** the
> installed CLI is **`2.1.273`** while the latest is **`~2.1.292`** [secondary]. Every
> **[docs]** claim therefore describes a surface that **may not exist in the version
> this repo actually runs**. No **[docs]** hook event below has been fired and
> observed. §7 says what must be probed before any of it is designed against.

---

## 1. Verdict

1. **The hook surface grew roughly sixfold and vfkb is using a sixth of it.** The
   engine implements **5** hook handlers; the harness documents **33** events
   [repo, docs]. That is not a completeness argument — most of the 28 are
   irrelevant to a memory substrate — but **four of them map directly onto
   problems vfkb has recorded as open, blocked, or structurally impossible.**
2. **`PostToolUseFailure` closes a named external-block.** `CLAUDE.md`'s own open
   findings say *"Claude Code's PostToolUse hook does NOT fire on a FAILED tool
   call → live failure-capture is pi-only (external-block)."* A
   `PostToolUseFailure` event is documented [docs]. The distiller's entire v1
   signal is the `capture:error` fact, so this is the difference between
   auto-distillation working on one harness and both. §3.1
3. **`UserPromptSubmit` supplies the query that SessionStart structurally lacks.**
   The decision-model survey concluded that BM25 cannot serve the inject path
   *"because BM25 needs a query and at SessionStart there is none."* A
   prompt-submit hook has a query, and can inject `additionalContext` [docs].
   **This reframes the whole retrieval problem** and partly un-gates S1. §3.2
4. **`PostCompact` closes a continuity hole nobody has named.** vfkb injects once,
   at session start. After a compaction the knowledge bundle is gone and nothing
   re-injects it. With `--autocompact` now spanning 100k–1M tokens [cli], long
   sessions compact routinely. §3.3
5. **Hooks are no longer only shell commands.** Five types are documented —
   `command`, `http`, `mcp_tool`, `prompt`, `agent` [docs]. **`mcp_tool` is an
   architectural simplification of vfkb's hardest distribution problem:** the hook
   could call the already-running MCP server instead of spawning a vendored engine
   bundle per event. §4
6. **Two CLI commands exist that vfkb documents as blockers.** `claude plugin tag`
   is real [cli] — ADR-0051 names adopting it as what blocks the install-path L4,
   and therefore what keeps *"delivery is unproven"* mandatory in every release
   note. `claude plugin validate --strict --json` is real [cli] — that is
   ADR-0048's pending `hooks.json` validation, available as a CI Brake today. §5
7. **The strategic item is Claude Code Projects.** Anthropic shipped a
   coordinator with parallel cloud threads over **shared project memory** and a
   file/artifact library, beta from 2026-09-17 [secondary]. A first-party
   shared-memory layer for multi-session work is the first thing in vfkb's life
   that overlaps its premise. §6
8. **`--bare` is a clean L4 isolation primitive.** Brain gotcha `fb712c13f39e`
   records that the user-scope plugin leaks into every sandbox an L4 launches,
   corrupting arms three ways, with a settings-file workaround. `--bare` skips
   hooks, LSP and plugins outright [cli]. §5

---

## 2. What vfkb is built against, measured

**[repo]** at `185822b`:

| Surface | What vfkb ships |
|---|---|
| Hook handlers in the engine | **5** — `session-start`, `pre-tool-use`, `post-tool-use`, `session-end`, `stop` (`src/cli.ts`) |
| Of those, enabled in practice | **4** — `post-tool-use` auto-capture is deliberately OFF (`CLAUDE.md`: it would flood the committed brain) |
| Hook events wired in this repo's own `.claude/settings.json` | **2** — `SessionStart`, `PreToolUse`; the rest arrive via the plugin |
| Hook type used | **`command` only** — a spawned process per event |
| Distribution | plugin `vfkb@vfkb` from the `vilosource/vfkb-claude-plugin` marketplace, vendoring its own engine bundle copy (ADR-0045) |
| MCP | 9 `kb_*` tools |
| Agents | Haiku-pinned skill subagents (ADR-0049 Layer 1) |
| Injection | one bundle at SessionStart, 10,000-char budget |

---

## 3. The hook events that matter

Full documented list is 33 events [docs]. The four below are the ones that touch a
recorded vfkb problem. The rest are enumerated in §8 for completeness.

### 3.1 `PostToolUseFailure` — fires after a tool call **fails** [docs]

**The recorded problem.** `CLAUDE.md` open findings, verbatim: *"Claude Code's
PostToolUse hook does **not** fire on a FAILED tool call → live *failure*-capture
is pi-only (external-block)."* `src/pi-extension.ts` captures failures through pi's
`tool_execution_end`; the Claude face cannot.

**Why it is load-bearing.** `src/distiller.ts`'s only v1 signal is a captured
`capture:error` fact — *"Tool X can fail: …"* — which drives candidate gotchas and,
through recurrence, corroborated promotion (ADR-0021). On Claude Code that pipeline
has no input. This is not a nice-to-have; it is the auto-distill feature being
half-dark on the primary harness.

**What it would take.** A sixth engine handler, plus deciding whether failure
capture is subject to the same containment the success path has. Note that
auto-capture is OFF here for noise reasons — failures are a far better
signal-to-noise ratio than successes, so the economics differ from the decision
that switched capture off.

### 3.2 `UserPromptSubmit` — fires when a prompt is submitted, before Claude sees it; can inject `additionalContext` [docs]

**This is the most consequential finding in the document**, because it changes the
scope of a conclusion two existing documents rest on.

`docs/research/decision-models-2026-10.md` §6.1 states that the gated S1 item's
BM25-first amendment "cannot address" the inject path, *"because BM25 needs a query
and at SessionStart there is none"* — and uses that to argue a decision model
addresses a gap BM25 structurally cannot.

**That statement remains true and is not being corrected.** At SessionStart there is
still no query, and situational relevance with no query is still the decision
model's distinct case. What changes is the *implication* drawn from it — that the
automatic path therefore has no query at all. It has one, at a different moment.

**A prompt-submit hook has a query.** That means:

- Ordinary lexical retrieval (the existing `InMemoryIndex`, `searchScored`, the
  RFC-001 relevance floor) becomes usable **on an automatic path**, not just in an
  explicit `kb_search`.
- The §6.1 argument for a decision model narrows: it is still the only option for
  *situational* relevance with no query, but per-prompt retrieval is now a cheaper,
  deterministic, offline-capable alternative for the common case.
- The 10k SessionStart budget stops being the only injection opportunity. Knowledge
  can arrive **when it is relevant** rather than all at once up front.

That is a different retrieval architecture from the one every current ADR assumes,
and it is the reason this cycle is a v3 rather than a patch.

### 3.3 `PostCompact` / `PreCompact` — after / before context compaction [docs]

vfkb injects its bundle once. `--autocompact` accepts `auto` or an explicit
100k–1M token window [cli], so a long session compacts as a matter of course — and
after it does, the Constitution, the pinned handoff and the ranked bundle are
whatever the summariser chose to keep. Nothing re-injects them.

ADR-0008 ("the Constitution always leads") and ADR-0049 (the handoff pin is "never
budget-dropped") both encode *injection-time* guarantees that silently do not
survive compaction. `PostCompact` is where a re-injection would go. `PreCompact`
can block compaction and could checkpoint first [docs].

**This is a correctness gap in a shipped guarantee, not a new feature request** —
and it has never been written down.

### 3.4 `SubagentStart` / `SubagentStop` — when a subagent is spawned / finishes [docs]

ADR-0049 Layer 1 spawns Haiku-pinned subagents (`/vfkb:brief`). Those subagents get
no knowledge bundle — SessionStart does not fire for them. `SubagentStart` would let
the substrate reach them; `SubagentStop` would let their findings return to it.
Relevant to ADR-0075's factory, where dispatched coders are subagents.

---

## 4. Hooks are no longer only shell commands

Five hook types are documented [docs]: `command`, `http`, `mcp_tool`, `prompt`,
`agent`. vfkb uses `command` exclusively.

**`mcp_tool` is the interesting one, and it is an architecture question rather than a
feature.** A hook can call a tool on a configured MCP server, with templated input
from the event [docs]. vfkb already runs an MCP server exposing 9 `kb_*` tools.

Today every hook event spawns a process that loads a **vendored copy** of the engine
(ADR-0045 Phase 1), which is why:

- `$VFKB_BUNDLE_DIR` and the bundle-vendoring machinery exist at all (ADR-0030);
- `CLAUDE.md` has to warn that editing `src/` no longer changes what the live hooks
  run, because they execute the plugin's vendored copy;
- a plugin release is required to dogfood an engine change.

If hooks called the MCP server instead, the hook path and the tool path would share
**one** process and one engine instance — removing a whole class of version-skew
between them. That is not a small refactor and it trades a new dependency (the hook
now needs the MCP server up) for a removed one. It belongs in the PRD as a question,
not a conclusion.

`prompt` and `agent` hooks matter differently: they are LLM-in-the-hook. Note the
constraint the decision-model survey establishes — a judgement with no referent
must never be a Brake — so an `agent`-type hook is categorically unfit for
`pre-tool-use` gating and fine for advisory nudges.

---

## 5. CLI surface that unblocks named vfkb blockers

All **[cli]**, observed on `2.1.273`:

| Command | What it does | Which vfkb blocker it touches |
|---|---|---|
| `claude plugin tag [path]` | Creates a `{name}--v{version}` git tag, **validating that `plugin.json` and any enclosing marketplace entry agree**; `--dry-run`, `--push`, `--remote`, `-m` | **ADR-0051.** Its install-path L4 is *"not even immediately buildable (blocked on adopting `claude plugin tag`; the plugin repo has zero tags)"*. That blocker is liftable. Until the L4 lands, every release note must still say "delivery is unproven" — so this is the lever on a standing disclosure obligation |
| `claude plugin validate <path> --strict --json` | Validates a plugin **or marketplace manifest**, and the skills/agents/commands in a directory. `--strict` fails on unrecognised fields and missing metadata, for CI | **ADR-0048.** Plugin `hooks.json` validation "belongs to the plugin repo's release flow (vfkb-claude-plugin#6, **pending**)". This is that, first-party, with machine-readable output and CI-appropriate exit codes |
| `claude plugin details <name>` | Component inventory **and projected token cost** | The injection-budget story. A first-party number for what the plugin costs a session |
| `--bare` | "Minimal mode: skip hooks, LSP, plugin…" | **Gotcha `fb712c13f39e`.** The user-scope plugin leaks into every L4 sandbox, corrupting arms three ways; the verified workaround is a per-sandbox settings file. `--bare` is a cleaner primitive — though note it skips *all* plugins, so an L4 testing vfkb's own wiring cannot use it |
| `--autocompact <auto\|tokens>` | Auto-compact window, `auto` or 100k–1M | Re-frames the 10,000-char budget, which was sized against a much smaller window (ADR-0015) |
| `--agents <json>` | Define custom agents inline | L4 arms could define their agent without a settings file |
| `--bg`, `claude attach\|logs\|stop\|rm`, `claude agents` | Background sessions and their management | The factory's dispatcher (ADR-0075 P12-c) currently plans its own polling and reaping |
| `claude project purge` | Deletes all Claude Code state for a project | L4 hygiene between arms |
| `claude plugin marketplace` | Marketplace management | RFC-024 §1's stale-marketplace-clone detection, owned by `vfkb doctor` |

---

## 6. Claude Code Projects — the strategic item

**[secondary]**, beta from 2026-09-17 for selected Pro/Max accounts. A coordinator
splits one goal across **parallel cloud sessions** ("threads"), each on its own
branch with its own repo copy, able to open PRs and run tests; the coordinator
reviews and assembles. The threads **share project memory**, so decisions and
instructions carry across work spanning days, alongside a file/artifact library.
Each thread counts as a full session; cap of 200 new threads per project per day.

**Why this matters to vfkb and not just to vfkb's roadmap.** vfkb's premise is a
per-project knowledge substrate that agents ground against, with the brain committed
to the repo as the system of record. Anthropic now ships a first-party shared memory
for coordinated multi-session work. Three readings, and the PRD has to pick one
rather than leave it implicit:

- **Complement.** Project memory is session-scoped and host-owned; vfkb's brain is
  git-owned, reviewable, append-only, and travels with the clone. These are
  different durability classes. vfkb becomes what Projects' memory is *populated
  from* and what outlives it.
- **Substitute, partially.** If project memory carries decisions across threads
  well enough, the thing vfkb's handoff pin exists for is partly solved upstream —
  for cloud Projects users.
- **Consumer.** vfkb's own factory (ADR-0075) plans a local dispatcher, reaper and
  liveness model. Projects is a first-party implementation of that topology. ADR-0075
  clause 1 says the orchestrator's leverage is in what it *refuses*, not in the
  mechanics — which argues for consuming the mechanics rather than rebuilding them.

This is also an **ADR-0013-shaped** question: do not take a hard dependency on a
beta, gated, cloud-only, quota-capped surface. But do not design as though it does
not exist.

---

## 7. What must be probed before anything is designed against it

The version skew is the governing risk: **every `[docs]` claim describes a surface
that may postdate `2.1.273`.** This repo's doctrine is that a flag whose semantics
you have not observed is not a guardrail (gotcha `61daf266f883`, where
`--allowedTools` was found not to remove the shell). The same applies to a hook event
whose firing you have not seen.

Required before any v3 hook work is specified:

1. **Fire each candidate event and observe it.** `PostToolUseFailure`,
   `UserPromptSubmit`, `PostCompact`, `SubagentStart`/`SubagentStop` — wire a
   logging hook, cause the condition, read the payload. Record the **actual** JSON
   shape, not the documented one.
2. **Establish the minimum CLI version per event**, and whether the plugin's
   `hooks.json` can declare an event the host does not know without breaking
   startup. A plugin that fails to load on an older CLI is a delivery regression
   for all 12 consumers.
3. **Probe `mcp_tool` hook latency and failure mode** when the MCP server is down.
   The current `command` hooks fail open by design (`src/hook-stdin-failopen.test.ts`);
   an `mcp_tool` hook's behaviour on a dead server is unknown and is a
   fail-open/fail-closed question on the inject path.
4. **Confirm `claude plugin validate --strict` actually rejects** a malformed
   `hooks.json` — run it against a deliberately broken manifest and observe the
   non-zero exit. ADR-0048's Brake is worthless if the validator tolerates the
   defect class it is adopted for.
5. **Confirm `claude plugin tag`'s tag format** against what the marketplace and the
   release workflow expect. It produces `{name}--v{version}`; vfkb's releases use
   `vX.Y.Z`. Those are different schemes and the interaction is unknown.

---

## 8. The remaining documented events, for completeness

Not analysed above; listed so a later reader does not have to re-derive the surface
[docs]: `Setup`, `UserPromptExpansion`, `PermissionRequest`, `PermissionDenied`,
`PostToolBatch`, `StopFailure`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`,
`InstructionsLoaded`, `FileChanged`, `CwdChanged`, `DirectoryAdded`,
`PreModelSwitch`, `PostModelSwitch`, `Notification`, `MessageDisplay`,
`WorktreeCreate`, `WorktreeRemove`, `Elicitation`, `ElicitationResult`,
`ConfigChange`.

Three are worth a second look when the PRD is sequenced: **`InstructionsLoaded`**
(fires when `CLAUDE.md` or `.claude/rules/*.md` loads — a natural place to assert
the substrate is wired), **`FileChanged`** with SessionStart's `watchPaths` (watch
`.vfkb/` or `docs/adr/` and react), and **`PermissionDenied`** with its `retry`
field (a denial is a strong signal about what an agent tried to do).

Also newly available on existing events [docs]: `PreToolUse` gained a `defer`
permission decision and `updatedInput`; `PostToolUse` gained `updatedToolOutput`
(replace a tool result — the "output ladder" pattern); `SessionStart` gained
`sessionTitle`, `watchPaths` and `reloadSkills`.

---

## 9. Primary sources

- [Hooks reference](https://code.claude.com/docs/en/hooks) — the 33-event table, the five hook types, the control fields
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- Installed CLI `2.1.273`: `claude --help`, `claude plugin --help`, `claude plugin tag|validate|details --help`, `claude project --help`, `claude agents --help`
- Claude Code Projects beta — [MarkTechPost](https://www.marktechpost.com/2026/09/17/anthropic-launches-claude-code-projects-in-beta-parallel-cloud-sessions-that-keep-running-after-you-close-your-laptop/), [DataStudios](https://www.datastudios.org/post/anthropic-launches-new-claude-code-projects-with-parallel-ai-agents-and-shared-memory)
- Claude Mods (2026-10-01) — [Gradually changelog](https://www.gradually.ai/en/changelogs/claude-code/)
- vfkb internal: `src/cli.ts`, `src/distiller.ts`, `src/pi-extension.ts`, `.claude/settings.json`, `CLAUDE.md` open findings, ADR-0008/0013/0015/0021/0030/0045/0048/0049/0051/0075, `docs/research/decision-models-2026-10.md` §6.1, brain gotchas `fb712c13f39e`, `61daf266f883`

---

## 10. Not verified

- **No `[docs]` hook event has been fired and observed.** The installed CLI is
  `2.1.273`; the docs describe `~2.1.292`. Existence, payload shape and firing
  conditions of `PostToolUseFailure`, `UserPromptSubmit`, `PostCompact`,
  `SubagentStart`/`SubagentStop` and every event in §8 are **documented, not
  measured here**. §7 item 1 is the remedy.
- **The 33-event count is the docs' table as fetched**, cross-checked against one
  secondary source claiming 31. The exact number is not load-bearing; the
  *presence* of the four events in §3 is, and that is still `[docs]`.
- **Claude Mods** is `[secondary]` only — no first-party page was read, and no
  assessment of whether it changes plugin packaging is offered.
- **Claude Code Projects** is `[secondary]` only. Availability on this account is
  unknown; nothing was run. The three readings in §6 are analysis, not findings.
- **`claude plugin tag`'s interaction with release-please** is unexamined. vfkb
  tags `vX.Y.Z` via release-please; this produces `{name}--v{version}`. Whether both
  can coexist, and which the marketplace resolves against, is open (§7 item 5).
- **No claim here that any of it should be built.** This is input to a PRD, and the
  PRD is a proposal, not a decision (ADR-0007).
