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
  code is ignored**) — so it is a *cleanup/commit* hook, never a Brake on exit itself. **Scope of the
  proof:** observed under `claude -p` (one-shot); **interactive `/exit` was not headlessly testable** —
  treated as inferred-from-docs, to confirm during build (mirrors RFC-008's print/non-print residual).
- **It can run arbitrary shell commands** (10-min timeout per docs) with **`cwd` = the project dir**
  (observed — the hook wrote files at the project cwd). → a `git` commit from the hook targets the right
  repo. **GAP 2 is feasible.** *(Caveat: arbitrary execution + cwd are observed; the specific
  `git commit` from inside the hook is inferred — confirm in the smoke-gate.)*
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

**The load-bearing implication:** SessionEnd can **commit** (GAP 2) but **cannot prompt** (GAP 1). GAP 2
therefore has a clean home (SessionEnd) and is the **primary safety net** — once the brain is
auto-committed, *whatever* the agent recorded (including any handoff it did write) survives `/exit`.
GAP 1 has **no clean home**: the only injectable surface is the **Stop hook**, which fires **every
turn**, whereas a handoff is an **end-of-session** artifact. That mismatch (detailed in B) is the
central open design question of this RFC — not a settled "put it on Stop."

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
   preserve continuity") so the user is informed, then exit 0. **Never commits to `main`.** *(`systemMessage`
   is a documented SessionEnd output field and appears in the verified allowed-fields list, but was not
   itself exercised in the probe — confirm in the smoke-gate.)*
3. **Pathspec-scoped commit (NOT a bare `git commit`).** On a topic branch, commit **only**
   `.vfkb/entries.jsonl` *regardless of what else is staged* — a bare `git add … && git commit` would
   sweep in **any files the operator had already staged** for their own commit. Use a pathspec/only
   commit: `git commit -o -- .vfkb/entries.jsonl -m "<msg>"` (`-o`/`--only`, which stages just that path
   for this commit and leaves the rest of the index untouched). Never `git add -A`. Message is
   deterministic + **attribution-free** (e.g. `chore(brain): session-end auto-commit (<n> new entries,
   session <id8>)`) — honors the global no-AI-attribution commit-msg hook and the "only `entries.jsonl`
   is committed" rule (ADR-0019).
4. **Does not push / open a PR.** The commit makes the brain **durable and part of the branch** that
   becomes the operator's PR; push/PR stays the operator's call (branch + PR-first).

### B. GAP 1 — the handoff (open: two flawed surfaces, decide before building)

GAP 1 needs *a committed `handoff`/`next` entry to exist at session end*. The
**timing mismatch** above means neither available surface is clean — this section lays out both rather
than asserting one:

**Option B1 — a `Stop`-hook handoff nudge** (the decision-capture/ADR-0027 pattern). The only surface
that can *prompt the agent* (so the handoff is agent-authored = high quality), but it fires **per turn**
while a handoff is needed **once, at the end**. Naively it would nag from turn 1 onward. Survivable only
with strong gating: native `stop_hook_active` guard (gotcha `d70c0299`); fire **at most once per
session**; and only on a **strong end-of-session signal** (e.g. ≥N entries added this session with no
`handoff`/`next` fact). Even gated, it may fire mid-session (a hook can't know the session is about to
end) — *premature-nag risk is inherent.*

**Option B2 — SessionEnd auto-*derives* a fallback handoff.** At true session end (no timing
mismatch), read `transcript_path` (`.jsonl`), summarize the last turn / extract any "next:"/"TODO"
intent, and write a `fact` tagged `handoff,next` before the GAP-2 commit. Correct *timing*, but
**lower quality** (machine-derived, no chance to ask the agent to improve it) and it must avoid
duplicating a handoff the agent already wrote.

**Recommendation (revised from the first draft):** GAP 2 is the real safety net and ships first. For
GAP 1, lead with **B2 as the reliable floor** (always leaves *something* committed at the right moment)
and add **B1 only as a gated, once-per-session quality nudge** — not the other way round. Final call is
an open item (see below); the L4 scenario should contrast B1, B2, and B1+B2 to decide empirically.

Either way the handoff is a **committed entry** (`fact` tagged `handoff,next` via `kb_add`), **not** a
`resume-note` (sessions are gitignored → invisible cross-clone, ADR-0019).

Together: at `/exit` the brain is **auto-committed on the working branch** (GAP 2, primary) and a
**committed handoff entry exists** (GAP 1, B2 floor + optional B1 nudge) — `/exit` is **safe by
default**.

## Alternatives

- **Prose rule only (status quo).** The gap itself — easily skipped (ADR-0021).
- **Auto-commit on `main` too.** Rejected — violates `34f2f2da` (never commit to `main`).
- **`git add -A` in the SessionEnd hook.** Rejected — would sweep unrelated, unreviewed `src/`/`docs/`
  changes into an unreviewed auto-commit; scope to `entries.jsonl` only.
- **GAP 1 via the `Stop` nudge *as primary* (the first draft's position).** Reconsidered — the Stop
  hook fires per-turn but a handoff is end-of-session, so a Stop-only approach either nags mid-session
  or risks leaving no handoff at all. Demoted to the **gated, optional B1 nudge** (see §B); B2 is the
  floor.
- **Auto-push / auto-open-PR at SessionEnd.** Rejected — push is outward-facing and the operator owns
  the PR/merge step (branch + PR-first).
- **A non-blocking `systemMessage` reminder at SessionEnd instead of any handoff write.** Reminds the
  *user* after the agent is gone — too late for the agent to author or improve the entry. Kept only for
  the `main`-branch warning (case A.2).

## Definition of Done (ADR-0029) — proof fits the capability

- **GAP 2 (wiring/mechanism) → a deterministic sandbox smoke-gate** (ADR-0028 style,
  `scenarios/session-end-commit.mjs` or a unit harness): in a throwaway git repo, add a brain entry,
  fire the SessionEnd hook, assert (a) on a topic branch → `.vfkb/entries.jsonl` **and only that file**
  is committed with an attribution-free message; **must-fail arm:** on `main` → **not** committed +
  warning emitted; (b) no-change → no commit.
- **GAP 1 (agent-facing) → an agent-driven L4 scenario** (`scenarios/session-end-handoff.mjs`, mirrors
  `decision-capture.mjs`): a sandbox session does work and ends; assert a **committed `handoff` entry**
  is present and recallable; **contrast arm:** all GAP-1 mechanisms OFF → no handoff entry. To settle
  §B empirically, the scenario should compare **B1 (Stop nudge), B2 (SessionEnd auto-derive), and
  B1+B2** on entry presence *and* quality (does it name a real "next?"). DEMONSTRATED per ADR-0022
  (≥2/3).
- Both **capable of failing**, **isolated from the live dogfooded `.vfkb`**, **observed not asserted**,
  **before declaring done**.

## Open items

1. ~~**Empirically verify** the SessionEnd hook contract (exists? stdin/stdout? can it run commands?)~~
   **DONE (2026-06-30)** — see Findings; gotcha `f0e913b97824`.
2. **Decide the GAP-1 surface (§B)** — B2 floor + gated B1 nudge (recommended), B2-only, or B1-only.
   Settle via the L4 contrast (DoD). This is the RFC's central open question, created by the
   per-turn/end-of-session timing mismatch.
3. **Finalize the GAP-1 trigger** — for B1: per-session baseline (entry-count delta since SessionStart),
   fire **at most once per session**, strong-signal only; for B2: how to detect/avoid duplicating an
   agent-authored handoff already present this session.
4. **Branch-detection robustness** — default-branch name may not be `main` in a consumer repo; detect
   via `git symbolic-ref refs/remotes/origin/HEAD` (fallback `main`), and treat detached-HEAD as
   "don't commit, warn."
5. **Confirm in the smoke-gate** the two inferred-not-observed points: an in-hook `git commit -o --`
   actually commits on a topic branch, and `systemMessage` surfaces the `main`-branch warning.
6. **Decide accept → ADR** (candidate **Track 8** in the roadmap; re-ratify) and wire
   `.claude/settings.json` + `vfkb init` emission **only after** the smoke-gate is green (ADR-0028), or
   **withdraw**. Contract is verified; this is now a design-acceptance call.
