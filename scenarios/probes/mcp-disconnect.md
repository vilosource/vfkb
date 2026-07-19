# Probe: what does an agent observe when the vfkb MCP server dies mid-session?

**ADR-0065 §0** · Tier-0 probe · run `node scenarios/probes/mcp-disconnect.mjs [--mode kill|hang]`

Records an **external contract** nobody here had observed. It asserts almost nothing — its job
is to say what the current stack actually does, because every §2+ build decision is gated on it.
Designing loudness for a failure shape nobody has seen repeats the mistake ADR-0051 §1
documents: `--plugin-dir` prescribed as "the real surface" without checking.

## Method

`mcp-disconnect-server.mjs` proxies the **real** `dist/mcp-server.js` and kills it after the
first `tools/call`. Death is therefore **deterministic and caused by the agent's own activity**,
not a timer racing the turn — a red run can't be confused between "the agent saw nothing" and
"we killed it too late". Everything before the kill is genuine `vfkb-mcp` behaviour, so the
recorded shape is real rather than imagined.

Evidence is read from the `stream-json` transcript, correlating `tool_result` blocks back to
`kb_*` `tool_use` ids. The agent's prose answers are recorded **separately**, as a claim to be
compared against the transcript rather than trusted as the observation.

## Findings (2026-07-19 · CLI 2.1.215 · claude-haiku-4-5)

**The two failure shapes are not the same defect, and only one of them is #176.**

| | `--mode kill` (process exits) | `--mode hang` (process alive, never answers) |
|---|---|---|
| server lifecycles observed | **2** — died and was **respawned** | 1 — died, **no respawn** |
| `kb_*` results returned | 2 of 2 | **1 of 2** — the second never returned |
| both writes landed | **yes** | **no** — the second is lost |
| error surfaced to the agent | none | none |
| agent's turn | completed normally | **wedged until the 300 s timeout** (`spawnSync claude ETIMEDOUT`) |
| write silently lost | **no** | **YES** |

### What this means

- **A crashed server is benign on this stack.** Claude Code transparently respawns an exited
  stdio MCP server (observed: two complete lifecycles ~17 s apart, the second serving the retry)
  and the write succeeds. No loss, nothing to build.
- **A hung server is the real #176.** The process never exits, so nothing signals that a restart
  is needed; the tool call never returns, the write is lost, no error is raised, and the turn
  hangs until it times out. This is the "success-shaped nothing" the ADR was written about.

### Consequences for §2 (the doctor write-probe)

1. **Liveness ≠ health.** A check that asks "is the MCP process running?" reports **healthy** in
   the one case that loses data. §2 must probe **responsiveness** — a bounded round-trip — not
   process existence.
2. **The crash path needs no engine work.** Building recovery for it would be engine theatre for
   a case the harness already handles.
3. **The damage is a wedged turn, not just a lost entry.** Any §2 design should be bounded by a
   timeout of its own, or it inherits the same hang.

### Honest limits of this probe

- **N=1 per mode**, one model, one CLI version. This is a Tier-0 probe, not a DEMONSTRATED L4 —
  it records a contract, it does not prove a capability.
- The hang run ended at the harness timeout, so the agent never answered the questionnaire.
  Everything in the hang column comes from the **transcript and the brain file**, both
  independent of the agent's self-report.
- **UNVERIFIED:** whether repeated crashes eventually exhaust the harness's respawn appetite, and
  whether a server that dies *during* a call (rather than after one completes) behaves like
  either column. Neither was exercised.
