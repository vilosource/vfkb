---
type: RFC
title: "RFC-035: Write-health loudness — a silent MCP-disconnect must never look like successful capture"
description: "Probe-first proposal for the silent-writer half of the OI tee-up: (0) a committed Tier-0 probe establishing what a dead/disconnected MCP server actually looks like to the agent on current Claude Code, (1) an always-injected CLI fallback line so a session whose kb_* face dies still has a durable capture path, (2) a doctor write-probe. The client-side visibility defect itself is external (Claude Code owns the MCP client); engine scope is honest about that boundary, same tier discipline as ADR-0015 P1."
status: "Accepted → ADR-0065 (ratified 2026-07-18)"
timestamp: 2026-07-18
---

# RFC-035: Write-health loudness — silent write-unavailability

- **Status:** **Accepted → [ADR-0065](../adr/ADR-0065-write-health-loudness.md)** (operator
  ratification 2026-07-18)
- **Date:** 2026-07-18
- **Deciders:** operator + Claude
- **Fixes:** [#176](https://github.com/vilosource/vfkb/issues/176) (silent MCP-disconnect; routed
  from the ViloForge ASDLC method repo, OI retrospective tee-up 6, half 2 of 2 — split from
  #175 because *more frequent commits do not solve an unavailable writer*)
- **Relates:** [RFC-034](RFC-034-durable-capture-journal.md) (the durability half — its journal
  makes the CLI fallback path proposed here exactly as durable as the MCP path);
  [ADR-0015](../adr/ADR-0015-cross-harness-tiered-parity.md) (the precedent for naming an
  external-blocked tier honestly instead of pretending the engine can own the client);
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) §3 (the quiet-success doctrine: where a failure
  presents as success, the check must be a content assertion — here applied to *capture*).

## Context

Field report (OpenIntegrations, gotcha `a6407e3d2d45` in that repo's brain): mid-session, brain
writes became impossible **while the server looked healthy** — the agent believed it was
capturing knowledge and was not. This is the dangerous half of the tee-up: knowledge never
written cannot be recovered by any durability mechanism, and the failure biases toward **quiet
data loss** — the exact ADR-0051 §3 shape, in the substrate whose entire purpose is capture.

Two honesty notes before designing anything:

1. **The failure has not been reproduced under the current wiring.** OI's incident predates the
   plugin migration (bootstrap-era `.mcp.json` wiring, engine 0.2.3). Whether current Claude
   Code + the plugin MCP server can still fail this way — and what the agent observes when it
   does (tool-call error? tools vanishing? hang?) — is **unknown, and unknowable from this
   repo's code**. It is an external contract question.
2. **The engine cannot fix the client.** The MCP client, its reconnect semantics, and what it
   tells the model when a server dies are Claude Code's. Engine-side pretend-fixes (heartbeats
   the client never reads, retry loops inside a dead pipe) would be theater. ADR-0015 set the
   precedent: name the external boundary, build the engine-ownable floor, gate the rest.

## Decision (proposed)

### §0 Tier-0 probe first — evidence before design

A committed, reproducible probe (`scenarios/probes/mcp-disconnect.md` + script) that, on current
Claude Code, kills/deprives the plugin MCP server mid-session and records **what the agent
actually observes**: the exact tool-call result shape, whether `kb_*` tools remain listed,
whether a retry reconnects. Its findings are recorded observed-not-asserted (brain gotcha +
probe record). **Every §2+ build decision is gated on this probe's output** — designing loudness
for a failure shape nobody has seen on the current stack repeats the class of mistake ADR-0051
§1 documents (`--plugin-dir` prescribed as "the real surface" without checking).

### §1 The fallback line — buildable now, probe-independent

One line appended to the injected session bundle (the `<vfkb-context>` footer, alongside the
map's "pull more" hint):

> capture fallback: if `kb_*` tools error or disappear, write through the CLI —
> `VFKB_DATA_DIR=<brain> node <vendored-bundle-path>/vfkb.mjs add <type> "…" --tag …`

Rationale: the hooks and the MCP server are *separate processes over the same engine bundle* —
a dead MCP face does not imply a dead CLI, and with RFC-034's journal the CLI write is exactly
as durable. Today that fallback exists but is undocumented at the moment of failure; an agent
mid-loss has no reason to know it.

Mechanics (review-hardened): the rendering process **is** the vendored bundle, so the path is
self-knowable — `import.meta.url`/`argv[1]`, no registry lookup — and must be **quoted** in the
rendered command (plugin cache paths can contain spaces). The line joins the never-dropped
preamble of the 10k `SESSION_BUDGET_CHARS` render, costing at most one lowest-ranked entry —
the same trade the ADR-0049/ADR-0063 pins already made, stated here so it is a decision and
not a side effect.

### §2 Doctor write-probe (shape depends on §0)

`vfkb doctor` gains a `write-health` line. The probe's write target is **not**
`entries.jsonl`: "append then remove" doesn't exist in an append-only log (the only delete is a
tombstone — two permanent lines per doctor run), and a "probe namespace" inside `entries.jsonl`
still dirties the working tree and grows the committed file on every run. The presumptive shape
is a **round-trip against a non-entries file in the brain dir** (write + read-back + unlink of
`.journal/.probe` or similar) — the same filesystem/permission path an entry append takes, zero
pollution of the committed log. Doctor is the CLI face, so this checks the *engine +
filesystem* path an agent would fall back to — it deliberately cannot vouch for the MCP
client's pipe, and its wording must not overclaim (the `6ad98196b5a2` lesson: a diagnostic that
invites a false inference is a bug).

### §2a The engine-ownable loudness floor — buildable now

#176's core sentence — *"a failed kb_add must never appear to succeed"* — has a deterministic,
probe-independent slice: a unit check that the MCP server maps **every engine throw to an
explicit tool error** (`is_error`/error content), never an empty-success shape. Cheap, in-scope,
and exactly the ADR-0051 §3 content-assertion discipline applied to the capture path.

### §3 External escalation (blocked tier, named)

If §0 shows the client swallows server death silently (no error surfaced to the model on a
tool call), that is a Claude Code defect to report upstream — filed like the PostToolUse
failed-call gap (open finding 1 in CLAUDE.md), tracked as external-blocked, not worked around
with engine theater.

## Alternatives considered / deliberately not done

- No engine-side heartbeat/reconnect machinery (the client owns the pipe).
- No automatic dual-path writes (MCP + CLI simultaneously) — capture must stay deliberate;
  a hidden second writer would double-write every entry or silently mask the very failure this
  RFC wants loud.
- No entries.jsonl-polluting probe shapes (§2 names why both obvious ones are wrong).

## Consequences

- One more never-dropped preamble line in every injected bundle (≈1 lowest-ranked entry of
  budget, §1).
- The failure taxonomy becomes explicit: engine+fs path (doctor-checkable), MCP handler mapping
  (§2a unit-checkable), MCP client pipe (external, §0-probeable, §3-escalatable) — each layer
  owned and named instead of one undifferentiated "writes stopped working".

## Definition of Done

- §0: probe committed with recorded findings (observed, not asserted) — this is Tier-0 probe
  territory per the DoD matrix in ADR-0029 ("external contract → a Tier-0 probe").
- §1: deterministic unit test (fallback line renders inside budget); its *usefulness* is
  probe-gated evidence, not an L4 of its own — the line is instruction text, and per ADR-0022
  a purpose-L4 belongs where the capability is (an agent using the fallback under a killed
  server would ride the §0 probe's harness if §0 proves the failure reproducible).
- §2: unit-tested + a doctor L4 re-pin only if the doctor scenario surface changes
  (gotcha `7bd9302b351e` precedent: touching doctor wording invalidates its L4).
- §2a: deterministic unit test over the MCP handler's error mapping (engine throw → explicit
  tool error, never empty success).

## Rollout

§1 is a render change (engine → ADR-0062 re-vendor cycle). §0 runs from this repo, metered,
one-time. §2/§3 build order and shape decided **after** §0's findings land — the RFC binds the
sequence, not the final §2 design.
