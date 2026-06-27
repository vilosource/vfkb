# ADR-0022: L4 evaluation methodology = dockerized, reproducible, contrast-based, multi-trial, dual-harness

- **Status:** Accepted
- **Date:** 2026-06-27
- **Deciders:** operator + Claude
- **Origin:** the 2026-06-27 L4 coverage audit (Track 1 — M1–M3 — had unit backstops but **zero**
  agent-level/L4 coverage) + operator fork decisions this session (driver = self-contained docker
  images; sequencing = methodology substrate before new scenarios). This is the first ADR of record
  for the L4 harness, which until now had **none**.
- **Applies / extends:** the existing L4 harness (`scenarios/l4-purpose.mjs`, `scenarios/compare.mjs`,
  `scenarios/records/`). Governs the substrate the harness runs on; does **not** change what a scenario
  asserts. Bounded by [ADR-0005](ADR-0005-injection-filters-stale.md) (the 10k inject budget under test),
  [ADR-0013](ADR-0013-no-hard-native-dep.md) (no native dep on the hot path), and
  [ADR-0015](ADR-0015-cross-harness-auto-layer.md) (the Tier-A/B/C surfaces a scenario exercises). The
  features under test are [ADR-0020](ADR-0020-session-continuity-record.md) /
  [ADR-0021](ADR-0021-auto-distill-and-curator.md); first dogfood target is vtfkb's own brain
  ([ADR-0019](ADR-0019-self-hosted-design-brain.md)).

## Context

The L4 harness proves vtfkb fulfils its **purpose** — a real agent behaves better *because of* vtfkb —
by running each scenario as a black-box contrast (`vtfkb` vs a `naive`/`none` baseline) and asserting on
observable effects, never self-report. That design is sound and is preserved here.

But the harness drives **host-installed** `claude` and `pi` against unpinned models, using the operator's
auth and global MCP config. Five consequences:

1. **Not reproducible** — records name the model but not the harness/image version; a re-run is not
   guaranteed to reproduce.
2. **Leak-control by fragile denylist** — `FS_DENY`, `--strict-mcp-config`, and an empty MCP config exist
   *only because* the agent runs on the host with the operator's real Anthropic auth and real connected MCP
   servers (Atlassian/Gmail/…). Defense-in-depth done with CLI flags.
3. **Host contamination / privacy** — the test runs against the operator's real subscription, `~/.pi`, and
   global MCP.
4. **Single-shot, stochastic** — one pass per scenario cannot distinguish a genuine model divergence
   (`tool-gating`, `capture-recall`) from flakiness.
5. **No CI path** (host-bound), and **no ADR of record** for the methodology.

The redesign is also a **simplification**: in a container with no host FS, no host creds, and no user MCP
servers, weaknesses #2/#3 largely evaporate — *the container is the sandbox*, so the denylist gymnastics
mostly disappear and Claude Code can run with full tools (its recommended autonomous mode). Track 1's
**cross-session** scenarios (resume render, auto-distill→recall) need exactly this clean, reproducible
multi-session substrate.

## Decision

The L4 harness runs each agent inside a **pinned, self-contained container**; the node harness shells
`docker run` instead of a host binary. The contrast methodology and assertion style are unchanged.

1. **Self-contained images, not an external orchestrator.** A `scenarios/docker/` holds one Dockerfile per
   harness — `pi.Dockerfile` (node + `pi` + `DEEPSEEK_TOKEN`) and `claude.Dockerfile`
   (node + `@anthropic-ai/claude-code`). vtfkb stays self-contained and CI-portable. (Rejected: delegating
   to the `vfa`/vf-agents orchestrator — see Alternatives.)
2. **Brain mounted, uid-matched.** The per-scenario brain is bind-mounted; the container runs
   `--user $(id -u):$(id -g)` with `HOME` set so the agent's writes (`entries.jsonl`, `.sessions/<id>.json`)
   persist to the host mount. Non-negotiable: cross-session scenarios depend on session 1's container
   persisting state that session 2's container reads (the silent-write-fail-on-uid-mismatch gotcha).
3. **Cross-session via threaded `KB_SESSION_ID` + shared brain mount** — the proven kb-spike pattern: a
   scenario's separate containers share one brain and one session id so `SessionState` carries across them.
4. **Container is the sandbox.** With no host FS, no host creds, and an egress allowlist to the model API
   only, the leak surface collapses; the host-era `FS_DENY`/`--strict-mcp-config` workarounds are dropped
   (their removal is gated on a no-leak check, not assumed).
5. **Multi-trial, not single-shot.** Each scenario runs **N=3** trials; `demonstrated` requires the
   contrast to hold on **≥2/3**. This separates flakiness from genuine model divergence.
6. **Records pin the substrate.** Each record adds the **image digest** + model id + per-scenario trial
   pass-rate; `compare.mjs` renders pass-rate, not a single YES/NO. The record/compare file contract is
   otherwise preserved.
7. **L4 tests purpose, not invariants.** Structural safety rails (the curator never-rewrite Brake,
   append-only counters) stay **deterministic unit tests** ([ADR-0021](ADR-0021-auto-distill-and-curator.md)
   §5; principle #4); L4 only exercises agent-observable behavior. The substrate is itself validated by a
   deterministic backstop: the existing 22 scenarios must **reproduce in-container** (within trial tolerance)
   against the known-good host records before any new scenario is trusted on it.
8. **Claude-code auth is a named prereq, not a blocker.** The host `claude` uses an OAuth/subscription login;
   headless container Claude Code needs explicit auth. Recommended: an `ANTHROPIC_API_KEY` injected as a
   container env var (headless + CI + reproducible). The `pi`/deepseek image works today and is built first;
   the claude-code image is gated only on the operator supplying auth when that slice is reached.

## Consequences

- **+** Reproducible (image digest pinned), CI-able, privacy-clean (no host auth/MCP in the sandbox), and
  *simpler* (the denylist workarounds go away). Trial stats expose flakiness.
- **+** Gives Track-1's cross-session scenarios a clean multi-session home; unblocks Track 4.
- **−** Two images to build + maintain, and the uid/session/mount plumbing the host harness got for free
  from running natively. Accepted — it is the cost of reproducibility.
- **−** The claude-code image adds an auth dependency (API key + metered cost) distinct from the operator's
  subscription. Mitigated by building the pi image first and gating the claude image on auth.
- **Neutral:** scenario semantics, the `vtfkb`/`naive`/`none` contrast, and the observable-effects rule are
  unchanged; this ADR governs *where* the agent runs, not *what* is asserted.

## Alternatives Considered

- **Keep the host harness, just add Track-1 scenarios.** Rejected — the new scenarios are cross-session and
  would inherit every reproducibility/leak weakness, then need re-porting.
- **Delegate to the `vfa`/vf-agents orchestrator (mykb's kb-spike path).** Rejected for vtfkb — proven and
  fast, but its "claude-code" path is the z.ai GLM backend (**not** real Anthropic Claude, low fidelity to
  how executors run), and it couples vtfkb's tests to the vf-agents stack. We borrow its *patterns*
  (per-experiment build capture, `KB_SESSION_ID` threading, specimen protection, commit-every-step audit)
  without the dependency.
- **z.ai/GLM proxy for the "claude" harness.** Rejected as the default — avoids an Anthropic key but tests a
  different model than production executors; may be offered as an opt-in low-cost tier later.
- **Single-shot kept for speed.** Rejected — stochastic L4 needs trials to be trustworthy; cost is bounded
  by a cheap default model tier (haiku/flash).
- **Commit the images / records to a registry.** Out of scope — images build from the Dockerfiles in-repo;
  records stay committed text artifacts.

## Related

[ADR-0019](ADR-0019-self-hosted-design-brain.md) (dogfood target), [ADR-0020](ADR-0020-session-continuity-record.md)
+ [ADR-0021](ADR-0021-auto-distill-and-curator.md) (features under test), [ADR-0005](ADR-0005-injection-filters-stale.md),
[ADR-0013](ADR-0013-no-hard-native-dep.md), [ADR-0015](ADR-0015-cross-harness-auto-layer.md).
Code: `scenarios/l4-purpose.mjs`, `scenarios/compare.mjs`, `scenarios/records/`, and the new
`scenarios/docker/`. Roadmap: [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) Track 5 (substrate)
→ Track 4 (Track-1 scenarios). Prior art: mykb `scripts/spike/` (kb-spike container harness). Evidence:
the 2026-06-27 L4 coverage audit; the host-harness leak-control comments (`l4-purpose.mjs` lines 94–102).
