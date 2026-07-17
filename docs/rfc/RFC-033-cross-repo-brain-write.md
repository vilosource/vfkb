---
type: RFC
title: "RFC-033: Cross-repo brain write — a cross-repo operation leaves one deliberate, provenance-stamped record in each affected repo's own brain"
description: "The write-side complement of RFC-013/ADR-0038: when a session in repo A changes repo B's observable state, it first reads B's brain, then writes one cross-repo record into it through the engine (VFKB_DATA_DIR today, a `vfkb broadcast` helper on build) — tagged `cross-repo` (never `handoff`/`next`: the resident's ADR-0049 pin is not the visitor's channel), delivered via a second bounded pinned section on build, never committed by the writer, arriving unverified. MCP-side targeting is rejected by name."
status: Proposed
timestamp: 2026-07-17
---

# RFC-033: Cross-repo brain write — operation record broadcast

- **Status:** Proposed
- **Date:** 2026-07-17
- **Deciders:** operator + Claude
- **Relates:** [RFC-013](RFC-013-cross-project-brain-query.md) /
  [ADR-0038](../adr/ADR-0038-cross-project-brain-query.md) (the **read** side this complements —
  and whose read-only guarantee this RFC deliberately does **not** touch);
  [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the brain is a committed artifact that
  travels with its repo — which is exactly why a record written there reaches the next session in
  any clone); [ADR-0011](../adr/ADR-0011-envelope-richness.md) (structured `provenance.origin` —
  the natural home for a future structural origin stamp);
  [ADR-0032](../adr/ADR-0032-env-var-rename-data-dir-bundle-dir.md) (`VFKB_DATA_DIR` as the
  canonical brain-dir override, the transport that already works);
  [ADR-0033](../adr/ADR-0033-session-end-continuity.md) (whose pathspec-scoped, never-on-`main`
  brain-commit discipline this RFC leans on for commit semantics);
  [ADR-0049](../adr/ADR-0049-session-start-handoff-pinning.md) (the handoff pin — the injection
  mechanics §1a must not hijack, and the precedent for the second pinned section it decides);
  [ADR-0023](../adr/ADR-0023-scenario-contract-first.md) /
  [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) /
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) (the DoD contract the named scenario
  serves).

## Context

**The scenario, observed live (2026-07-17).** A maintenance session running in the vfkb repo
updated or migrated the vfkb plugin wiring of **eleven** sibling repos under `~/VFKB/` (the
plugin-0.6.0 consumer sweep). Two facts from that session motivate this RFC:

1. **The positive case.** Eleven repos had their observable state changed underneath their own
   sessions — settings rewritten, `.mcp.json` servers removed, engine versions jumped from as far
   back as 0.1.0 up to 0.6.0. Git history records *what* changed per repo, but the brain is what a session gets
   **injected** at start; without a brain-side record, every one of those repos' next sessions
   would meet altered wiring with no recallable explanation.
2. **The negative case.** In `viloforge-wiki`, the visiting session opened a redundant, conflicting
   migration PR (#9) because the resident agent's own migration (wiki PR #7, merged to `develop`)
   was recorded nowhere the visitor recalled from — it surfaced only in the target repo's PR
   history, mid-operation, via adversarial review. A standing "operations announce themselves in
   the target's brain" discipline is bidirectional: it informs the residents *and* the next
   visitor.

**The write already works — verified, not asserted.** Like RFC-013 found for reads, the engine is
brain-dir-agnostic: `brainDir()` resolves `VFKB_DATA_DIR` fresh on every call, and `add` flows
through the same storage kernel. The sweep's records were written exactly this way, one `fact` per
affected repo:

```bash
VFKB_DATA_DIR=~/VFKB/<repo>/.vfkb VFKB_PROJECT=<repo> \
  node <vfkb>/dist/cli.js add fact "CROSS-REPO MAINTENANCE (…): …" \
  --tag handoff,cross-repo,plugin,distribution   # the `handoff` tag here proved to be a defect — §1a
```

Eleven entries landed (e.g. EventShield `62f18de97e40`, viloforge-wiki `6061deef7b77`), went
through the engine (append-only JSONL discipline intact), and are recallable from each target's
own brain — though whether one *surfaces in the session-start injection* is exactly the delivery
question §1a decides (as ranked facts they are droppable under budget pressure; the original
claim here that they "will surface" overstated v1 — same defect class as the annotated command
above). **The capability gap is zero.** What is missing is everything around it:

- **No discipline.** Nothing says a cross-repo operation *must* leave a record, so by default it
  won't (vfkb's founding lesson: a prose habit with no named convention gets skipped — the wiki
  collision is what skipping looks like).
- **No provenance convention.** The sweep improvised "session run from the vfkb repo" in prose plus
  a `cross-repo` tag. Prose provenance is invisible to filters and unenforceable.
- **No ergonomics.** One operation → N targets meant hand-rolling a shell loop, hand-stamping the
  origin in every text, and getting the flag name wrong once (`--tags` vs `--tag`) before eleven
  identical invocations succeeded.
- **An in-session trap worth naming.** The MCP `kb_add` is pinned to the session's own brain. That
  is a **safety property, not a limitation** — the same separation RFC-013 drew for reads
  ("never writes to, mutates, or silently merges the foreign brain" is a guarantee about the
  *query* surface). Cross-repo writing must remain a distinct, deliberate act, not a parameter a
  session can drift into.

**What this is not.** Not the parked H3 global tier and not a fleet message bus: the record is a
plain entry in the target's own committed, single-homed `.vfkb` (ADR-0019), written point-to-point
on local disk. The reader-side machinery already exists — it is the target's ordinary
session-start injection.

## Decision (proposed)

**1. The convention (the core of this RFC).** A session that deliberately changes another repo's
observable state — files, wiring, releases, installed tooling — **leaves exactly one `fact` in
each affected repo's brain**, written **through the engine** (never by editing the target's
`entries.jsonl` directly), stating: what was done, where it landed (PR/commit/branch), what was
verified, and what the target's operator/next session still needs to do. The entry is tagged
**`cross-repo`** (plus operation-specific tags) — **never `handoff` or `next`** (§1a) — and its
text opens with a **`CROSS-REPO <operation> (<date>, from <origin project>)`** marker. Read-only
visits (querying a sibling brain per ADR-0038, browsing its source) leave **no** record — this
convention binds writes of state, not reads, precisely so the target brain gains signal and not
visit-noise.

**The convention is bidirectional.** A session about to change another repo's observable state
first **consults that repo's brain** for prior operations and resident handoffs — the ADR-0038
read side, which today is the CLI read (`VFKB_DATA_DIR=<target>/.vfkb <engine> search|context`).
Without this clause the write half would not have prevented this RFC's own motivating collision:
the wiki visitor needed to *read* what the resident had recorded before operating, not only leave
a record after.

**1a. Delivery channel — the ADR-0049 interaction (decided, not assumed).** The Context's claim
that a record "will surface in the target's session-start injection" is not free: under the
ADR-0012 type tiers a plain `fact` is the *first* thing budget-dropped in a mature brain — the
exact live failure (#96) ADR-0049 fixed for continuity by pinning **one** never-dropped entry:
the newest injectable entry tagged `handoff`/`next`. That single slot forces a choice this RFC
must make explicitly:

   - **Cross-repo records must NOT carry `handoff`/`next`.** Those tags would claim the resident's
     continuity pin — the newest broadcast **evicts the resident's own in-flight handoff** into
     the droppable ranked bundle (reintroducing #96 in the target), and an uncommitted broadcast
     also falsely satisfies ADR-0033's B2 session-end floor check, suppressing the resident's next
     fallback handoff. This is **observed, not hypothetical**: the motivating sweep's eleven
     entries initially carried `handoff` and hijacked the pin in all eleven target repos
     (verified against `latestHandoff()`; remediated by engine retag the same day, 2026-07-17).
     This subsection exists because of that incident.
   - **Delivery is a second bounded pin (on build, with `broadcast`).** The engine's Tier-A bundle
     grows a **`## Cross-repo operations`** section pinning the newest injectable
     `cross-repo`-tagged entry — same selection-is-a-filter, same char cap and truncate-with-id
     discipline as the ADR-0049 handoff pin, rendered after `## Last handoff`, never
     budget-dropped. Resident continuity and visitor records get one guaranteed slot *each*;
     neither can evict the other.
   - **Until that pin ships, v1 delivery is best-effort** — the record rides the ranked bundle
     where facts drop first. Disclosed, not assumed: in a small brain it surfaces; in a mature
     brain it may not. §6 keeps the two strengths honest with two arms: the unpressured arm
     proves v1 at exactly the strength v1 claims, and the seeded delivery arm is the RED-first
     contract for this pin (per ADR-0023).
   - **Rejected:** sharing the single handoff slot (newest-wins displacement — pays the resident's
     continuity for the visitor's record) and pinning both into one section (muddles the
     ADR-0033/0049 handoff semantics: a visitor's maintenance note is not the resident's
     continuity).

**2. Transport, in two steps.**
   - **Now (v1, zero build):** the convention runs on what already works —
     `VFKB_DATA_DIR=<target>/.vfkb <engine> add fact … --tag cross-repo`. This RFC makes
     that the *named, documented* pattern instead of an improvisation.
   - **On build (v2): `vfkb broadcast`** — one command, N targets:
     `vfkb broadcast "<text>" --to <dir>[,<dir>…] [--tag <extra,…>]`. It writes one `fact` per
     target through the engine and stamps mechanically what v1 leaves to discipline: the
     `cross-repo` tag (and never `handoff`/`next` — §1a), the `CROSS-REPO … from <origin>` marker
     (origin derived from the invoking repo's project label), and the date. It **refuses** a target whose `manifest.json`
     `schema_version` the running engine does not support — promoting to a hard refusal the
     brain↔engine compat rule that today exists only as a `vfkb doctor` diagnostic — and reports
     per-target success/failure explicitly: a partial broadcast must be visible, never silent.
   - **Out of scope: targets without a brain.** A repo with no `.vfkb/manifest.json` never adopted
     vfkb; v1 must not write there (a bare engine `add` would silently bootstrap a partial,
     wire-less brain whose record no session-start injection would ever deliver — the
     quiet-success shape ADR-0051 §3 forbids), and `broadcast` refuses such a target per-target,
     like any compat failure.
   - **Concurrent-append safety is already settled ground**
     ([ADR-0040](../adr/ADR-0040-native-concurrency-lock.md)): pure appends are uncoordinated by
     design with `appendFileSync` byte-safety verified, so writing into a brain a live target
     session is appending to is safe today — and the advisory lock anchors to the target's own
     brain dir, so a future read-decide-append `add` would take the *target's* lock automatically.

**3. Write, never commit.** The writer leaves the entry **uncommitted** in the target's working
tree. Committing the target's brain belongs to the target's own discipline — the plugin's
SessionEnd auto-commit (ADR-0033: pathspec-scoped to `entries.jsonl`, topic-branch-only, warns on
`main`) or its operator. Rationale: a cross-repo writer force-committing into a checkout it does
not own is exactly the class of collision the wiki case demonstrated; the entry riding the
target's next natural brain commit is the safe default. `broadcast` gets **no** `--commit` flag in
v2 — if that need is ever real, it returns here as its own proposal.

**4. Trust and provenance defaults.** Cross-repo entries arrive as ordinary agent-authored,
**unverified** entries — the target repo's operator promotes/verifies them like any other. For v1
and the v2 `broadcast`, origin identification is the tag + text-marker convention above.
**Deferred with a named trigger:** extending ADR-0011's `ProvenanceOrigin` union with a structural
`{ kind: 'project', project, … }` origin — trigger: the first time something needs to *filter or
gate* on cross-repo origin (not merely read it), the tag convention has provably failed as an
interface, and the schema change is proposed then, not now.

**5. Rejected by name, so they stay rejected:**
   - **MCP-side targeting** (`kb_add target=…` or any per-call brain redirect on the session
     tools): the session surface stays bolted to the local brain, mirroring RFC-013's read/write
     separation from the other side.
   - **Auto-broadcast** (hooking cross-repo detection into PostToolUse or git): knowledge here is
     deliberate (the standing capture doctrine); an auto-layer would flood target brains with
     tool-call noise and reintroduce the exact failure mode that keeps PostToolUse capture off.
   - **A shared/global store or fleet bus** for these records: parked with H3; the committed
     per-repo brain already *is* the delivery channel (ADR-0019).

**6. The scenario contract (ADR-0023 — this is the Definition of Done).** L4
**`cross-repo-record`**: a sandbox with two repos, A and B, each with its own brain. The A-arm
agent performs a scripted operation that changes B (e.g. edits B's config) and follows the
convention (v1 transport; the v2 variant invokes `broadcast`). A **fresh agent session in B** is
then asked what recently changed in its wiring and why. Predicates are content assertions
(quiet-success discipline, ADR-0051 §3 — exit codes and non-empty files are not evidence), keyed
on an **unguessable sentinel** carried in the record (an operation codename / remaining-step
token, the ADR-0049 scenario's own pattern): the B-session's output must contain the sentinel —
proof it *read the record*, not that it inferred "A did it", which is trivially guessable in a
two-repo universe. The scripted change to B lands **uncommitted** (mirroring §3's
write-never-commit reality) or with a deliberately uninformative message — otherwise an agent
legitimately explains the change from `git log` and the arms pass/fail for reasons that say
nothing about the convention. **Three arms, because the RFC ships two capabilities of different
strengths — each gets a DoD it can actually satisfy:**

   - **v1 convention arm (unpressured — gates declaring the *convention* done).** B's brain is
     small enough that a ranked fact injects. Green = the write + best-effort delivery v1
     actually claims. DEMONSTRATED ≥2/3 here (plus the contrast arm) is the convention's DoD.
   - **Delivery arm (pressured — the RED-first contract for the §1a pin / `broadcast`).** B's
     brain is seeded with enough high-tier entries to overflow the injection budget (ADR-0049's
     scenario precedent), so it proves **delivery under pressure**. Expected **RED until the §1a
     cross-repo pin ships** — that RED is the contract working (ADR-0023: written first, goes
     green when the pin builds), and it gates only the pin/`broadcast` capability, never the v1
     convention.
   - **Contrast arm (can-fail).** Same operation *without* the record — the B-session must fail
     to produce the sentinel.

   Per ADR-0050, until the relevant arm's committed, DEMONSTRATED record exists, the honest
   status of each capability is *proposed / built-but-unverified*.

## Consequences

**Positive.**
- Cross-repo operations become recallable where their effects live — each target's next session is
  briefed by its own injection, in any clone, because the record rides the committed brain
  (ADR-0019).
- The wiki-collision class shrinks from both directions: residents learn what visitors did;
  visitors who check the target brain first (ADR-0038 read side) see prior operations before
  duplicating them.
- Fleet-lite interop lands with **no new tier, no service, no schema change** — v1 is a convention
  over shipped machinery.

**Negative / costs.**
- v1 is a prose-rule-with-no-Brake and will sometimes be skipped (the founding lesson). Accepted
  for v1; the v2 `broadcast` narrows the gap by making compliance cheaper than omission, and the
  L4 contrast arm keeps the failure mode observable. A deterministic Brake (e.g. a doctor check
  correlating foreign-origin commits with brain records) is **not** proposed — named here only so
  its absence is a choice, not an oversight.
- The **engine-only rule is also prose in exactly the cross-repo case**: the PreToolUse
  brain-write gate guards only the path under the *session's own* `brainDir()` (`src/gating.ts`),
  so a visitor hand-editing a *foreign* `entries.jsonl` sails through its own repo's gate. Named
  so its absence is a choice; extending the gate to any `*/.vfkb/entries.jsonl` path is cheap and
  deferred with the trigger: **the first observed hand-edit of a foreign brain**.
- Uncommitted entries sit in target working trees until the target's own flow commits them; on a
  repo parked on `main` (where ADR-0033 deliberately refuses to auto-commit) the record is not
  merely unpushed but **uncommitted — silently erasable** by `git checkout -- .`, `git clean`, or
  a stash-pop conflict, with no trace. Accepted with eyes open: local delivery still works
  (injection reads the file, not git), durability-by-someone-else's-commit is still strictly
  better than no record, and the alternative (writer commits) was rejected in §3 for cause. The
  v2 `broadcast` per-target report therefore states each target's **commit posture** ("written;
  uncommitted; target parked on `main`") so a sweep ends with an actionable durability summary,
  not N silent maybes.
- Writer and target may run different engine versions. Schema v1's stability has carried every
  such write to date; the v2 compat refusal (§2) turns a future mismatch into a loud per-target
  error instead of a corrupt brain.

## Alternatives considered

- **Status quo (improvised env-var writes, no convention).** Capability-identical to v1 and
  precisely what produced the sweep's records — but conventionless: no required tags, no origin
  marker, no obligation to write at all. The wiki collision prices that in. Rejected.
- **Git-only record (commit messages / PR descriptions).** Already exists, already insufficient —
  it is not injected at session start, which is the delivery channel that matters here. Rejected
  as the *sole* record; it remains the mechanical complement.
- **MCP tool parameter for targeted writes.** Rejected by name in §5 — the local-only session
  surface is a safety property shared with RFC-013's read-side design.
- **Structural `ProvenanceOrigin` extension now.** Deferred with a named trigger (§4) — extending
  a schema union for a convention that has run once would be speculation; ADR-0042's schema-honesty
  bar wants the demonstrated need first.
- **Auto-detection / auto-broadcast.** Rejected by name in §5 — deliberate-capture doctrine.
- **A `--commit` flag on `broadcast`.** Rejected in §3 — the writer never commits a checkout it
  does not own.
- **Delivering via the resident's `handoff` pin** (tagging records `handoff`/`next`, or sharing
  the single ADR-0049 slot). Rejected in §1a — observed live to evict the resident's continuity
  in all eleven sweep targets and to suppress the ADR-0033 B2 floor; a visitor's maintenance note
  is not the resident's continuity.
