# Probe: what does an agent observe when the vfkb MCP server dies mid-session?

**ADR-0065 §0** · Tier-0 probe · run `node scenarios/probes/mcp-disconnect.mjs [--mode kill|hang]`

Records an **external contract** nobody here had observed. It asserts almost nothing — its job
is to say what the current stack actually does, because every §2+ build decision is gated on it.
Designing loudness for a failure shape nobody has seen repeats the mistake ADR-0051 §1
documents: `--plugin-dir` prescribed as "the real surface" without checking.

> Every figure below is read from the committed records
> (`scenarios/records/mcp-disconnect.json`, `…-hang.json`, both `recordVersion: 2`).
> An earlier draft of this doc quoted timings from a *different, earlier run* than the one it
> shipped — do not restate numbers here from memory; read the record.

## Method

`mcp-disconnect-server.mjs` proxies the **real** `dist/mcp-server.js` and kills it after the
first `tools/call`. Death is therefore **deterministic and caused by the agent's own activity**,
not a timer racing the turn — so a red run can't be confused between "the agent saw nothing" and
"we killed it too late". Everything before the kill is genuine `vfkb-mcp` behaviour.

The two modes are genuinely different failures:

- **`kill`** — the whole wrapper exits, severing the transport. The process is *gone*.
- **`hang`** — the backend is killed but the wrapper stays alive holding the pipe open. The
  process is *present and mute*, so nothing signals that a restart is needed.

The wrapper logs a `starting` event on every spawn. That line is load-bearing: without it a
fresh spawn and a second pre-existing instance are indistinguishable, since both would log their
first call as `n:1`.

Evidence comes from the `stream-json` transcript, correlating `tool_result` blocks back to
`kb_*` `tool_use` ids, **plus** the brain file and the wrapper's own log. The agent's prose
answers are recorded separately as a *claim*, to be compared against the transcript rather than
trusted as the observation.

## Findings (2026-07-19 · CLI 2.1.215 · claude-haiku-4-5 · N=1 per mode)

| | `--mode kill` (process exits) | `--mode hang` (alive, mute) |
|---|---|---|
| server **spawns** observed | **3** over 63.5 s | **1** |
| respawned by the harness | **yes** | **no** |
| `kb_*` calls / results returned | 3 / **3** | 2 / **1** |
| any result flagged `is_error` | no | no |
| write #1 landed | yes | yes |
| write #2 landed | **yes** | **no** |
| retry landed | **yes** | **never issued** — the turn wedged on call #2 |
| agent's turn | completed normally | **timed out** (`spawnSync claude ETIMEDOUT`) |
| **write silently lost** | **no** | **YES** |

### What this means

- **A crashed server is benign on this stack.** Three distinct spawns with three distinct pids were observed, each followed by an exit — so the harness genuinely *restarts* an exited stdio
  MCP server, and both the second write and the retry succeeded. Nothing is lost; building
  recovery for this would be engine theatre.
- **A hung server is the real #176.** The process never exits, so nothing signals a restart. The
  second call never returned, the write is lost, no error was raised, and the turn hung until
  the harness timeout.

### Consequences for §2 (the doctor write-probe)

1. **Liveness ≠ health.** A check asking "is the MCP process running?" reports **healthy** in the
   one case that loses data. §2 must probe **responsiveness** — a bounded round-trip — not
   process existence. One observed hang is enough to falsify "process-running implies healthy".
2. **The crash path needs no engine work.**
3. **The damage is a wedged turn, not just a lost entry**, so any §2 design needs its own
   timeout or it inherits the same hang.
4. **Doctor cannot see this failure at all.** It is the CLI face; the loss happens in the MCP
   pipe. Its wording must therefore not let a reader infer that capture is healthy — the
   `6ad98196b5a2` lesson, where a diagnostic was made *more confident rather than more true*.

## Honest limits

- **N=1 per mode**, one model, one CLI version. A Tier-0 probe records a contract; it does not
  prove a capability (ADR-0029).
- **"No error surfaced" in hang mode is bounded, not a contract.** It means "no error within the
  probe's own 300 s timeout" — *we* ended the turn. Whether the client would eventually raise an
  MCP request timeout is **uncontrolled and unknown**.
- **"Whether `kb_*` tools remain listed" is NOT observable from the transcript.** §0 asks for it,
  and the answer is that the stack does not expose it: the `system` init event enumerates only
  the 29 built-in tools (`Task`, `Bash`, …) and never the MCP tool names. The sole MCP signal is
  `mcp_servers[].status`, which reads `pending` at init. So that question is answerable today
  only from the agent's self-report — which in hang mode never arrived, because the turn timed
  out. Recorded as a gap in the observation surface, not as a finding.
- The hang column comes from the transcript and the brain file, both independent of the agent's
  self-report.
- **UNVERIFIED:** whether repeated crashes eventually exhaust the harness's respawn appetite; and
  whether a server that dies *during* a call rather than after one completes behaves like either
  column. Neither was exercised.
