# ADR-0015: Cross-harness auto-layer adopts a tiered parity model; per-turn injection is Pi-only on Claude Code (MCP-pull floor); a narrowed Phase 0 spike settles attention/cache/budget

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** operator (delegated "find the best solution") + Claude

## Context

D7 commits to a **per-harness auto-layer** (context injection + passive capture)
over one engine, for a multi-harness fleet: **Pi** (architect, in-process TS
extension) and **Claude Code** (executor/judge, CLI/hooks). IMPL-PLAN §3 D-E /
§8 risk 1 flagged the *Claude Code* side as the **load-bearing cross-harness
unknown** — capability seemed to exist (`SessionStart`/`UserPromptSubmit` inject;
`Pre/PostToolUse` capture) but the **mechanics** (reliable per-turn reach, prompt-
cache cost, structured output) were unverified, so the plan deferred the whole thing
to a Phase 0 spike.

This session we **verified the Claude Code hook surface against the official docs +
the live issue tracker** (claude-code-guide agent, 2026-06-03). The findings let us
*decide* most of D-E now instead of deferring it wholesale:

- **`SessionStart` injection — stable + cache-optimal.** Hook emits
  `hookSpecificOutput.additionalContext` (≤ **10,000 chars**, wrapped in
  `<system-reminder>`); it becomes part of the static system prefix → **cached every
  turn**. ([Hooks Reference](https://code.claude.com/docs/en/hooks.md),
  [Prompt Caching](https://code.claude.com/docs/en/prompt-caching.md))
- **`UserPromptSubmit` (per-turn) injection — supported but documented-UNRELIABLE
  and cache-inefficient.** Confirmed bugs: registration drops after editing
  `.claude/hooks/*` mid-session; intermittent firing (Windows); early-session /
  post-compaction race; non-execution when started from a subdirectory; v2.0.77+
  initial-prompt regression. Per-turn `additionalContext` also appends to the payload
  each turn (grows the prefix). ([#56631](https://github.com/anthropics/claude-code/issues/56631),
  [#37988](https://github.com/anthropics/claude-code/issues/37988),
  [#8810](https://github.com/anthropics/claude-code/issues/8810),
  [#10225](https://github.com/anthropics/claude-code/issues/10225))
- **`PostToolUse` / `PreToolUse` capture — reliable**, full `tool_name` +
  `tool_input` + `tool_result` on stdin. ([Hooks Reference](https://code.claude.com/docs/en/hooks.md))

## Decision

Adopt cross-harness D7 with a **tiered parity model** grounded in the verified hook
surface, and keep the **MCP server (D5a) as the guaranteed floor** so Claude Code is
never worse than MCP-pull on any tier.

1. **Tier A — session-start injection: FULL cross-harness parity.** The bulk of D7a
   — Context Map (ADR-0006), Agent Constitution (ADR-0008), `vision` patterns
   (ADR-0010), journal/recency (L5) — is injected at session start: Pi in-process,
   Claude Code via `SessionStart.additionalContext`. Both stable and cache-optimal.
   **High confidence.**
2. **Tier B — passive capture: FULL cross-harness parity.** Tool-call capture: Pi
   `Pre/PostToolUse` equivalents, Claude Code `PostToolUse` (reliable, full payload).
   Feeds D7b. **High confidence.**
3. **Tier C — per-turn signal-driven delta injection: Pi-only in v1.** Claude Code's
   `UserPromptSubmit` is documented-unreliable + cache-inefficient → vtfkb does **not**
   build a per-turn *push* on Claude Code. There, dynamic mid-session need degrades to
   **MCP-pull** (the agent calls `kb_search`/`kb_map` when it needs more). The Pi
   extension keeps per-turn push (its in-process `context` hook is reliable).
4. **Cross-harness session-start bundle is budgeted to the tightest harness:** the
   Tier-A bundle must fit Claude Code's **10,000-char `additionalContext` cap**. This
   makes the ADR-0006 Context Map + ADR-0008 Constitution + ADR-0010 vision + recency
   a **budgeted, summarized** payload, not an unbounded dump — feed this constraint
   back into ADR-0006/0008 rendering. (Pi has no such cap; design to the tighter one.)
5. **Phase 0 spike is RETAINED but NARROWED.** It no longer asks "do hooks work"
   (verified: yes for `SessionStart`/`PostToolUse`; no for reliable `UserPromptSubmit`
   push — do not re-spike that). It settles the three things the docs do **not**:
   - **Attention:** does the `SessionStart` `<system-reminder>` block actually get
     *used* by the model? Assert via an **external effect** (the agent uses an
     injected fact), never self-report.
   - **Cache cost:** measured prompt-cache behaviour of the session-start block over
     a long session.
   - **Budget fit:** does the Tier-A bundle fit / how to summarize within 10k chars.
   Pass/fail gate (closed): an engine-injected fact appears and is *used* in **both**
   harnesses; a tool-call is captured in **both**; the bundle fits the cap.

## Consequences

- **+** Converts the "load-bearing unknown" into a mostly-decided design with cited
  evidence: the high-value paths (session-start inject, capture) are **verified-
  feasible at parity**; only per-turn *push* degrades on Claude Code.
- **+** The MCP floor (D5a) means Claude Code never falls below pull — the degrade in
  Tier C is graceful, design holds, value lower only on the dynamic path.
- **+** Phase 0 is now a **closed, cheap** spike (3 measurable questions), not an
  open-ended feasibility hunt — honours design-first / runbook-complete discipline.
- **+** Surfaces a concrete new constraint (10k-char session-start budget) early,
  before ADR-0006/0008 rendering is built.
- **−** Claude Code executors/judges get **no per-turn auto-push** in v1 (they pull
  via MCP). Accepted: per-turn push on Claude Code is unreliable today; revisit when
  the cited `UserPromptSubmit` bugs are fixed (a future ADR superseding Tier C).
- **−** A harness-specific divergence (Tier C asymmetric) to document and test per
  harness — bounded, and the asymmetry is forced by the harness, not our design.

## Alternatives Considered

- **Defer all of D-E to the spike (the plan's original posture).** Rejected: the doc
  + issue-tracker verification already settles most of it; spiking to rediscover the
  `UserPromptSubmit` unreliability would waste the Phase 0 budget.
- **Insist on full per-turn push parity (build `UserPromptSubmit` push on Claude
  Code).** Rejected: documented-unreliable + cache-inefficient; would ship a flaky
  safety/context path. MCP-pull is the honest floor until the bugs are fixed.
- **Drop Claude Code from the auto-layer entirely, Pi-only D7.** Rejected: throws
  away Tier-A/Tier-B parity that is verified-feasible and high-value for the
  executor/judge harness; the fleet is genuinely multi-harness.
