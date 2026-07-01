# ADR-0035: `vfkb init` anchors the Claude Code hooks to `$CLAUDE_PROJECT_DIR`

- **Status:** Accepted
- **Date:** 2026-07-01
- **Deciders:** operator + Claude
- **Amends:** [ADR-0031](ADR-0031-bootstrap-engine-resolution-guard.md) — refines its premise that a
  bootstrap "committed at a **relative** path … is **always resolvable** in any clone." That holds
  *across clones* but not *across working directories*: the hook wiring implicitly assumed
  `CWD == repo root`, which Claude Code does **not** guarantee for hook execution.
  **Relates:** [ADR-0028](ADR-0028-sandbox-validate-auto-layer-wiring.md) (the wiring this corrects),
  [ADR-0033](ADR-0033-session-end-continuity.md) (the SessionEnd auto-commit a broken hook would skip).
  Fixes **issue #22**.

## Context

`vfkb init` (ADR-0030/0031) wired all four Claude Code hooks with **CWD-relative** paths:

```
VFKB_DATA_DIR=.vfkb VFKB_PROJECT=<proj> node .vfkb/bin/bootstrap.mjs cli hook <phase>
```

Both `VFKB_DATA_DIR=.vfkb` and the module path `.vfkb/bin/bootstrap.mjs` are resolved against the
**current working directory**. Claude Code runs a hook command in the *session's* cwd — which is
**not** guaranteed to be the repo root; it follows any `cd` the session has made (a very common move:
`cd` into a subproject to run docker / a build / tests, where the cwd persists across tool calls). The
moment the cwd leaves the root, **all four hooks fail**:

```
Stop hook error: Cannot find module '/…/<repo>/<subdir>/.vfkb/bin/bootstrap.mjs'  (MODULE_NOT_FOUND)
```

This is latent and silent — everything works while cwd == root, then breaks with no obvious cause. The
most dangerous casualties are **`PreToolUse`** (the brain write-gate stops enforcing) and **`SessionEnd`**
(the continuity auto-commit is skipped). It affects **every** vfkb-onboarded repo, including vfkb itself
(its own `.claude/settings.json` dogfooded the identical relative form). Surfaced while dogfooding the
onboarding path on `vfwb`, whose emitted wiring was byte-identical — confirming an **upstream** bug.

**Empirically verified** (CLI v2.1.197, and corroborated against the official hooks docs) before deciding:

- Claude Code injects **`$CLAUDE_PROJECT_DIR`** (absolute path to the project root) into every hook
  command's environment, and it is **CWD-independent** — a hook that `cd`s to `/tmp` and prints both
  still sees `$CLAUDE_PROJECT_DIR` = the project root while `$PWD` = `/tmp`.
- Hook `command` strings are run through a shell (`sh -c`), so POSIX parameter expansion
  (`${VAR:-default}`) resolves.

## Decision

`vfkb init` emits the hooks **anchored to `$CLAUDE_PROJECT_DIR`, with a CWD-relative fallback** so the
form never regresses when the var is (ever) absent:

```
VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR:-.}/.vfkb VFKB_PROJECT=<proj> \
  node ${CLAUDE_PROJECT_DIR:-.}/.vfkb/bin/bootstrap.mjs cli hook <phase>
```

- `${CLAUDE_PROJECT_DIR:-.}` → the project root when set (always, per the verification), else `.`
  (today's exact behavior) — **strictly non-regressive**.
- `vfkb init` also **upgrades an existing** CWD-relative vfkb hook to the anchored form on re-run
  (dropping the stale vfkb entry and re-appending the current one), while preserving any user hooks —
  so the fix reaches already-onboarded repos, not just fresh ones.
- `vfkb doctor` gains a **`hooks anchor`** check that WARNs when a wired vfkb hook lacks
  `CLAUDE_PROJECT_DIR` (a not-yet-upgraded install).
- **Scope: hooks only.** The `.mcp.json` server stays relative — it is spawned **once** at session
  start with cwd = repo root and is not re-invoked on a later `cd`, so it is not exposed to this bug.
  (Anchoring it would reintroduce the `${…}` arg-expansion dependency ADR-0031 deliberately dropped.)

## Consequences

- **+** Hooks resolve regardless of the session's cwd — the write-gate and SessionEnd auto-commit stay
  reliable. The `:-.` fallback means the change cannot make any current setup worse.
- **+** Re-running `vfkb init` repairs existing installs in place (verified by an upgrade unit test).
- **−** The hook command strings are longer / less obvious. Windows remains out of scope (the env-prefix
  is still POSIX, consistent with ADR-0031).
- **−** ADR-0031's "always resolvable" wording needed this refinement — clone-portable ≠ CWD-independent.

## Alternatives Considered

- **Bare `${CLAUDE_PROJECT_DIR}` (no fallback), as the docs show.** Rejected — if the var were ever
  unset it expands to empty → `node /.vfkb/…` → a hard failure *worse* than the relative form when
  cwd == root. The `:-.` default keeps the floor at today's behavior.
- **A self-anchoring bootstrap** (resolve the repo root inside `bootstrap.mjs`). Doesn't help: node
  must already **find** `bootstrap.mjs` to run it, and that invocation path is the thing that needs a
  CWD-independent anchor.
- **Anchor the MCP server too.** Rejected — out of scope (spawned once at root) and would re-add the
  uncertain `.mcp.json` arg-expansion dependency ADR-0031 removed.

## Related

[ADR-0031](ADR-0031-bootstrap-engine-resolution-guard.md), [ADR-0030](ADR-0030-consumer-integration-and-distribution.md).
Inner gate: `src/init.test.ts` — the emitter emits the anchored form, an old form is upgraded (user hooks
kept), and a **behavioral DoD gate** executes the emitted hook from a *foreign* cwd (bootstrap resolves →
INACTIVE payload, exit 0) while the old bare-relative form from the same cwd fails with MODULE_NOT_FOUND
(the contrast that lets the gate fail). Fixes issue #22.
</content>
</invoke>
