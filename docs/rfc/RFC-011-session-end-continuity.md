# RFC-011: Session-end continuity — safe-by-default `/exit`

- **Status:** **Proposed** (2026-06-30; SessionEnd contract empirically verified)
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Relates:** [ADR-0019](../adr/ADR-0019-self-hosted-design-brain.md) (the brain ships **inside**
  the repo; only `.vfkb/entries.jsonl` is committed), [ADR-0020](../adr/ADR-0020-session-continuity-record.md)
  (the resume **digest** is already auto-derived), [ADR-0021](../adr/ADR-0021-auto-distill-and-curator.md)
  (the **"a prose rule with no Brake gets ignored"** lesson), [ADR-0027](../adr/ADR-0027-stop-hook-decision-capture-reminder.md)
  (the **Stop-hook reminder** pattern — the model GAP 1 reuses), [ADR-0028](../adr/ADR-0028-sandbox-validate-auto-layer-wiring.md)
  (wiring smoke-gate), [ADR-0029](../adr/ADR-0029-sandbox-proven-definition-of-done.md) (sandbox-proven
  DoD), the **branch + PR-first** workflow (brain decision `34f2f2da` — **never commit to `main`**),
  `CLAUDE.md` ("How we track work HERE").

## Context

Session **start** continuity is solid (SessionStart injects the auto-derived resume digest + knowledge
bundle, ADR-0020). Session **end** has two gaps that make `/exit` **unsafe by default**:

- **GAP 1 — no durable handoff auto-capture.** The wiring has SessionStart / PreToolUse / Stop hooks
  but **no SessionEnd hook**, and the Stop hook only *reminds about decisions* (ADR-0027) — it does not
  write a "next session, pick up X" handoff. So the handoff pointer is **hand-recorded as a `fact` every
  time** (e.g. this task's own entry `d23912cae7c1`). Easy to forget — and a forgotten handoff is
  exactly the continuity loss this substrate exists to prevent.
- **GAP 2 — nothing auto-commits the brain.** The brain ships **inside** the repo (ADR-0019); only
  `.vfkb/entries.jsonl` is committed (sessions/signals/index-meta are gitignored, derived/local). On
  `/exit`, new entries added this session sit **uncommitted** → invisible to a fresh clone and to the
  next session that pulls. Cross-clone continuity lives in **committed entries** (CLAUDE.md), so an
  uncommitted brain silently breaks it.

vfkb's own lesson (ADR-0021): **a prose rule with no Brake gets ignored.** "Remember to commit the
brain" is such a rule. We want a **mechanism**, not more prose.

## Findings (EMPIRICALLY VERIFIED 2026-06-30, CLI v2.1.196)

Probed with a self-capped SessionEnd hook driven by `claude -p` in a throwaway sandbox, cross-checked
against the official docs (`code.claude.com/docs/en/hooks.md`). Pinned to v2.1.196 — re-verify on
version change. Brain: gotcha `f0e913b97824`.

- **`SessionEnd` fires** — confirmed (fired on `claude -p` completion). Per docs it also fires on
  `/clear`, logout, resume, crash, Ctrl-C. It **cannot block or delay exit** (fire-and-forget; **exit
  code is ignored**) — so it is a *cleanup/commit* hook, never a Brake on exit itself.
- **It can run arbitrary shell commands** (10-min timeout per docs) with **`cwd` = the project dir**
  (observed). → `git add .vfkb/entries.jsonl && git commit` targets the right repo. **GAP 2 is
  feasible.**
- **stdin fields:** `session_id`, `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `reason`.
  ⚠️ **No `last_assistant_message`** (unlike the Stop hook) — to *derive* anything from the turn, the
  hook must read `transcript_path` (`.jsonl`).
- **`reason` enum** (docs): `clear | resume | logout | prompt_input_exit | bypass_permissions_disabled |
  other`. **DISCREPANCY (verification-first):** docs say `-p` ⇒ `prompt_input_exit`, but **observed**
  `claude -p "arg"` ⇒ `reason:"other"` (`prompt_input_exit` is for **piped** stdin EOF, not an arg
  prompt). → a `reason` **matcher is brittle**; run on **all** reasons and guard inside the hook.
- **stdout is schema-validated** — emitting the Stop-hook shape
  (`{hookSpecificOutput:{additionalContext}}`) **fails validation** with a visible (non-fatal, exit 0)
  warning. **`additionalContext` does nothing at SessionEnd** — the session is ending, so a SessionEnd
  hook **cannot inject context / prompt the agent.** A **silent** hook (no stdout) is clean (confirmed).

**The load-bearing implication:** SessionEnd can **commit** (GAP 2) but **cannot prompt** (GAP 1). So
the handoff *prompting* must live on the **Stop hook** (which *can* inject — ADR-0027's verified
contract), and SessionEnd is the **commit** mechanism.

## Proposed design (recommended — to finalize)

Two cooperating mechanisms, mirroring the RFC-008 → ADR-0027 build:

### A. GAP 2 — a `SessionEnd` hook that auto-commits the brain, **safely** (`vfkb hook session-end`)

Wired as a new subcommand alongside the existing `hook (session-start|pre-tool-use|post-tool-use|stop)`,
reached through the committed bootstrap (`node .vfkb/bin/bootstrap.mjs cli hook session-end`) and added
to `.claude/settings.json` + emitted by `vfkb init` for consumers.

Behavior (**fail-open** — never error, never block exit):
1. **Nothing to do?** If `git status --porcelain` shows no change to **`.vfkb/entries.jsonl`**, exit 0
   silently.
2. **Branch guard (honors `34f2f2da`).** If on `main` (or the repo default branch), **do NOT commit** —
   emit a `systemMessage` ("vfkb: N new brain entries on `main` left uncommitted — branch + commit to
   preserve continuity") so the user is informed, then exit 0. **Never commits to `main`.**
3. **Scoped commit.** On a topic branch: `git add .vfkb/entries.jsonl` **only** (never `-A` — unrelated
   `src/`/`docs/` changes belong in the operator's reviewed PR), then `git commit` with a deterministic,
   **attribution-free** message (e.g. `chore(brain): session-end auto-commit (<n> new entries, session
   <id8>)`) — honors the global no-AI-attribution commit-msg hook and the "only `entries.jsonl` is
   committed" rule (ADR-0019).
4. **Does not push / open a PR.** The commit makes the brain **durable and part of the branch** that
   becomes the operator's PR; push/PR stays the operator's call (branch + PR-first).

### B. GAP 1 — a `Stop`-hook handoff reminder (extends the ADR-0027 pattern)

Because SessionEnd cannot prompt, the **handoff** is nudged at end-of-**turn** on the Stop hook (the
verified injectable surface), exactly as decision-capture is:
1. **Native loop guard** — honor `stop_hook_active` (gotcha `d70c0299`); allow the stop on re-entry.
2. **Heuristic trigger** — block once when a handoff *plausibly* should exist but doesn't, e.g. the
   session added brain entries / has uncommitted `.vfkb/entries.jsonl` **AND** no `fact` tagged
   `handoff`/`next` was added this session. Inject a reminder to record a **committed handoff entry**
   (`vfkb add fact "next: …" --tags handoff,next` / `kb_add`), *not* a `resume-note` (sessions are
   gitignored → invisible cross-clone).
3. **Not a true Brake** (work-done ≠ handoff-needed) — like ADR-0027, the heuristic only fires the nudge
   at the right moment; the durable backstop is the committed entry once written.

Together: at `/exit`, the agent has been **reminded to leave a committed handoff** (Stop) and the brain
is **auto-committed on the working branch** (SessionEnd) — `/exit` is **safe by default**.

## Alternatives

- **Prose rule only (status quo).** The gap itself — easily skipped (ADR-0021).
- **Auto-commit on `main` too.** Rejected — violates `34f2f2da` (never commit to `main`).
- **`git add -A` in the SessionEnd hook.** Rejected — would sweep unrelated, unreviewed `src/`/`docs/`
  changes into an unreviewed auto-commit; scope to `entries.jsonl` only.
- **SessionEnd auto-*derives* the handoff from the transcript** (read `transcript_path`, summarize the
  last turn, write a `fact`). Possible as a **low-quality fallback** but not the primary: derived
  handoffs are weaker than an agent-authored one, and SessionEnd can't ask the agent to improve it.
  *Open item — include as a fallback only if the Stop nudge proves insufficient.*
- **Auto-push / auto-open-PR at SessionEnd.** Rejected — push is outward-facing and the operator owns
  the PR/merge step (branch + PR-first).
- **A non-blocking `systemMessage` reminder at SessionEnd instead of the Stop nudge.** Reminds the
  *user* after the agent is gone — too late for the agent to write the entry. Kept only for the
  `main`-branch warning (case A.2).

## Definition of Done (ADR-0029) — proof fits the capability

- **GAP 2 (wiring/mechanism) → a deterministic sandbox smoke-gate** (ADR-0028 style,
  `scenarios/session-end-commit.mjs` or a unit harness): in a throwaway git repo, add a brain entry,
  fire the SessionEnd hook, assert (a) on a topic branch → `.vfkb/entries.jsonl` **and only that file**
  is committed with an attribution-free message; **must-fail arm:** on `main` → **not** committed +
  warning emitted; (b) no-change → no commit.
- **GAP 1 (agent-facing) → an agent-driven L4 scenario** (`scenarios/session-end-handoff.mjs`, mirrors
  `decision-capture.mjs`): a sandbox session does work and ends; assert a **committed `handoff` entry**
  is present and recallable; **contrast arm:** Stop-handoff hook OFF → no handoff entry. DEMONSTRATED
  per ADR-0022 (≥2/3).
- Both **capable of failing**, **isolated from the live dogfooded `.vfkb`**, **observed not asserted**,
  **before declaring done**.

## Open items

1. ~~**Empirically verify** the SessionEnd hook contract (exists? stdin/stdout? can it run commands?)~~
   **DONE (2026-06-30)** — see Findings; gotcha `f0e913b97824`.
2. **Finalize the GAP-1 heuristic** — "session added entries / uncommitted `entries.jsonl` AND no new
   `handoff`/`next` fact this session." Per-session baseline (entry-count delta since SessionStart).
   Decide: extend the existing ADR-0027 Stop hook, or a sibling reminder in the same hook.
3. **Branch-detection robustness** — default-branch name may not be `main` in a consumer repo; detect
   via `git symbolic-ref refs/remotes/origin/HEAD` (fallback `main`), and treat detached-HEAD as
   "don't commit, warn."
4. **Decide accept → ADR** (candidate **Track 8** in the roadmap; re-ratify) and wire
   `.claude/settings.json` + `vfkb init` emission **only after** the smoke-gate is green (ADR-0028), or
   **withdraw**. Contract is verified; this is now a design-acceptance call.
5. **Fallback derived handoff** at SessionEnd — keep parked unless the Stop nudge proves insufficient
   in the L4 run.
