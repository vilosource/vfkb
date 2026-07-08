---
type: Decision
title: "ADR-0033: Session-end continuity — SessionEnd brain auto-commit + B2 handoff floor (accepts RFC-011)"
description: "Session-end continuity — a `SessionEnd` brain auto-commit (GAP 2; branch-guarded, pathspec-scoped) + a deterministic B2 handoff floor (GAP 1); B1 nudge open"
status: "Accepted"
timestamp: 2026-06-30
---

# ADR-0033: Session-end continuity — SessionEnd brain auto-commit + B2 handoff floor (accepts RFC-011)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Accepts:** [RFC-011](../rfc/RFC-011-session-end-continuity.md) (the proposal + the empirically
  verified SessionEnd contract). This ADR decides **GAP 2** (the brain auto-commit) and the **GAP 1 B2
  floor** (a deterministic fallback handoff). The higher-quality **B1** Stop nudge + the metered L4
  quality contrast stay open (RFC-011 §B / open items 2–3).
- **Relates:** [ADR-0019](ADR-0019-self-hosted-design-brain.md) (the brain ships *inside* the repo; only
  `entries.jsonl` is committed), [ADR-0020](ADR-0020-session-continuity-record.md) (the resume digest is
  already derived — only the *commit* + *handoff* were missing), [ADR-0021](ADR-0021-auto-distill-and-curator.md)
  (the "a prose rule with no Brake gets ignored" lesson), [ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md)
  (the Stop-hook reminder pattern GAP 1 will reuse), [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md)
  (validate wiring before live), [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) (proof fits the
  capability), the **branch + PR-first** rule (brain decision `34f2f2da` — never commit to the default
  branch).

## Context

Session **start** continuity is solid (SessionStart injects the derived resume digest, ADR-0020).
Session **end** had two gaps making `/exit` unsafe by default: **GAP 1** — no durable handoff
auto-capture (the "next: …" pointer is hand-written every time); **GAP 2** — nothing auto-commits the
brain, so `/exit` leaves new `entries.jsonl` lines uncommitted → invisible to a fresh clone / next
session (cross-clone continuity lives in *committed* entries). "Remember to commit the brain" is a prose
rule, and ADR-0021 says prose rules get ignored — so we want a mechanism.

The **SessionEnd hook contract was empirically verified at CLI v2.1.196** (brain gotcha `f0e913b97824`;
observed under `claude -p`, cross-checked vs `code.claude.com/docs/en/hooks.md`):

- SessionEnd **fires** and can **run arbitrary shell commands** with `cwd` = the project dir → a `git`
  commit from the hook targets the right repo;
- it **cannot block exit** (exit code ignored) and **cannot inject context** (`additionalContext` is a
  no-op; stdout is schema-validated — the Stop-hook shape is rejected). Allowed output includes
  `systemMessage` (a user-facing note);
- stdin carries `session_id`, `transcript_path`, `cwd`, `reason` — **no `last_assistant_message`**.

**Load-bearing implication:** SessionEnd can **commit** (GAP 2) but **cannot prompt** (GAP 1). So GAP 2
has a clean home here; GAP 1's only injectable surface is the per-turn Stop hook, which mismatches an
end-of-session artifact — left open for the L4 to settle.

## Decision

Add a **`SessionEnd` hook — `vfkb hook session-end`** (`src/session-end.ts` + `src/cli.ts`) that
auto-commits the brain, **safely**. This is **not** `git.ts:save()` (that runs a *standalone* brain repo
with `git add -A`); the committed brain ships inside the surrounding project repo, so we commit one
pathspec into *that* repo:

1. **No-op unless dirty.** If `git status --porcelain -- <dataDir>/entries.jsonl` is empty (or cwd is not
   a git work tree), exit 0 silently.
2. **Branch guard (honors `34f2f2da`).** Never commit on the **default branch** (`main`/`master`, or the
   repo's `origin/HEAD`) or a **detached HEAD** — instead surface a `systemMessage` ("N new brain entries
   on `<branch>` left uncommitted — branch + commit …") so the user is informed, then exit 0.
3. **Pathspec-scoped commit.** On a topic branch: `git add -- entries.jsonl` then
   **`git commit -o -m <msg> -- entries.jsonl`** — `--only` commits *just that path even if other files
   are already staged*, so the operator's in-progress staged work is never swept into the auto-commit. A
   bare `git add … && git commit` would have done exactly that (caught in self-review). Message is
   deterministic and **attribution-free** (`chore(brain): session-end auto-commit (<n> new entries,
   session <id8>)`), honoring the no-AI-attribution commit-msg hook and the "only `entries.jsonl` is
   committed" rule (ADR-0019).
4. **No push / no PR.** The commit makes the brain durable and part of the branch that becomes the
   operator's PR; push/PR stays the operator's call.

**Fail-open everywhere.** Malformed stdin, no repo, missing git identity, a rejecting commit-msg hook →
return silently. A SessionEnd hook must never throw (and cannot block exit anyway).

### GAP 1 (handoff) — the B2 deterministic floor (operator-chosen 2026-06-30)

SessionEnd cannot prompt, and the Stop hook fires per-turn while a handoff is an end-of-session artifact
(RFC-011 §B). A constraint settled the surface: **`KB_SESSION_ID` is unset in the live wiring** (gotcha
`e8f324dc3c1a`), so `SessionState`/`resume-note` don't persist — the *only* reliable state-free signal at
hook time is the git-HEAD-delta of `entries.jsonl` (the same signal `stop-reminder.ts` uses). The operator
chose the **B2 deterministic floor** over a metered B1/B2 L4 contrast (deterministic backstop >
probabilistic gate):

- **B2:** at SessionEnd, among the entries appended since `HEAD`, if **none** is tagged `handoff`/`next`,
  write a fallback `fact` (role `executor`, zone `established`, tags `handoff,next,auto`) that
  **enumerates** the session's new entries (id · type · snippet) — then it ships in the same commit. No
  transcript NLP, no session state; a fresh clone always gets a committed pointer to the session's
  contribution (it surfaces via the knowledge bundle, which reads committed entries, not session records).
  If the agent already authored a handoff, B2 stays out of the way.
- **B1** (a Stop-hook nudge to author a *higher-quality* handoff) and the metered L4 quality contrast
  remain the open follow-on — built only on evidence/explicit request.

### Definition of Done (ADR-0029)

Both GAP 2 and the B2 floor are deterministic mechanisms, so the proof is the **deterministic
smoke-gate**, not an L4 scenario: `src/session-end.test.ts` (8 cases against a real throwaway repo) —
GAP 2: commit-on-topic-branch · scoped-to-`entries.jsonl` · attribution-free message · **must-not**
commit on `main` (warns) · **must-not** sweep pre-staged files · no-op when clean · no-op outside a repo;
B2: writes & commits an auto-handoff enumerating the session's entries when none was recorded · stays out
of the way when the agent authored one. Each is capable of failing, isolated from the live `.vfkb`,
observed not asserted. The full `cli hook session-end` path was additionally smoke-validated through the
**bundle** (topic-branch commit + main-branch warning + the committed `[handoff,next,auto]` entry).

### Wiring

Emitted by `vfkb init` (`SessionEnd` in `settingsHooks`, covered by `init.test.ts`) and wired into this
repo's live `.claude/settings.json` via the committed bootstrap, after the smoke-gate was green
(ADR-0028). The bootstrap is generic passthrough — no bootstrap change needed.

## Consequences

- **+** `/exit` is safe-by-default: brain entries are durably committed on the working branch with zero
  ceremony (never on the default branch, never entangling the operator's staged work), **and** a committed
  handoff entry is guaranteed (agent-authored if present, else the B2 fallback enumerating the session's
  work) — so a fresh clone always has a forward pointer.
- **+** Mechanism over prose (ADR-0021); fail-open; deterministic gate; no metered LLM run needed.
- **−** The B2 fallback is a **low-quality floor** (an entry list, not a curated "next: …"). A
  higher-quality agent-authored handoff (B1 Stop nudge) + a metered L4 quality contrast remain open.
- **−** Contract is **version-pinned to CLI v2.1.196** — re-verify on a Claude Code upgrade. Interactive
  `/exit` and the in-hook commit were inferred-from-docs / proven via `claude -p` + the bundle smoke, not
  a true-TTY exit.
- **−** Per-repo default-branch detection is best-effort (`origin/HEAD`, fallback `main`/`master`).

## Alternatives Considered

- **Reuse `git.ts:save()`.** Rejected — it `git init`s a standalone brain repo and `git add -A`s; wrong
  for the committed-in-repo model and would sweep unrelated files.
- **Bare `git add entries.jsonl && git commit`.** Rejected — a plain commit includes any pre-staged
  files; `--only` with a pathspec is required.
- **Commit on the default branch too / auto-push / auto-open-PR.** Rejected — violates branch + PR-first.
- **GAP 1 via the Stop nudge as primary (RFC-011's first draft).** Demoted — per-turn vs end-of-session
  mismatch; the surface is now an open, L4-settled question.

## Related

[RFC-011](../rfc/RFC-011-session-end-continuity.md), [ADR-0019](ADR-0019-self-hosted-design-brain.md),
[ADR-0027](ADR-0027-stop-hook-decision-capture-reminder.md), [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md),
[ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md). Brain: gotcha `f0e913b97824` (verified
contract), `e8f324dc3c1a` (KB_SESSION_ID constraint), decisions `92f046fdf5c7` (RFC-011), `e773cdda83b9`
(self-review). Code: `src/session-end.ts` (GAP 2 commit + B2 `writeAutoHandoff`/`newEntriesSinceHead`),
`src/cli.ts` (`hook session-end`), `src/init.ts` (emission), `src/session-end.test.ts` (8-case gate).
